import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AbsencePreview,
  AbsenceRequestView,
  AbsenceType,
  BalanceView,
  CompteursValidations,
  CreateAbsenceRequestInput,
  CreateAbsenceTypeInput,
  CreateHolidayInput,
  DecideAbsenceRequestInput,
  EtapeCircuitView,
  Holiday,
  ListAbsenceRequestsQuery,
  SessionUser,
  SetBalanceInput,
  UpdateAbsenceTypeInput,
  UpdateHolidayInput,
} from '@teranga/contracts';
import {
  MAX_JUSTIFICATIF_BYTES,
  SENEGAL_FIXED_HOLIDAYS,
  SENEGAL_MOBILE_HOLIDAYS,
  type AbsenceFrequency,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { holidayDedupeKey } from '../notifications/notifications.service';
import { DG } from '../people/chaine';
import {
  annoncerLeVerdict,
  appelerLaRH,
  appelerLeN1,
  etapeDuNiveau,
  lireDemande,
  n1QuiPeutViser,
  NIVEAU_N1,
  NIVEAU_RH,
  niveauEffectif,
  retirerLesAppels,
  ROLES_RH,
  type ValideurN1,
} from './visas';
import { countWorkdays } from './workdays';

type DefaultType = {
  name: string;
  deductsBalance: boolean;
  allowanceDays: number | null;
  frequency: AbsenceFrequency;
  requiresDocument: boolean;
};

// La maternité s'ouvre à la naissance : ses jours ne se rechargent ni au mois
// ni au 1er janvier. Le nombre reste à la RH — il dépend de la convention, et
// en inventer un ici le graverait dans chaque tenant.
const DEFAULT_TYPES: DefaultType[] = [
  {
    name: 'Congé annuel',
    deductsBalance: true,
    allowanceDays: 30,
    frequency: 'annual',
    requiresDocument: false,
  },
  {
    name: 'Maladie',
    deductsBalance: false,
    allowanceDays: null,
    frequency: 'none',
    requiresDocument: true,
  },
  {
    name: 'Maternité',
    deductsBalance: false,
    allowanceDays: null,
    frequency: 'none',
    requiresDocument: true,
  },
  {
    name: 'Sans solde',
    deductsBalance: false,
    allowanceDays: null,
    frequency: 'none',
    requiresDocument: false,
  },
  {
    name: 'Mission',
    deductsBalance: false,
    allowanceDays: null,
    frequency: 'none',
    requiresDocument: true,
  },
];

const MANAGE_ROLES = new Set(['admin', 'hr']);
/**
 * Qui voit les demandes de TOUTE l'agence : la RH, et la paie qui en tire
 * les retenues. Les autres voient les leurs et celles de leurs agents
 * directs — celles qu'ils visent. Un type d'absence (maladie, maternité) est
 * une donnée sensible : le rôle ne suffit pas à l'ouvrir à tous.
 */
const VOIENT_TOUT = new Set(['admin', 'hr', 'payroll']);

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function num(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

/**
 * Le droit à porter d'office sur un solde d'année. Seul un quota annuel s'y
 * verse : « 3 par mois » ne fait pas 3 sur l'année, et les jours de maternité
 * ne s'ouvrent pas au 1er janvier.
 */
function droitAnnuel(type: {
  allowanceDays: string | number | null;
  frequency: string;
}): number | null {
  return type.frequency === 'annual' && type.allowanceDays != null
    ? Number(type.allowanceDays)
    : null;
}

/** Un férié vu comme MODÈLE : ce qu'on recopie d'une année sur la suivante. */
type ModeleFerie = {
  label: string;
  month: number | null;
  day: number | null;
  /** Date civile : elle seule se reporte telle quelle d'une année à l'autre. */
  fixedDate: boolean;
};

/**
 * Reporte une date civile sur une autre année.
 *
 * Rend `null` plutôt qu'une date fausse quand le quantième n'existe pas dans
 * l'année visée — un 29 février reporté sur une année commune. Aucune des six
 * dates sénégalaises n'est dans ce cas, mais une agence peut en inscrire une :
 * mieux vaut une ligne à dater qu'un 1er mars qui se fait passer pour elle.
 */
function reporterSur(year: number, modele: ModeleFerie): string | null {
  const { month, day } = modele;
  if (month == null || day == null) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AbsencesService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  // ---------- Types ----------

  async listTypes(user: SessionUser): Promise<AbsenceType[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      let rows = await this.selectTypes(tx);
      if (rows.length === 0 && MANAGE_ROLES.has(user.role)) {
        for (const d of DEFAULT_TYPES) {
          await tx.insert(t.absenceTypes).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            name: d.name,
            deductsBalance: d.deductsBalance,
            allowanceDays: d.allowanceDays?.toString() ?? null,
            frequency: d.frequency,
            requiresDocument: d.requiresDocument,
          });
        }
        rows = await this.selectTypes(tx);
      }
      return rows;
    });
  }

  async createType(user: SessionUser, input: CreateAbsenceTypeInput): Promise<{ id: string }> {
    const id = uuidv7();
    try {
      await this.db.withTenant(ctxOf(user), (tx) =>
        tx.insert(t.absenceTypes).values({
          id,
          tenantId: user.tenantId,
          name: input.name,
          deductsBalance: input.deductsBalance,
          allowanceDays: input.allowanceDays?.toString() ?? null,
          frequency: input.frequency,
          requiresDocument: input.requiresDocument,
        }),
      );
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(409, 'absence.type_exists', 'Un type d’absence porte déjà ce nom');
      }
      throw err;
    }
    return { id };
  }

  async updateType(user: SessionUser, id: string, input: UpdateAbsenceTypeInput): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select({ id: t.absenceTypes.id })
        .from(t.absenceTypes)
        .where(and(eq(t.absenceTypes.id, id), isNull(t.absenceTypes.deletedAt)))
        .limit(1);
      if (!row) problem(404, 'absence.type_not_found', 'Type d’absence introuvable');
      try {
        await tx
          .update(t.absenceTypes)
          .set({
            name: input.name,
            deductsBalance: input.deductsBalance,
            allowanceDays: input.allowanceDays?.toString() ?? null,
            frequency: input.frequency,
            requiresDocument: input.requiresDocument,
          })
          .where(eq(t.absenceTypes.id, id));
      } catch (err) {
        if (pgCode(err) === '23505') {
          problem(409, 'absence.type_exists', 'Un type d’absence porte déjà ce nom');
        }
        throw err;
      }
    });
  }

  /**
   * Retrait d'un type. La ligne reste en base : les demandes déjà déposées la
   * désignent, et une absence de 2024 doit garder son intitulé. Elle disparaît
   * simplement des listes et des formulaires.
   */
  async deleteType(user: SessionUser, id: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select({ name: t.absenceTypes.name })
        .from(t.absenceTypes)
        .where(and(eq(t.absenceTypes.id, id), isNull(t.absenceTypes.deletedAt)))
        .limit(1);
      if (!row) problem(404, 'absence.type_not_found', 'Type d’absence introuvable');

      // Une demande en cours de visa ne doit pas voir son motif s'évanouir
      // sous elle : on la laisse aboutir avant de retirer le type.
      const [pending] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(t.absenceRequests)
        .where(
          and(eq(t.absenceRequests.absenceTypeId, id), eq(t.absenceRequests.status, 'pending')),
        );
      if (Number(pending?.n ?? 0) > 0) {
        problem(
          409,
          'absence.type_in_use',
          'Ce type porte des demandes en attente',
          `« ${row.name} » ne peut pas être retiré tant que ${pending?.n} demande(s) attendent un visa. Traitez-les d’abord.`,
        );
      }

      // Le dernier type ne se retire pas : la liste vide déclenche le
      // réamorçage des types par défaut, et les cinq reviendraient d'un coup.
      const [restants] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(t.absenceTypes)
        .where(isNull(t.absenceTypes.deletedAt));
      if (Number(restants?.n ?? 0) <= 1) {
        problem(
          409,
          'absence.type_last',
          'Il faut au moins un type d’absence',
          'Créez-en un autre avant de retirer celui-ci.',
        );
      }

      await tx
        .update(t.absenceTypes)
        .set({ deletedAt: new Date() })
        .where(eq(t.absenceTypes.id, id));
    });
  }

  // ---------- Jours fériés ----------

  async listHolidays(user: SessionUser, year?: number): Promise<Holiday[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      if (year && MANAGE_ROLES.has(user.role)) await this.semerAnnee(tx, user, year);
      const rows = await tx
        .select({
          id: t.holidays.id,
          year: t.holidays.year,
          day: t.holidays.day,
          label: t.holidays.label,
          fixed: t.holidays.fixedDate,
        })
        .from(t.holidays)
        .where(year ? eq(t.holidays.year, year) : undefined)
        // Les fêtes non datées ferment la marche : elles n'ont pas de place
        // dans une lecture chronologique, mais elles doivent rester visibles.
        .orderBy(sql`${t.holidays.day} ASC NULLS LAST`, asc(t.holidays.label));
      return rows;
    });
  }

  async createHoliday(user: SessionUser, input: CreateHolidayInput): Promise<{ id: string }> {
    const id = uuidv7();
    if (input.day && Number(input.day.slice(0, 4)) !== input.year) {
      problem(
        422,
        'absence.holiday_year_mismatch',
        'La date ne tombe pas dans l’année choisie',
        `Le tableau des fériés se lit année par année : une date de ${input.day.slice(0, 4)} ne s’y range pas sous ${input.year}.`,
      );
    }
    await this.db.withTenant(ctxOf(user), async (tx) => {
      await this.refuserDoublon(tx, input.year, input.label, null);
      try {
        // Un férié saisi à la main est mobile par nature : les six dates
        // civiles sont déjà posées, et rien d'autre ne revient au même jour
        // chaque année.
        await tx.insert(t.holidays).values({
          id,
          tenantId: user.tenantId,
          year: input.year,
          day: input.day ?? null,
          label: input.label,
        });
      } catch (err) {
        if (pgCode(err) === '23505') {
          problem(409, 'absence.holiday_exists', 'Un jour férié existe déjà à cette date');
        }
        throw err;
      }
    });
    return { id };
  }

  async updateHoliday(user: SessionUser, id: string, input: UpdateHolidayInput): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const row = await this.chargerFerie(tx, id);
      const jour = input.day ?? null;

      // Une date civile se retire, mais ne se déplace pas : Noël déplacé d'un
      // jour ne lève aucune erreur, il rend seulement un jour chômé ouvré.
      if (row.fixed && jour !== row.day) {
        problem(
          409,
          'absence.holiday_fixed',
          'Ce jour férié est à date fixe',
          `« ${row.label} » tombe à la même date chaque année : sa date ne se déplace pas. Retirez-le si ce jour n’est plus chômé.`,
        );
      }
      if (jour && Number(jour.slice(0, 4)) !== row.year) {
        problem(
          422,
          'absence.holiday_year_mismatch',
          'La date ne tombe pas dans l’année choisie',
          `Ce jour est rangé sous ${row.year} : une date de ${jour.slice(0, 4)} ne s’y lirait pas.`,
        );
      }
      await this.refuserDoublon(tx, row.year, input.label, id);

      try {
        await tx
          .update(t.holidays)
          .set({ day: jour, label: input.label })
          .where(eq(t.holidays.id, id));
      } catch (err) {
        if (pgCode(err) === '23505') {
          problem(409, 'absence.holiday_exists', 'Un jour férié existe déjà à cette date');
        }
        throw err;
      }
      // Le rappel parti pour l'ancienne date annonce désormais un jour ouvré.
      if (row.day && row.day !== jour) await this.oublierRappel(tx, row.day);
    });
  }

  /**
   * Retrait d'un jour férié — y compris une date civile.
   *
   * Rien n'est chômé pour toujours : si l'Assomption cessait de l'être, il
   * faudrait pouvoir la retirer. C'est `holiday_seeds` qui empêche la ligne
   * supprimée de revenir au prochain affichage.
   */
  async deleteHoliday(user: SessionUser, id: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const row = await this.chargerFerie(tx, id);
      await tx.delete(t.holidays).where(eq(t.holidays.id, id));
      // Le rappel déjà parti affirmerait qu'un jour ouvré est chômé : on le
      // retire de toutes les boîtes. Les fêtes mobiles se recalent souvent
      // pendant la fenêtre J−2, quand la notification vient d'être envoyée.
      if (row.day) await this.oublierRappel(tx, row.day);
    });
  }

  private async chargerFerie(
    tx: Tx,
    id: string,
  ): Promise<{ year: number; day: string | null; label: string; fixed: boolean }> {
    const [row] = await tx
      .select({
        year: t.holidays.year,
        day: t.holidays.day,
        label: t.holidays.label,
        fixed: t.holidays.fixedDate,
      })
      .from(t.holidays)
      .where(eq(t.holidays.id, id))
      .limit(1);
    if (!row) problem(404, 'absence.holiday_not_found', 'Jour férié introuvable');
    return row;
  }

  /**
   * Deux « Korité » sur la même année ne veulent rien dire, et la base ne peut
   * pas l'interdire seule : l'unicité de date ne couvre pas les jours non
   * datés, qui sont précisément ceux qu'on risque de saisir deux fois.
   */
  private async refuserDoublon(
    tx: Tx,
    year: number,
    label: string,
    sauf: string | null,
  ): Promise<void> {
    const [jumeau] = await tx
      .select({ id: t.holidays.id })
      .from(t.holidays)
      .where(
        and(
          eq(t.holidays.year, year),
          sql`lower(${t.holidays.label}) = lower(${label})`,
          sauf ? sql`${t.holidays.id} <> ${sauf}` : undefined,
        ),
      )
      .limit(1);
    if (jumeau) {
      problem(
        409,
        'absence.holiday_label_exists',
        'Ce jour férié figure déjà sur cette année',
        `« ${label} » est déjà inscrit sur ${year}.`,
      );
    }
  }

  private async oublierRappel(tx: Tx, day: string): Promise<void> {
    await tx.delete(t.notifications).where(eq(t.notifications.dedupeKey, holidayDedupeKey(day)));
  }

  /**
   * Le socle d'une année, posé à sa PREMIÈRE consultation.
   *
   * Il est recopié de l'ANNÉE PRÉCÉDENTE, pas d'une liste figée : une agence
   * qui a ajouté un jour chômé à elle le retrouve l'année suivante, et une
   * qui en a retiré un ne le voit pas revenir. Seules les dates CIVILES sont
   * reportées avec leur jour — tout le reste arrive vide, à dater à
   * l'annonce, ce qui est le seul geste que la RH ait à faire.
   *
   * L'année précédente vide (première année ouverte par l'agence), on retombe
   * sur les quatorze fériés sénégalais.
   *
   * « Première consultation » ne se déduit pas du contenu de la table : une
   * année sans férié peut être une année jamais ouverte comme une année dont
   * on a retiré tous les jours. Les confondre ferait revenir ce qu'on vient de
   * supprimer. D'où la marque posée en même temps que le socle.
   */
  private async semerAnnee(tx: Tx, user: SessionUser, year: number): Promise<void> {
    const marque = await tx
      .insert(t.holidaySeeds)
      .values({ tenantId: user.tenantId, year })
      .onConflictDoNothing()
      .returning({ year: t.holidaySeeds.year });
    if (marque.length === 0) return;

    // L'année peut déjà porter des fériés saisis avant que le socle n'y soit
    // posé — un import, une Tabaski entrée à la main. Les réinsérer donnerait
    // deux lignes du même nom, que l'index de date ne rattraperait pas : une
    // fête non datée n'entre pas dans l'unicité de date.
    const dejaLa = new Set(
      (
        await tx
          .select({ label: t.holidays.label })
          .from(t.holidays)
          .where(eq(t.holidays.year, year))
      ).map((r) => r.label.toLowerCase()),
    );

    for (const modele of await this.modeleDAnnee(tx, year - 1)) {
      if (dejaLa.has(modele.label.toLowerCase())) continue;
      await tx
        .insert(t.holidays)
        .values({
          id: uuidv7(),
          tenantId: user.tenantId,
          year,
          day: modele.fixedDate ? reporterSur(year, modele) : null,
          label: modele.label,
          fixedDate: modele.fixedDate,
        })
        // Une fête mobile a pu être datée là avant que la date civile n'y soit
        // posée : on ne l'écrase pas.
        .onConflictDoNothing();
    }
  }

  /** Ce qu'on recopie : l'année demandée, ou le socle sénégalais si elle est vide. */
  private async modeleDAnnee(tx: Tx, year: number): Promise<ModeleFerie[]> {
    const precedente = await tx
      .select({ label: t.holidays.label, day: t.holidays.day, fixedDate: t.holidays.fixedDate })
      .from(t.holidays)
      .where(eq(t.holidays.year, year));
    if (precedente.length > 0) {
      return precedente.map((r) => {
        const [, mois, jour] = (r.day ?? '--').split('-');
        return {
          label: r.label,
          month: mois ? Number(mois) : null,
          day: jour ? Number(jour) : null,
          fixedDate: r.fixedDate,
        };
      });
    }
    return [
      ...SENEGAL_FIXED_HOLIDAYS.map((d) => ({
        label: d.label,
        month: d.month,
        day: d.day,
        fixedDate: true,
      })),
      ...SENEGAL_MOBILE_HOLIDAYS.map((label) => ({
        label,
        month: null,
        day: null,
        fixedDate: false,
      })),
    ];
  }

  // ---------- Circuit d'approbation ----------

  /** Ce que le n+1 a devant lui : son équipe, et ce qui attend son visa. */
  async compteurs(user: SessionUser): Promise<CompteursValidations> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const moi = await this.selfEmployeeId(tx, user);
      if (!moi) return { equipe: 0, aViser: 0 };
      const { rows } = await tx.execute<{ equipe: number; a_viser: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM employees e
            WHERE e.manager_employee_id = ${moi} AND e.status = 'active'
              AND e.id IS DISTINCT FROM ${DG}) AS equipe,
          (SELECT count(*)::int FROM absence_requests r
             JOIN employees e ON e.id = r.employee_id
            WHERE e.manager_employee_id = ${moi} AND e.status = 'active'
              AND e.id IS DISTINCT FROM ${DG}
              AND r.status = 'pending' AND r.current_level = ${NIVEAU_N1}) AS a_viser`);
      return { equipe: rows[0]?.equipe ?? 0, aViser: rows[0]?.a_viser ?? 0 };
    });
  }

  // ---------- Soldes ----------

  async balances(user: SessionUser, employeeId: string, year: number): Promise<BalanceView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, employeeId);
      await this.assertEmployeeScope(tx, user, employeeId);
      const types = await this.selectTypes(tx);
      const balanceRows = await tx
        .select()
        .from(t.absenceBalances)
        .where(and(eq(t.absenceBalances.employeeId, employeeId), eq(t.absenceBalances.year, year)));
      const sums = await tx
        .select({
          absenceTypeId: t.absenceRequests.absenceTypeId,
          status: t.absenceRequests.status,
          days: sql<string>`coalesce(sum(${t.absenceRequests.daysCount}), 0)`,
        })
        .from(t.absenceRequests)
        .where(
          and(
            eq(t.absenceRequests.employeeId, employeeId),
            sql`extract(year from ${t.absenceRequests.startDate}) = ${year}`,
            inArray(t.absenceRequests.status, ['approved', 'pending']),
          ),
        )
        .groupBy(t.absenceRequests.absenceTypeId, t.absenceRequests.status);

      return types.map((type) => {
        const balance = balanceRows.find((b) => b.absenceTypeId === type.id);
        const taken = num(
          sums.find((s) => s.absenceTypeId === type.id && s.status === 'approved')?.days,
        );
        const pending = num(
          sums.find((s) => s.absenceTypeId === type.id && s.status === 'pending')?.days,
        );
        const entitled = num(balance?.entitledDays ?? droitAnnuel(type) ?? 0);
        return {
          absenceTypeId: type.id,
          absenceTypeName: type.name,
          deductsBalance: type.deductsBalance,
          year,
          entitledDays: entitled,
          takenDays: taken,
          pendingDays: pending,
          remainingDays: type.deductsBalance ? entitled - taken - pending : 0,
        };
      });
    });
  }

  async setBalance(user: SessionUser, input: SetBalanceInput): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, input.employeeId);
      await tx
        .insert(t.absenceBalances)
        .values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId: input.employeeId,
          absenceTypeId: input.absenceTypeId,
          year: input.year,
          entitledDays: input.entitledDays.toString(),
        })
        .onConflictDoUpdate({
          target: [
            t.absenceBalances.tenantId,
            t.absenceBalances.employeeId,
            t.absenceBalances.absenceTypeId,
            t.absenceBalances.year,
          ],
          set: { entitledDays: input.entitledDays.toString() },
        });
    });
  }

  // ---------- Demandes ----------

  async preview(user: SessionUser, startDate: string, endDate: string): Promise<AbsencePreview> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Une fête non encore datée ne chôme rien : elle n'entre pas au décompte.
      const holidayRows = await tx
        .select({ day: sql<string>`${t.holidays.day}`, label: t.holidays.label })
        .from(t.holidays)
        .where(isNotNull(t.holidays.day));
      const result = countWorkdays(startDate, endDate, new Set(holidayRows.map((h) => h.day)));
      return {
        workingDays: result.workingDays,
        holidaysSkipped: result.holidaysSkipped.map((day) => ({
          day,
          label: holidayRows.find((h) => h.day === day)?.label ?? '',
        })),
      };
    });
  }

  async createRequest(
    user: SessionUser,
    input: CreateAbsenceRequestInput,
  ): Promise<{ id: string; daysCount: number }> {
    const id = uuidv7();
    let daysCount = 0;
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await this.requireEmployee(tx, input.employeeId);
        // Décision produit : chaque employé pose SES demandes depuis son
        // portail — aucun rôle ne saisit pour le compte d'un tiers.
        const self = await this.selfEmployeeId(tx, user);
        if (self !== input.employeeId) {
          problem(403, 'absence.self_only', 'Vous ne pouvez poser une demande que pour vous-même');
        }
        const [type] = await tx
          .select()
          .from(t.absenceTypes)
          .where(and(eq(t.absenceTypes.id, input.absenceTypeId), isNull(t.absenceTypes.deletedAt)))
          .limit(1);
        if (!type) {
          problem(422, 'absence.type_not_found', "Ce type d'absence n'existe pas");
        }

        const holidayRows = await tx
          .select({ day: sql<string>`${t.holidays.day}` })
          .from(t.holidays)
          .where(isNotNull(t.holidays.day));
        daysCount = countWorkdays(
          input.startDate,
          input.endDate,
          new Set(holidayRows.map((h) => h.day)),
        ).workingDays;
        if (daysCount === 0) {
          problem(
            422,
            'absence.no_working_days',
            'Aucun jour ouvré sur cette période',
            'La période ne contient que des week-ends ou jours fériés.',
          );
        }

        // Justificatif : exigé dès que le type le requiert.
        let document: { filename: string; data: Buffer } | null = null;
        if (input.document) {
          const data = Buffer.from(input.document.contentBase64, 'base64');
          if (data.length === 0 || data.length > MAX_JUSTIFICATIF_BYTES) {
            problem(422, 'absence.document_too_large', 'Le justificatif doit faire 5 Mo maximum');
          }
          if (!data.subarray(0, 5).toString().startsWith('%PDF')) {
            problem(422, 'absence.document_not_pdf', 'Le justificatif doit être un PDF');
          }
          document = { filename: input.document.filename, data };
        }
        if (type.requiresDocument && !document) {
          problem(
            422,
            'absence.document_required',
            'Un justificatif PDF est requis',
            `Le type « ${type.name} » exige un justificatif (attestation, ordre de mission…).`,
          );
        }

        if (type.deductsBalance) {
          const year = Number(input.startDate.slice(0, 4));
          const views = await this.balancesInTx(tx, user, input.employeeId, year, [type]);
          const view = views[0];
          if (view && daysCount > view.remainingDays) {
            problem(
              422,
              'absence.insufficient_balance',
              'Solde insuffisant',
              `Il reste ${view.remainingDays} jour(s) de « ${type.name} » sur ${year} (demande : ${daysCount} j, dont soldes en attente déjà réservés).`,
            );
          }
        }

        // ——— Le circuit : le n+1 d'abord ; sans n+1 qui puisse viser, la
        // demande part directement à la RH.
        const n1 = await n1QuiPeutViser(tx, input.employeeId);
        await tx.insert(t.absenceRequests).values({
          id,
          tenantId: user.tenantId,
          employeeId: input.employeeId,
          absenceTypeId: input.absenceTypeId,
          startDate: input.startDate,
          endDate: input.endDate,
          daysCount: daysCount.toString(),
          reason: input.reason,
          requestedByUserId: user.userId,
          currentLevel: n1 ? NIVEAU_N1 : NIVEAU_RH,
        });
        if (document) {
          await tx.insert(t.absenceDocuments).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            requestId: id,
            filename: document.filename,
            sizeBytes: document.data.length,
            data: document.data,
          });
        }
        const demande = await lireDemande(tx, id);
        if (demande) {
          if (n1) await appelerLeN1(tx, demande, n1);
          else await appelerLaRH(tx, demande, null);
        }
      });
    } catch (err) {
      if (pgCode(err) === '23P01') {
        problem(
          409,
          'absence.overlap',
          'Cette période chevauche une absence déjà demandée ou approuvée',
        );
      }
      throw err;
    }
    return { id, daysCount };
  }

  async listRequests(
    user: SessionUser,
    query: ListAbsenceRequestsQuery,
  ): Promise<AbsenceRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const conditions = [];
      if (query.status) conditions.push(eq(t.absenceRequests.status, query.status));
      if (query.employeeId) conditions.push(eq(t.absenceRequests.employeeId, query.employeeId));
      if (query.equipe) {
        // Les demandes de SES agents directs — quel que soit son rôle :
        // c'est l'organigramme qui fait le n+1, pas le rôle.
        const self = await this.selfEmployeeId(tx, user);
        if (!self) return [];
        conditions.push(
          eq(t.employees.managerEmployeeId, self),
          sql`${t.employees.id} IS DISTINCT FROM ${DG}`,
        );
      } else if (!VOIENT_TOUT.has(user.role)) {
        // Hors RH et paie, chacun ne voit que les siennes.
        const self = await this.selfEmployeeId(tx, user);
        if (!self) return [];
        conditions.push(eq(t.absenceRequests.employeeId, self));
      }

      const rows = await tx
        .select({
          request: t.absenceRequests,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          employeeNumber: t.employees.employeeNumber,
          workEmail: t.employees.workEmail,
          typeName: t.absenceTypes.name,
          deductsBalance: t.absenceTypes.deductsBalance,
        })
        .from(t.absenceRequests)
        .innerJoin(t.employees, eq(t.employees.id, t.absenceRequests.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .innerJoin(t.absenceTypes, eq(t.absenceTypes.id, t.absenceRequests.absenceTypeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(t.absenceRequests.createdAt))
        .limit(query.limit);

      return this.toViews(tx, user, rows);
    });
  }

  async upcoming(user: SessionUser): Promise<AbsenceRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Même périmètre que listRequests : la RH et la paie voient toute
      // l'agence ; les autres, leurs absences et celles de leurs agents
      // directs — le n+1 organise son équipe avec.
      const scope = [];
      if (!VOIENT_TOUT.has(user.role)) {
        const self = await this.selfEmployeeId(tx, user);
        if (!self) return [];
        scope.push(
          sql`(${t.absenceRequests.employeeId} = ${self} OR ${t.employees.managerEmployeeId} = ${self})`,
        );
      }
      const rows = await tx
        .select({
          request: t.absenceRequests,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          employeeNumber: t.employees.employeeNumber,
          workEmail: t.employees.workEmail,
          typeName: t.absenceTypes.name,
          deductsBalance: t.absenceTypes.deductsBalance,
        })
        .from(t.absenceRequests)
        .innerJoin(t.employees, eq(t.employees.id, t.absenceRequests.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .innerJoin(t.absenceTypes, eq(t.absenceTypes.id, t.absenceRequests.absenceTypeId))
        .where(
          and(
            eq(t.absenceRequests.status, 'approved'),
            gte(t.absenceRequests.endDate, sql`CURRENT_DATE`),
            ...scope,
          ),
        )
        .orderBy(asc(t.absenceRequests.startDate))
        .limit(20);
      return this.toViews(tx, user, rows);
    });
  }

  /**
   * Viser une demande, à l'étape qui l'attend.
   *
   *   — l'étape du n+1 n'appartient qu'à lui : ni la RH ni l'administrateur
   *     ne visent à sa place. Visée, elle passe à la RH, qui est prévenue ;
   *     refusée, elle s'arrête là ;
   *   — un n+1 qui a lui-même le rôle RH vise les deux étapes d'un coup :
   *     le faire signer deux fois la même demande n'apprendrait rien ;
   *   — l'étape de la RH appartient à la RH et à l'administrateur ;
   *   — personne ne vise sa propre demande.
   */
  async decide(
    user: SessionUser,
    requestId: string,
    input: DecideAbsenceRequestInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [request] = await tx
        .select()
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request) {
        problem(404, 'absence.request_not_found', 'Demande introuvable');
      }
      if (request.status !== 'pending') {
        problem(422, 'absence.already_decided', 'Cette demande a déjà été traitée');
      }
      if ((await this.selfEmployeeId(tx, user)) === request.employeeId) {
        problem(403, 'absence.propre_demande', 'Vous ne pouvez pas viser votre propre demande');
      }

      const n1 = await n1QuiPeutViser(tx, request.employeeId);
      const niveau = niveauEffectif(request.currentLevel, n1);
      const nomDuValideur = `${user.givenName} ${user.familyName}`;
      if (niveau === NIVEAU_N1) {
        if (!n1 || n1.userId !== user.userId) {
          problem(
            403,
            'absence.reservee_au_n1',
            'Cette demande attend le visa de son n+1',
            `${n1?.nom ?? 'Son n+1'} la vise d’abord ; la RH la reçoit ensuite.`,
          );
        }
      } else if (!ROLES_RH.includes(user.role)) {
        problem(403, 'absence.reservee_a_la_rh', 'Cette demande attend le visa de la RH');
      }

      const viser = async (level: number) =>
        tx.insert(t.absenceApprovals).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          requestId,
          level,
          decision: input.decision,
          decidedByUserId: user.userId,
          comment: input.comment,
        });
      const clore = async (status: 'approved' | 'rejected', level: number) =>
        tx
          .update(t.absenceRequests)
          .set({ status, currentLevel: level, decidedAt: new Date() })
          .where(eq(t.absenceRequests.id, requestId));
      const demande = await lireDemande(tx, requestId);

      if (niveau === NIVEAU_N1) {
        const n1Valideur = n1 as ValideurN1;
        await viser(NIVEAU_N1);
        const aussiRH = ROLES_RH.includes(n1Valideur.role);
        if (input.decision === 'rejected' || aussiRH) {
          if (input.decision === 'approved') await viser(NIVEAU_RH);
          await clore(input.decision, input.decision === 'approved' ? NIVEAU_RH : NIVEAU_N1);
          await retirerLesAppels(tx, requestId);
          if (demande) {
            await annoncerLeVerdict(
              tx,
              demande,
              input.decision,
              { nom: nomDuValideur, etape: 'n1' },
              input.comment,
            );
          }
          return;
        }
        // Visée par le n+1 : la RH est prévenue, c'est à elle.
        await tx
          .update(t.absenceRequests)
          .set({ currentLevel: NIVEAU_RH })
          .where(eq(t.absenceRequests.id, requestId));
        await retirerLesAppels(tx, requestId, ['n1']);
        if (demande) await appelerLaRH(tx, demande, nomDuValideur);
        return;
      }

      await viser(NIVEAU_RH);
      await clore(input.decision, NIVEAU_RH);
      await retirerLesAppels(tx, requestId);
      if (demande) {
        await annoncerLeVerdict(
          tx,
          demande,
          input.decision,
          { nom: nomDuValideur, etape: 'rh' },
          input.comment,
        );
      }
    });
  }

  async cancel(user: SessionUser, requestId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [request] = await tx
        .select()
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request) {
        problem(404, 'absence.request_not_found', 'Demande introuvable');
      }
      if (!MANAGE_ROLES.has(user.role)) {
        // Le titulaire du dossier peut annuler sa demande en attente, même si
        // c'est la RH qui l'avait saisie pour lui.
        const self = await this.selfEmployeeId(tx, user);
        const isOwnPending =
          (request.requestedByUserId === user.userId || request.employeeId === self) &&
          request.status === 'pending';
        if (!isOwnPending) {
          problem(
            403,
            'absence.cancel_forbidden',
            'Vous ne pouvez annuler que vos propres demandes en attente',
          );
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      const cancellable =
        request.status === 'pending' ||
        (request.status === 'approved' && request.startDate > today);
      if (!cancellable) {
        problem(
          422,
          'absence.not_cancellable',
          'Cette demande ne peut plus être annulée',
          'Seules les demandes en attente ou approuvées non commencées sont annulables.',
        );
      }
      await tx
        .update(t.absenceRequests)
        .set({ status: 'cancelled', decidedAt: new Date() })
        .where(eq(t.absenceRequests.id, requestId));
      // Plus rien à viser : les appels restés dans les boîtes s'en vont.
      await retirerLesAppels(tx, requestId);
    });
  }

  /** Justificatif d'une demande — admin/RH ou titulaire du dossier uniquement. */
  async document(
    user: SessionUser,
    requestId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [request] = await tx
        .select({ employeeId: t.absenceRequests.employeeId })
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.id, requestId))
        .limit(1);
      if (!request) {
        problem(404, 'absence.request_not_found', 'Demande introuvable');
      }
      if (!MANAGE_ROLES.has(user.role)) {
        const self = await this.selfEmployeeId(tx, user);
        if (self !== request.employeeId) {
          // Données de santé potentielles : ni managers ni paie n'y accèdent.
          problem(
            403,
            'absence.document_forbidden',
            'Justificatif réservé à la RH et au titulaire',
          );
        }
      }
      const [doc] = await tx
        .select({
          filename: t.absenceDocuments.filename,
          contentType: t.absenceDocuments.contentType,
          data: t.absenceDocuments.data,
        })
        .from(t.absenceDocuments)
        .where(eq(t.absenceDocuments.requestId, requestId))
        .limit(1);
      if (!doc) {
        problem(404, 'absence.document_not_found', 'Aucun justificatif joint à cette demande');
      }
      return doc;
    });
  }

  // ---------- Privé ----------

  /** Id du dossier employé relié au compte connecté (null si aucun). */
  private async selfEmployeeId(tx: Tx, user: SessionUser): Promise<string | null> {
    const [row] = await tx
      .select({ id: t.employees.id })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.persons.userId, user.userId))
      .limit(1);
    return row?.id ?? null;
  }

  /** Gestionnaires : accès à tout dossier ; autres rôles : uniquement le leur. */
  private async assertEmployeeScope(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
    if (MANAGE_ROLES.has(user.role) || user.role === 'payroll') return;
    const self = await this.selfEmployeeId(tx, user);
    if (self !== employeeId) {
      problem(403, 'people.forbidden_scope', 'Accès limité à votre propre dossier');
    }
  }

  private async selectTypes(tx: Tx): Promise<AbsenceType[]> {
    const rows = await tx
      .select({
        id: t.absenceTypes.id,
        name: t.absenceTypes.name,
        deductsBalance: t.absenceTypes.deductsBalance,
        allowanceDays: t.absenceTypes.allowanceDays,
        frequency: t.absenceTypes.frequency,
        requiresDocument: t.absenceTypes.requiresDocument,
      })
      .from(t.absenceTypes)
      .where(isNull(t.absenceTypes.deletedAt))
      .orderBy(asc(t.absenceTypes.name));
    // Ce que le type a déjà servi : l'écran s'en sert pour dire ce qu'un
    // retrait emporte.
    const usages = await tx
      .select({
        typeId: t.absenceRequests.absenceTypeId,
        n: sql<string>`count(*)`,
      })
      .from(t.absenceRequests)
      .groupBy(t.absenceRequests.absenceTypeId);
    return rows.map((r) => ({
      ...r,
      allowanceDays: r.allowanceDays == null ? null : Number(r.allowanceDays),
      frequency: r.frequency as AbsenceType['frequency'],
      usageCount: Number(usages.find((u) => u.typeId === r.id)?.n ?? 0),
    }));
  }

  /** Variante de balances() réutilisable dans une transaction déjà ouverte. */
  private async balancesInTx(
    tx: Tx,
    user: SessionUser,
    employeeId: string,
    year: number,
    types: Array<typeof t.absenceTypes.$inferSelect>,
  ): Promise<BalanceView[]> {
    const balanceRows = await tx
      .select()
      .from(t.absenceBalances)
      .where(and(eq(t.absenceBalances.employeeId, employeeId), eq(t.absenceBalances.year, year)));
    const sums = await tx
      .select({
        absenceTypeId: t.absenceRequests.absenceTypeId,
        status: t.absenceRequests.status,
        days: sql<string>`coalesce(sum(${t.absenceRequests.daysCount}), 0)`,
      })
      .from(t.absenceRequests)
      .where(
        and(
          eq(t.absenceRequests.employeeId, employeeId),
          sql`extract(year from ${t.absenceRequests.startDate}) = ${year}`,
          inArray(t.absenceRequests.status, ['approved', 'pending']),
        ),
      )
      .groupBy(t.absenceRequests.absenceTypeId, t.absenceRequests.status);

    return types.map((type) => {
      const balance = balanceRows.find((b) => b.absenceTypeId === type.id);
      const taken = num(
        sums.find((s) => s.absenceTypeId === type.id && s.status === 'approved')?.days,
      );
      const pending = num(
        sums.find((s) => s.absenceTypeId === type.id && s.status === 'pending')?.days,
      );
      const entitled = num(balance?.entitledDays ?? droitAnnuel(type) ?? 0);
      return {
        absenceTypeId: type.id,
        absenceTypeName: type.name,
        deductsBalance: type.deductsBalance,
        year,
        entitledDays: entitled,
        takenDays: taken,
        pendingDays: pending,
        remainingDays: type.deductsBalance ? entitled - taken - pending : 0,
      };
    });
  }

  private async toViews(
    tx: Tx,
    user: SessionUser,
    rows: Array<{
      request: typeof t.absenceRequests.$inferSelect;
      givenName: string;
      familyName: string;
      employeeNumber: string;
      workEmail: string | null;
      typeName: string;
      deductsBalance: boolean;
    }>,
  ): Promise<AbsenceRequestView[]> {
    if (rows.length === 0) return [];

    const documentRows = await tx
      .select({ requestId: t.absenceDocuments.requestId, filename: t.absenceDocuments.filename })
      .from(t.absenceDocuments)
      .where(
        inArray(
          t.absenceDocuments.requestId,
          rows.map((r) => r.request.id),
        ),
      );

    const approvalRows = await tx
      .select({
        requestId: t.absenceApprovals.requestId,
        level: t.absenceApprovals.level,
        decision: t.absenceApprovals.decision,
        comment: t.absenceApprovals.comment,
        decidedAt: t.absenceApprovals.decidedAt,
        givenName: t.users.givenName,
        familyName: t.users.familyName,
      })
      .from(t.absenceApprovals)
      .innerJoin(t.users, eq(t.users.id, t.absenceApprovals.decidedByUserId))
      .where(
        inArray(
          t.absenceApprovals.requestId,
          rows.map((r) => r.request.id),
        ),
      )
      .orderBy(asc(t.absenceApprovals.level));

    // Le n+1 qui peut viser, agent par agent — lu une fois par agent, pas
    // une fois par demande.
    const n1s = new Map<string, ValideurN1 | null>();
    for (const r of rows) {
      if (!n1s.has(r.request.employeeId)) {
        n1s.set(r.request.employeeId, await n1QuiPeutViser(tx, r.request.employeeId));
      }
    }
    const moi = await this.selfEmployeeId(tx, user);

    return rows.map(
      ({ request, givenName, familyName, employeeNumber, workEmail, typeName, deductsBalance }) => {
        const n1 = n1s.get(request.employeeId) ?? null;
        const niveau = niveauEffectif(request.currentLevel, n1);
        const enAttente = request.status === 'pending';
        const visas = approvalRows.filter((a) => a.requestId === request.id);
        const visaDe = (level: number) => visas.find((a) => a.level === level);
        const signe = (level: number): EtapeCircuitView | null => {
          const v = visaDe(level);
          return v
            ? {
                etape: etapeDuNiveau(level),
                etat: v.decision === 'approved' ? 'visee' : 'refusee',
                qui: `${v.givenName} ${v.familyName}`,
                decidedAt: v.decidedAt.toISOString(),
                comment: v.comment,
              }
            : null;
        };
        const vide = (etape: 'n1' | 'rh', etat: EtapeCircuitView['etat'], qui: string | null) =>
          ({ etape, etat, qui, decidedAt: null, comment: null }) satisfies EtapeCircuitView;

        // L'étape du n+1 : signée ; attendue (on dit qui) ; passée, quand la
        // demande est allée à la RH sans lui ; sans objet, si elle a été
        // annulée avant qu'il vise.
        const etapeN1 =
          signe(NIVEAU_N1) ??
          (enAttente
            ? niveau === NIVEAU_N1
              ? vide('n1', 'attendue', n1?.nom ?? null)
              : vide('n1', 'passee', null)
            : request.status === 'cancelled' && request.currentLevel === NIVEAU_N1
              ? vide('n1', 'sans_objet', null)
              : vide('n1', 'passee', null));
        const etapeRH =
          signe(NIVEAU_RH) ??
          (enAttente
            ? niveau === NIVEAU_RH
              ? vide('rh', 'attendue', null)
              : vide('rh', 'a_venir', null)
            : vide('rh', 'sans_objet', null));

        const canDecide =
          enAttente &&
          moi !== request.employeeId &&
          (niveau === NIVEAU_N1 ? n1?.userId === user.userId : ROLES_RH.includes(user.role));

        return {
          id: request.id,
          employeeId: request.employeeId,
          employeeName: `${givenName} ${familyName}`,
          employeeNumber,
          workEmail,
          absenceTypeId: request.absenceTypeId,
          absenceTypeName: typeName,
          deductsBalance,
          startDate: request.startDate,
          endDate: request.endDate,
          daysCount: num(request.daysCount),
          reason: request.reason,
          status: request.status,
          currentLevel: niveau,
          etapeAttendue: enAttente ? etapeDuNiveau(niveau) : null,
          circuit: [etapeN1, etapeRH],
          canDecide,
          documentName: documentRows.find((d) => d.requestId === request.id)?.filename ?? null,
          approvals: visas.map((a) => ({
            level: a.level,
            decision: a.decision,
            decidedByName: `${a.givenName} ${a.familyName}`,
            comment: a.comment,
            decidedAt: a.decidedAt.toISOString(),
          })),
          createdAt: request.createdAt.toISOString(),
        };
      },
    );
  }

  private async requireEmployee(tx: Tx, id: string) {
    const [employee] = await tx.select().from(t.employees).where(eq(t.employees.id, id)).limit(1);
    if (!employee) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return employee;
  }
}
