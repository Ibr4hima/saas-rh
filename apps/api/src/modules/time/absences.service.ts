import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AbsencePreview,
  AbsenceRequestView,
  AbsenceType,
  ApprovalChain,
  BalanceView,
  CreateAbsenceRequestInput,
  CreateAbsenceTypeInput,
  CreateHolidayInput,
  DecideAbsenceRequestInput,
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

const DEFAULT_CHAIN = ['hr'];
const MANAGE_ROLES = new Set(['admin', 'hr']);

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
   * Le socle des quatorze fériés sénégalais, posé à la PREMIÈRE consultation
   * de l'année — les six dates civiles avec leur date, les huit fêtes mobiles
   * sans la leur, à dater à l'annonce.
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

    for (const def of SENEGAL_FIXED_HOLIDAYS) {
      if (dejaLa.has(def.label.toLowerCase())) continue;
      const day = `${year}-${String(def.month).padStart(2, '0')}-${String(def.day).padStart(2, '0')}`;
      await tx
        .insert(t.holidays)
        .values({
          id: uuidv7(),
          tenantId: user.tenantId,
          year,
          day,
          label: def.label,
          fixedDate: true,
        })
        // Une fête mobile a pu être datée là avant que la date civile n'y soit
        // posée : on ne l'écrase pas.
        .onConflictDoNothing();
    }
    for (const label of SENEGAL_MOBILE_HOLIDAYS) {
      if (dejaLa.has(label.toLowerCase())) continue;
      await tx.insert(t.holidays).values({
        id: uuidv7(),
        tenantId: user.tenantId,
        year,
        day: null,
        label,
      });
    }
  }

  // ---------- Circuit d'approbation ----------

  async getChain(user: SessionUser): Promise<ApprovalChain> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx.select().from(t.approvalChains).limit(1);
      return { levels: row?.levels ?? DEFAULT_CHAIN };
    });
  }

  async updateChain(user: SessionUser, levels: string[]): Promise<ApprovalChain> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [existing] = await tx.select().from(t.approvalChains).limit(1);
      if (existing) {
        await tx
          .update(t.approvalChains)
          .set({ levels })
          .where(eq(t.approvalChains.id, existing.id));
      } else {
        await tx.insert(t.approvalChains).values({ id: uuidv7(), tenantId: user.tenantId, levels });
      }
      return { levels };
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
      // Le rôle employé ne voit que ses propres demandes ; les approbateurs
      // (manager, paie) et gestionnaires voient tout.
      if (user.role === 'employee') {
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
      // Même périmètre que listRequests : le rôle employé ne voit que ses
      // propres absences (les types — maladie, maternité — sont des données
      // sensibles) ; approbateurs et gestionnaires voient tout le tenant.
      const scope = [];
      if (user.role === 'employee') {
        const self = await this.selfEmployeeId(tx, user);
        if (!self) return [];
        scope.push(eq(t.absenceRequests.employeeId, self));
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

      const [chainRow] = await tx.select().from(t.approvalChains).limit(1);
      const levels = chainRow?.levels ?? DEFAULT_CHAIN;
      const requiredRole = levels[request.currentLevel] ?? levels[levels.length - 1];
      if (user.role !== 'admin' && user.role !== requiredRole) {
        problem(
          403,
          'absence.wrong_level',
          'Ce niveau de visa ne relève pas de votre rôle',
          `Le niveau ${request.currentLevel + 1}/${levels.length} attend le rôle « ${requiredRole} ».`,
        );
      }

      await tx.insert(t.absenceApprovals).values({
        id: uuidv7(),
        tenantId: user.tenantId,
        requestId,
        level: request.currentLevel,
        decision: input.decision,
        decidedByUserId: user.userId,
        comment: input.comment,
      });

      if (input.decision === 'rejected') {
        await tx
          .update(t.absenceRequests)
          .set({ status: 'rejected', decidedAt: new Date() })
          .where(eq(t.absenceRequests.id, requestId));
        return;
      }

      const nextLevel = request.currentLevel + 1;
      if (nextLevel >= levels.length) {
        await tx
          .update(t.absenceRequests)
          .set({ status: 'approved', currentLevel: nextLevel, decidedAt: new Date() })
          .where(eq(t.absenceRequests.id, requestId));
      } else {
        await tx
          .update(t.absenceRequests)
          .set({ currentLevel: nextLevel })
          .where(eq(t.absenceRequests.id, requestId));
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

    const [chainRow] = await tx.select().from(t.approvalChains).limit(1);
    const levels = chainRow?.levels ?? DEFAULT_CHAIN;

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

    return rows.map(
      ({ request, givenName, familyName, employeeNumber, workEmail, typeName, deductsBalance }) => {
        const requiredRole = levels[request.currentLevel] ?? levels[levels.length - 1];
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
          currentLevel: request.currentLevel,
          chainLevels: levels,
          canDecide:
            request.status === 'pending' && (user.role === 'admin' || user.role === requiredRole),
          documentName: documentRows.find((d) => d.requestId === request.id)?.filename ?? null,
          approvals: approvalRows
            .filter((a) => a.requestId === request.id)
            .map((a) => ({
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
