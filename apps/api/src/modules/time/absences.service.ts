import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AbsencePreview,
  AbsenceRequestView,
  AnnulerAbsenceInput,
  AbsenceType,
  BalanceView,
  CompteursValidations,
  CreateAbsenceRequestInput,
  CreateAbsenceTypeInput,
  CreateHolidayInput,
  DecideAbsenceRequestInput,
  DeciderRepriseInput,
  DemanderRepriseInput,
  EtapeCircuitView,
  Holiday,
  ListAbsenceRequestsQuery,
  RappelerInput,
  SessionUser,
  SetBalanceInput,
  UpdateAbsenceTypeInput,
  UpdateHolidayInput,
} from '@teranga/contracts';
import {
  peut,
  MAX_JUSTIFICATIF_BYTES,
  SENEGAL_FIXED_HOLIDAYS,
  SENEGAL_MOBILE_HOLIDAYS,
  type AbsenceFrequency,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { holidayDedupeKey } from '../notifications/notifications.service';
import { absence, duAu, frDate } from '../notifications/phrases';
import { DG } from '../people/chaine';
import { notifier } from '../notifications/notifier';
import {
  detenteursDe,
  directionDuPersonnel,
  membreDCH,
  nomDe,
  nomsDe,
  pasSurSoi,
} from '../acces/dch';
import { aTraiterPar, voitToutLaFile } from '../acces/demandes';
import {
  annoncerLeChangement,
  annoncerLeVerdict,
  attendu,
  attenduPourLaReprise,
  lireCircuit,
  lireDemande,
  NIVEAU_DCH,
  NIVEAU_N1,
  reconcilierDemande,
  reconcilierLeCircuit,
  reconcilierReprise,
  reprisesEnAttente,
  type Attendu,
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

/** Aujourd'hui, à Dakar (UTC+0, sans heure d'été). */
function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Le jour d'avant, le jour d'après : des dates ISO, sans fuseau. */
function decaler(iso: string, jours: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
const veille = (iso: string) => decaler(iso, -1);
const lendemain = (iso: string) => decaler(iso, 1);

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
      if (rows.length === 0 && peut(user, 'conges.parametres')) {
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
      if (year && peut(user, 'feries')) await this.semerAnnee(tx, user, year);
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

  /**
   * Seules l'année en cours et la suivante se paramètrent (décision APIX) :
   * une année passée est close, une année lointaine n'est pas encore ouverte.
   * Dakar vit à UTC : l'année du serveur est celle de l'agence.
   */
  private exigerAnneeOuverte(year: number): void {
    const courante = new Date().getUTCFullYear();
    if (year !== courante && year !== courante + 1) {
      problem(
        422,
        'absence.holiday_year_closed',
        'Cette année ne se paramètre pas',
        `Les jours fériés se paramètrent pour ${courante} et ${courante + 1} seulement.`,
      );
    }
  }

  async createHoliday(user: SessionUser, input: CreateHolidayInput): Promise<{ id: string }> {
    const id = uuidv7();
    this.exigerAnneeOuverte(input.year);
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
      this.exigerAnneeOuverte(row.year);
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
      this.exigerAnneeOuverte(row.year);
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
    // Un double clic sur « Ajouter » : sans verrou, les deux passent ce
    // contrôle avant que l'un n'écrive. Les fériés d'une année se touchent
    // un par un.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('feries:' || current_setting('app.tenant_id') || ':' || ${String(year)}))`,
    );
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

  /** Ce que l'appelant a devant lui : son équipe, ce qu'il vise, ce qu'il traite. */
  async compteurs(user: SessionUser): Promise<CompteursValidations> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const moi = await this.selfEmployeeId(tx, user);
      const rien = { documents: 0, informations: 0, pieces: 0, conges: 0 };
      if (!moi) return { equipe: 0, aViser: 0, aTraiter: rien };
      const { rows } = await tx.execute<{ equipe: number }>(sql`
        SELECT count(*)::int AS equipe FROM employees e
         WHERE e.manager_employee_id = ${moi} AND e.status = 'active'
           AND e.id IS DISTINCT FROM ${DG}`);
      const equipe = rows[0]?.equipe ?? 0;
      // Qui est attendu, demande par demande : c'est le circuit qui le dit
      // — un N+1 en congé, un membre parti ne comptent pas. Le directeur du
      // Capital Humain compte aussi ce qu'il a délégué : il peut le traiter.
      const enAttente = await tx.execute<{ id: string }>(sql`
        SELECT id FROM absence_requests WHERE status = 'pending'`);
      let aViser = 0;
      let conges = 0;
      for (const { id } of enAttente.rows) {
        const demande = await lireCircuit(tx, id);
        const att = demande ? await attendu(tx, demande) : null;
        if (!att) continue;
        if (att.valideurs.some((v) => v.employeeId === moi)) {
          if (att.etape === 'n1') aViser += 1;
          else conges += 1;
        } else if (
          att.etape === 'dch' &&
          !att.demandeDuDirecteur &&
          att.dch?.directeurEmployeeId === moi
        ) {
          conges += 1;
        }
      }
      // Les retours anticipés à confirmer : le N+1, sinon la DCH.
      for (const id of await reprisesEnAttente(tx)) {
        const demande = await lireCircuit(tx, id);
        if (!demande) continue;
        const att = await attenduPourLaReprise(tx, demande);
        if (att.valideurs.some((v) => v.employeeId === moi)) {
          if (att.etape === 'n1') aViser += 1;
          else conges += 1;
        } else if (
          att.etape === 'dch' &&
          !att.demandeDuDirecteur &&
          att.dch?.directeurEmployeeId === moi
        ) {
          conges += 1;
        }
      }
      return { equipe, aViser, aTraiter: { conges, ...(await aTraiterPar(tx, moi)) } };
    });
  }

  /**
   * Voit toutes les demandes de congé : qui les traite pour la DCH, son
   * directeur et les membres habilités. Consulter les dossiers n'y suffit
   * pas : la file des congés se délègue à part.
   */
  private voitTout(tx: Tx, user: SessionUser): Promise<boolean> {
    return voitToutLaFile(tx, user, 'conges');
  }

  /**
   * Confier UNE demande à un membre de la DCH — ou la reprendre (`null`).
   * Rend `proposerHabilitation` : le membre n'est pas habilité aux congés ;
   * l'écran propose au directeur de lui confier aussi les suivantes.
   */
  async confier(
    user: SessionUser,
    requestId: string,
    employeeId: string | null,
  ): Promise<{ proposerHabilitation: boolean }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [request] = await tx
        .select()
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request) problem(404, 'absence.request_not_found', 'Demande introuvable');
      const moi = await this.selfEmployeeId(tx, user);
      const demande = await lireCircuit(tx, requestId);
      const att = demande ? await attendu(tx, demande) : null;
      const dch = att?.dch ?? null;
      if (!dch || !moi || dch.directeurEmployeeId !== moi) {
        problem(
          403,
          'absence.reserve_au_directeur_dch',
          'Seul le directeur du Capital Humain confie les demandes',
        );
      }
      if (att?.etape !== 'dch') {
        problem(
          422,
          'absence.pas_a_la_dch',
          'Cette demande n’est pas à l’étape de la DCH',
          'Elle attend encore le visa du N+1, ou elle est déjà traitée.',
        );
      }
      if (employeeId) {
        if (employeeId === request.employeeId) {
          problem(
            422,
            'absence.confiee_au_demandeur',
            'On ne confie pas une demande à qui la pose',
          );
        }
        const m = await membreDCH(tx, dch, employeeId);
        if (m === 'parti' || employeeId === moi) {
          problem(422, 'absence.pas_membre_dch', 'Choisissez un membre de la DCH');
        }
        if (m.absent) {
          problem(
            422,
            'absence.membre_absent',
            `${m.nom} est en congé aujourd’hui`,
            'Confiez la demande à un autre membre, ou traitez-la vous-même.',
          );
        }
      }
      await tx
        .update(t.absenceRequests)
        .set({ confieeAEmployeeId: employeeId ?? moi })
        .where(eq(t.absenceRequests.id, requestId));
      await reconcilierDemande(tx, requestId);
      return {
        proposerHabilitation: Boolean(
          employeeId && !(await detenteursDe(tx, 'demandes.conges')).includes(employeeId),
        ),
      };
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
      await pasSurSoi(tx, user.userId, [input.employeeId], 'modifier vos propres soldes de congés');
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
        // Deux demandes envoyées au même instant (deux onglets, un double
        // envoi) passeraient chacune le contrôle de solde sans voir l'autre :
        // le dossier de l'agent est verrouillé jusqu'à la fin de la
        // transaction, la seconde attend la première et voit son solde.
        await tx.execute(sql`SELECT id FROM employees WHERE id = ${input.employeeId} FOR UPDATE`);
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
        // ——— Le circuit : le N+1 d'abord ; sans N+1 qui puisse viser, la
        // demande part directement à la DCH. Qui est attendu est prévenu.
        await reconcilierDemande(tx, id);
        await reconcilierLeCircuit(tx, user.tenantId);
      });
    } catch (err) {
      if (pgCode(err) === '23P01') await this.refuserLeChevauchement(user, input);
      throw err;
    }
    return { id, daysCount };
  }

  /**
   * La période en chevauche une autre : on dit laquelle. Quand elle ne
   * déborde que la fin d'un congé (un arrêt maladie qui prolonge un congé,
   * par exemple), on dit aussi le jour où la commencer.
   */
  private async refuserLeChevauchement(
    user: SessionUser,
    input: CreateAbsenceRequestInput,
  ): Promise<never> {
    const [autre] = await this.db.withTenant(ctxOf(user), (tx) =>
      tx
        .select({
          debut: t.absenceRequests.startDate,
          fin: t.absenceRequests.endDate,
          statut: t.absenceRequests.status,
          type: t.absenceTypes.name,
        })
        .from(t.absenceRequests)
        .innerJoin(t.absenceTypes, eq(t.absenceTypes.id, t.absenceRequests.absenceTypeId))
        .where(
          and(
            eq(t.absenceRequests.employeeId, input.employeeId),
            inArray(t.absenceRequests.status, ['pending', 'approved']),
            lte(t.absenceRequests.startDate, input.endDate),
            gte(t.absenceRequests.endDate, input.startDate),
          ),
        )
        .orderBy(asc(t.absenceRequests.startDate))
        .limit(1),
    );
    if (!autre) {
      problem(
        409,
        'absence.overlap',
        'Cette période chevauche une absence déjà demandée ou approuvée',
      );
    }
    const a = absence(autre.type);
    const periode = duAu(autre.debut, autre.fin);
    problem(
      409,
      'absence.overlap',
      autre.statut === 'approved'
        ? `Cette période chevauche votre ${a.nom} ${periode}`
        : `Cette période chevauche votre demande de ${a.nom} ${periode}`,
      autre.debut <= input.startDate && autre.fin < input.endDate
        ? `${autre.statut === 'approved' ? 'Votre' : 'Votre demande de'} ${a.nom} va jusqu’au ${frDate(autre.fin)} : commencez celle-ci le ${frDate(lendemain(autre.fin))}.`
        : undefined,
    );
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
      } else if (
        query.employeeId &&
        (peut(user, 'personnel.consulter') || peut(user, 'conges.soldes'))
      ) {
        // Les absences d'UN agent, sur sa fiche : qui consulte les dossiers.
      } else if (!(await this.voitTout(tx, user))) {
        // Hors DCH, chacun voit les siennes, et celles qu'on lui a confiées.
        const self = await this.selfEmployeeId(tx, user);
        if (!self) return [];
        conditions.push(
          sql`(${t.absenceRequests.employeeId} = ${self}
               OR ${t.absenceRequests.confieeAEmployeeId} = ${self})`,
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
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(t.absenceRequests.createdAt))
        .limit(query.limit);

      return this.toViews(tx, user, rows);
    });
  }

  async upcoming(user: SessionUser): Promise<AbsenceRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Qui traite les congés pour la DCH, et le tableau de bord, voient toute
      // l'agence ; les autres, leurs absences et celles de leurs agents
      // directs : le n+1 organise son équipe avec.
      const scope = [];
      if (!peut(user, 'pilotage') && !(await this.voitTout(tx, user))) {
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
   * Viser une demande, à l'étape qui l'attend — cf. `visas.ts` pour le
   * circuit.
   *
   *   — l'étape du N+1 n'appartient qu'à lui. Visée, la demande passe à la
   *     DCH, dont le traitant est prévenu ; refusée, elle s'arrête là ;
   *   — la demande du directeur du Capital Humain : le visa du DG suffit ;
   *   — le N+1 qui traite aussi pour la DCH (le directeur, ou le membre
   *     délégué) vise les deux étapes d'un coup ;
   *   — l'étape de la DCH appartient à qui la traite ; le directeur peut
   *     toujours reprendre la main sur une demande confiée ;
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

      const demande = (await lireCircuit(tx, requestId))!;
      const att = (await attendu(tx, demande))!;
      const directeur = att.dch?.directeur ?? null;
      const estDirecteur = directeur?.userId === user.userId;
      const estAttendu = att.valideurs.some((v) => v.userId === user.userId);
      if (!estAttendu && !(att.etape === 'dch' && estDirecteur)) {
        if (att.etape === 'n1') {
          problem(
            403,
            'absence.reservee_au_n1',
            'Cette demande attend le visa de son N+1',
            `${nomsDe(att.valideurs) ?? 'Son N+1'} la vise d’abord ; la DCH la reçoit ensuite.`,
          );
        }
        problem(
          403,
          'absence.reservee_a_la_dch',
          'Cette demande attend la Direction du Capital Humain',
          att.valideurs.length > 0
            ? `${nomsDe(att.valideurs)} la traite.`
            : 'Personne ne traite pour la DCH en ce moment : l’administrateur est prévenu.',
        );
      }

      const viser = (level: number, parDelegationDe: string | null = null) =>
        tx.insert(t.absenceApprovals).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          requestId,
          level,
          decision: input.decision,
          decidedByUserId: user.userId,
          comment: input.comment,
          parDelegationDe,
        });
      const clore = async (level: number) => {
        await tx
          .update(t.absenceRequests)
          .set({ status: input.decision, currentLevel: level, decidedAt: new Date() })
          .where(eq(t.absenceRequests.id, requestId));
        await reconcilierDemande(tx, requestId);
        const d = await lireDemande(tx, requestId);
        if (d) await annoncerLeVerdict(tx, d, input.decision);
        if (input.decision === 'approved') await this.rappelerAuDirecteur(tx, user, demande, att);
      };

      if (att.etape === 'n1') {
        await viser(NIVEAU_N1);
        if (input.decision === 'rejected' || att.demandeDuDirecteur) {
          await clore(NIVEAU_N1);
          return;
        }
        // Visée par le N+1 : la demande passe à la DCH.
        await tx
          .update(t.absenceRequests)
          .set({ currentLevel: NIVEAU_DCH })
          .where(eq(t.absenceRequests.id, requestId));
        const suite = await attendu(tx, { ...demande, currentLevel: NIVEAU_DCH });
        // Le même, attendu aux deux étapes : un seul visa.
        const traiteAussi = Boolean(suite?.valideurs.some((v) => v.userId === user.userId));
        const aussiDCH = traiteAussi || suite?.dch?.directeur?.userId === user.userId;
        if (aussiDCH) {
          const pourLeCompteDe = traiteAussi ? (suite?.parDelegationDe?.employeeId ?? null) : null;
          await viser(NIVEAU_DCH, pourLeCompteDe);
          await clore(NIVEAU_DCH);
          return;
        }
        await reconcilierLeCircuit(tx, user.tenantId);
        return;
      }

      // L'étape de la DCH : son traitant, ou le directeur qui reprend la main.
      const pourLeCompteDe = estAttendu ? (att.parDelegationDe?.employeeId ?? null) : null;
      await viser(NIVEAU_DCH, pourLeCompteDe);
      await clore(NIVEAU_DCH);
    });
  }

  /**
   * Le congé du directeur du Capital Humain est approuvé, et personne ne
   * traite à sa place : il l'apprend, pour confier les demandes avant de
   * partir — sinon elles l'attendront jusqu'à son retour.
   */
  private async rappelerAuDirecteur(
    tx: Tx,
    user: SessionUser,
    demande: { id: string; employeeId: string },
    att: Attendu,
  ): Promise<void> {
    const dch = att.dch;
    if (!dch?.directeur || dch.directeur.employeeId !== demande.employeeId) return;
    for (const id of await detenteursDe(tx, 'demandes.conges')) {
      if ((await membreDCH(tx, dch, id)) !== 'parti') return;
    }
    await notifier(tx, user.tenantId, dch.directeur.userId, {
      type: 'delegation',
      title: 'Les demandes de congé vous attendront jusqu’à votre retour',
      link: '/moi/delegations',
      dedupeKey: `delegation:absence:${demande.id}`,
    });
  }

  /**
   * Annuler. L'agent annule sa demande en attente, ou son congé validé tant
   * qu'il n'a pas commencé : c'est immédiat, il redevient disponible et ses
   * jours lui reviennent. La DCH annule le congé validé d'un autre, à venir,
   * en disant pourquoi. Un congé commencé ne s'annule plus : il s'écourte.
   */
  async cancel(
    user: SessionUser,
    requestId: string,
    input: AnnulerAbsenceInput = {},
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      const self = await this.selfEmployeeId(tx, user);
      const sienne = request.employeeId === self || request.requestedByUserId === user.userId;
      const aVenir = request.status === 'approved' && request.startDate > aujourdhui();
      if (sienne) {
        if (request.status !== 'pending' && !aVenir) {
          problem(
            422,
            'absence.not_cancellable',
            request.status === 'approved'
              ? 'Ce congé a déjà commencé'
              : 'Cette demande ne peut plus être annulée',
            request.status === 'approved'
              ? 'Pour revenir plus tôt, indiquez votre jour de reprise : votre N+1 le confirmera.'
              : undefined,
          );
        }
      } else {
        if (!(await this.gereLesConges(tx, user))) {
          problem(
            403,
            'absence.cancel_forbidden',
            'Vous ne pouvez annuler que vos propres demandes',
          );
        }
        if (!aVenir) {
          problem(
            422,
            'absence.not_cancellable',
            'Seul un congé validé qui n’a pas commencé s’annule',
            request.status === 'pending'
              ? 'Une demande en attente se refuse.'
              : 'Un congé en cours se rappelle.',
          );
        }
        if (!input.motif?.trim()) {
          problem(422, 'absence.motif_requis', 'Indiquez le motif de l’annulation');
        }
      }
      const d = request.status === 'approved' ? await lireDemande(tx, requestId) : null;
      await tx
        .update(t.absenceRequests)
        .set({
          status: 'cancelled',
          decidedAt: new Date(),
          repriseDemandee: null,
          annuleParUserId: sienne ? null : user.userId,
          annuleMotif: sienne ? null : input.motif!.trim(),
          updatedAt: new Date(),
        })
        .where(eq(t.absenceRequests.id, requestId));
      // Plus rien à viser ni à confirmer : les appels restés dans les boîtes s'en vont.
      await reconcilierDemande(tx, requestId);
      await reconcilierReprise(tx, requestId);
      if (d) await annoncerLeChangement(tx, d, { quoi: 'annule', parLAgent: sienne }, user.userId);
    });
  }

  /**
   * L'agent revient plus tôt : il dit le jour où il reprend. Les jours lui
   * sont rendus une fois le retour confirmé par son N+1 (la DCH, à défaut) :
   * c'est lui qui voit l'agent revenu.
   */
  async demanderReprise(
    user: SessionUser,
    requestId: string,
    input: DemanderRepriseInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      if ((await this.selfEmployeeId(tx, user)) !== request.employeeId) {
        problem(403, 'absence.reprise_la_sienne', 'Vous ne pouvez écourter que vos congés');
      }
      this.exigerEnCours(request);
      await this.exigerUneReprise(tx, request, input.reprise);
      await tx
        .update(t.absenceRequests)
        .set({ repriseDemandee: input.reprise, updatedAt: new Date() })
        .where(eq(t.absenceRequests.id, requestId));
      await reconcilierReprise(tx, requestId);
    });
  }

  /** L'agent retire sa demande de reprise, tant qu'elle n'est pas confirmée. */
  async retirerReprise(user: SessionUser, requestId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      if ((await this.selfEmployeeId(tx, user)) !== request.employeeId) {
        problem(403, 'absence.reprise_la_sienne', 'Vous ne pouvez écourter que vos congés');
      }
      if (!request.repriseDemandee) {
        problem(422, 'absence.pas_de_reprise', 'Aucune reprise en attente sur ce congé');
      }
      await tx
        .update(t.absenceRequests)
        .set({ repriseDemandee: null, updatedAt: new Date() })
        .where(eq(t.absenceRequests.id, requestId));
      await reconcilierReprise(tx, requestId);
    });
  }

  /** Le N+1 (la DCH, à défaut) confirme le retour de l'agent, ou le refuse. */
  async deciderReprise(
    user: SessionUser,
    requestId: string,
    input: DeciderRepriseInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      const reprise = request.repriseDemandee;
      if (request.status !== 'approved' || !reprise) {
        problem(422, 'absence.pas_de_reprise', 'Aucune reprise à confirmer sur ce congé');
      }
      if ((await this.selfEmployeeId(tx, user)) === request.employeeId) {
        problem(403, 'absence.propre_demande', 'Vous ne pouvez pas confirmer votre propre retour');
      }
      if (!(await this.confirmeLaReprise(tx, user, request))) {
        problem(
          403,
          'absence.reprise_reservee',
          'Ce retour attend la confirmation de son N+1',
          'À défaut de N+1 présent, la DCH le confirme.',
        );
      }
      const d = (await lireDemande(tx, requestId))!;
      if (input.decision === 'approved') {
        await this.ecourter(tx, request, reprise, { nature: 'retour', par: user.userId });
        await reconcilierReprise(tx, requestId);
        await annoncerLeChangement(
          tx,
          d,
          { quoi: 'ecourte', reprise, nature: 'retour' },
          user.userId,
        );
        return;
      }
      await tx
        .update(t.absenceRequests)
        .set({ repriseDemandee: null, updatedAt: new Date() })
        .where(eq(t.absenceRequests.id, requestId));
      await reconcilierReprise(tx, requestId);
      await annoncerLeChangement(tx, d, { quoi: 'reprise_refusee', reprise }, user.userId);
    });
  }

  /**
   * Rappeler un agent en congé : son N+1 ou la DCH écourtent le congé en
   * cours, sans son accord, en disant pourquoi. Effet immédiat.
   */
  async rappeler(user: SessionUser, requestId: string, input: RappelerInput): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      if ((await this.selfEmployeeId(tx, user)) === request.employeeId) {
        problem(
          403,
          'absence.propre_demande',
          'Pour revenir plus tôt, indiquez votre jour de reprise',
        );
      }
      if (!(await this.peutRappeler(tx, user, request.employeeId))) {
        problem(
          403,
          'absence.rappel_reserve',
          'Seuls son N+1 et la DCH rappellent un agent en congé',
        );
      }
      this.exigerEnCours(request);
      await this.exigerUneReprise(tx, request, input.reprise);
      const d = (await lireDemande(tx, requestId))!;
      await this.ecourter(tx, request, input.reprise, {
        nature: 'rappel',
        par: user.userId,
        motif: input.motif,
      });
      await reconcilierReprise(tx, requestId);
      await annoncerLeChangement(
        tx,
        d,
        { quoi: 'ecourte', reprise: input.reprise, nature: 'rappel' },
        user.userId,
      );
    });
  }

  /** La demande, verrouillée pour qu'on la change. */
  private async verrouiller(tx: Tx, requestId: string) {
    const [request] = await tx
      .select()
      .from(t.absenceRequests)
      .where(eq(t.absenceRequests.id, requestId))
      .for('update')
      .limit(1);
    if (!request) problem(404, 'absence.request_not_found', 'Demande introuvable');
    return request;
  }

  /** Un congé validé, commencé et pas encore fini : seul celui-là s'écourte. */
  private exigerEnCours(request: typeof t.absenceRequests.$inferSelect): void {
    if (request.status !== 'approved') {
      problem(422, 'absence.pas_validee', 'Seul un congé validé s’écourte');
    }
    if (request.startDate > aujourdhui()) {
      problem(
        422,
        'absence.pas_commence',
        'Ce congé n’a pas commencé',
        'Un congé qui n’a pas commencé s’annule.',
      );
    }
    if (request.endDate < aujourdhui()) {
      problem(422, 'absence.termine', 'Ce congé est terminé');
    }
  }

  /**
   * Le jour de reprise : à partir d'aujourd'hui, et avant la fin prévue du
   * congé (décidé avec l'APIX). Il reste au moins un jour ouvré de congé
   * avant lui : sinon ce n'est plus écourter, c'est annuler.
   */
  private async exigerUneReprise(
    tx: Tx,
    request: typeof t.absenceRequests.$inferSelect,
    reprise: string,
  ): Promise<void> {
    const today = aujourdhui();
    if (reprise < today || reprise >= request.endDate) {
      problem(
        422,
        'absence.reprise_hors_conge',
        'Le jour de reprise doit tomber entre aujourd’hui et la fin prévue du congé',
        `Entre le ${frDate(today)} et le ${frDate(veille(request.endDate))}.`,
      );
    }
    if ((await this.joursOuvres(tx, request.startDate, veille(reprise))) === 0) {
      problem(
        422,
        'absence.reprise_sans_conge',
        'Il ne resterait aucun jour de congé avant cette reprise',
      );
    }
  }

  /** Écourte le congé : il finit la veille de la reprise, ses jours sont recomptés. */
  private async ecourter(
    tx: Tx,
    request: typeof t.absenceRequests.$inferSelect,
    reprise: string,
    par: { nature: 'retour' | 'rappel'; par: string; motif?: string },
  ): Promise<void> {
    const fin = veille(reprise);
    const jours = await this.joursOuvres(tx, request.startDate, fin);
    await tx
      .update(t.absenceRequests)
      .set({
        endDate: fin,
        daysCount: jours.toString(),
        finInitiale: request.finInitiale ?? request.endDate,
        repriseDemandee: null,
        ecourteNature: par.nature,
        ecourteParUserId: par.par,
        ecourteLe: new Date(),
        ecourteMotif: par.motif?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(t.absenceRequests.id, request.id));
  }

  private async joursOuvres(tx: Tx, debut: string, fin: string): Promise<number> {
    if (fin < debut) return 0;
    const feries = await tx
      .select({ day: sql<string>`${t.holidays.day}` })
      .from(t.holidays)
      .where(isNotNull(t.holidays.day));
    return countWorkdays(debut, fin, new Set(feries.map((h) => h.day))).workingDays;
  }

  /**
   * Qui gère les congés pour la DCH : son directeur, les membres habilités
   * qui y sont encore. Pas l'administrateur, qui ne traite aucune demande.
   */
  private async gereLesConges(tx: Tx, user: SessionUser): Promise<boolean> {
    const moi = await this.selfEmployeeId(tx, user);
    if (!moi) return false;
    const dch = await directionDuPersonnel(tx);
    if (!dch) return false;
    if (dch.directeurEmployeeId === moi) return true;
    if (!(await detenteursDe(tx, 'demandes.conges')).includes(moi)) return false;
    return (await membreDCH(tx, dch, moi)) !== 'parti';
  }

  /** Son N+1, ou la DCH, rappellent un agent. */
  private async peutRappeler(tx: Tx, user: SessionUser, employeeId: string): Promise<boolean> {
    const moi = await this.selfEmployeeId(tx, user);
    if (!moi) return false;
    const { rows } = await tx.execute<{ n1: string | null }>(sql`
      SELECT manager_employee_id AS n1 FROM employees WHERE id = ${employeeId}`);
    // Le DG ne relève de personne : il n'a pas de N+1 qui le rappelle.
    if (rows[0]?.n1 === moi) return true;
    return this.gereLesConges(tx, user);
  }

  /** Celui qui doit confirmer ce retour, ou le directeur, qui garde la main. */
  private async confirmeLaReprise(
    tx: Tx,
    user: SessionUser,
    request: { id: string; employeeId: string },
  ): Promise<boolean> {
    const att = await attenduPourLaReprise(tx, request);
    if (att.valideurs.some((v) => v.userId === user.userId)) return true;
    const moi = await this.selfEmployeeId(tx, user);
    return Boolean(
      att.etape === 'dch' && moi && att.dch?.directeurEmployeeId === moi && !att.demandeDuDirecteur,
    );
  }

  /** Justificatif d'une demande — la DCH (données sensibles) ou le titulaire. */
  async document(
    user: SessionUser,
    requestId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [request] = await tx
        .select({
          employeeId: t.absenceRequests.employeeId,
          confieeA: t.absenceRequests.confieeAEmployeeId,
        })
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.id, requestId))
        .limit(1);
      if (!request) {
        problem(404, 'absence.request_not_found', 'Demande introuvable');
      }
      if (!peut(user, 'personnel.sensible')) {
        const self = await this.selfEmployeeId(tx, user);
        // Le titulaire ; et qui traite pour la DCH — son directeur, les
        // membres habilités aux congés, le membre à qui la demande est
        // confiée. Jamais le N+1.
        const traite = Boolean(
          self && (request.confieeA === self || (await voitToutLaFile(tx, user, 'conges'))),
        );
        if (self !== request.employeeId && !traite) {
          // Données de santé potentielles : ni managers ni paie n'y accèdent.
          problem(
            403,
            'absence.document_forbidden',
            'Justificatif réservé à la DCH et au titulaire',
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

  /** Qui consulte les dossiers, ou gère les soldes : tout dossier ; les autres, le leur. */
  private async assertEmployeeScope(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
    if (peut(user, 'personnel.consulter') || peut(user, 'conges.soldes')) return;
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
    const ids = rows.map((r) => r.request.id);

    const documentRows = await tx
      .select({ requestId: t.absenceDocuments.requestId, filename: t.absenceDocuments.filename })
      .from(t.absenceDocuments)
      .where(inArray(t.absenceDocuments.requestId, ids));

    const { rows: approvalRows } = await tx.execute<{
      request_id: string;
      level: number;
      decision: string;
      comment: string | null;
      decided_at: Date;
      nom: string;
      pour_le_compte_de: string | null;
    }>(sql`
      SELECT a.request_id, a.level, a.decision, a.comment, a.decided_at,
             u.given_name || ' ' || u.family_name AS nom,
             dp.given_name || ' ' || dp.family_name AS pour_le_compte_de
        FROM absence_approvals a
        JOIN users u ON u.id = a.decided_by_user_id
        LEFT JOIN employees de ON de.id = a.par_delegation_de
        LEFT JOIN persons dp ON dp.id = de.person_id
       WHERE a.request_id IN (${sql.join(
         ids.map((id) => sql`${id}`),
         sql`, `,
       )})
       ORDER BY a.level`);

    const moi = await this.selfEmployeeId(tx, user);
    const today = aujourdhui();
    const gere = await this.gereLesConges(tx, user);
    // Qui a écourté ou annulé, et le N+1 de chaque agent : lus une fois.
    const auteurs = [
      ...new Set(rows.flatMap(({ request: r }) => [r.ecourteParUserId, r.annuleParUserId])),
    ].filter((x): x is string => Boolean(x));
    const noms = new Map<string, string>();
    if (auteurs.length > 0) {
      const lus = await tx
        .select({ id: t.users.id, prenom: t.users.givenName, nom: t.users.familyName })
        .from(t.users)
        .where(inArray(t.users.id, auteurs));
      for (const u of lus) noms.set(u.id, `${u.prenom} ${u.nom}`);
    }
    const n1s = new Map(
      (
        await tx
          .select({ id: t.employees.id, n1: t.employees.managerEmployeeId })
          .from(t.employees)
          .where(inArray(t.employees.id, [...new Set(rows.map((r) => r.request.employeeId))]))
      ).map((e) => [e.id, e.n1]),
    );
    const vues: AbsenceRequestView[] = [];
    for (const {
      request,
      givenName,
      familyName,
      employeeNumber,
      workEmail,
      typeName,
      deductsBalance,
    } of rows) {
      const att = await attendu(tx, {
        id: request.id,
        employeeId: request.employeeId,
        status: request.status,
        currentLevel: request.currentLevel,
        confieeAEmployeeId: request.confieeAEmployeeId,
      });
      const enAttente = request.status === 'pending';
      const visas = approvalRows.filter((a) => a.request_id === request.id);
      const signe = (level: number): EtapeCircuitView | null => {
        const v = visas.find((a) => a.level === level);
        return v
          ? {
              etape: level === NIVEAU_N1 ? 'n1' : 'dch',
              etat: v.decision === 'approved' ? 'visee' : 'refusee',
              qui: v.nom,
              parDelegationDe: v.pour_le_compte_de,
              decidedAt: new Date(v.decided_at).toISOString(),
              comment: v.comment,
            }
          : null;
      };
      const vide = (etape: 'n1' | 'dch', etat: EtapeCircuitView['etat'], qui: string | null) =>
        ({
          etape,
          etat,
          qui,
          parDelegationDe: null,
          decidedAt: null,
          comment: null,
        }) satisfies EtapeCircuitView;

      // L'étape du N+1 : signée ; attendue (on dit qui) ; passée, quand la
      // demande est allée à la DCH sans lui ; sans objet si elle a été
      // annulée avant qu'il vise.
      const etapeN1 =
        signe(NIVEAU_N1) ??
        (att?.etape === 'n1'
          ? vide('n1', 'attendue', nomsDe(att.valideurs))
          : request.status === 'cancelled' && request.currentLevel === NIVEAU_N1
            ? vide('n1', 'sans_objet', null)
            : vide('n1', 'passee', null));
      // L'étape de la DCH : signée ; attendue (son traitant) ; à venir ; ou
      // sans objet — refus du N+1, annulation, congé du directeur du Capital
      // Humain que le DG vise seul.
      const etapeDCH =
        signe(NIVEAU_DCH) ??
        (att?.etape === 'dch'
          ? vide('dch', 'attendue', nomsDe(att.valideurs))
          : enAttente && !att?.demandeDuDirecteur
            ? vide('dch', 'a_venir', null)
            : vide('dch', 'sans_objet', null));

      const estDirecteur = Boolean(moi && att?.dch?.directeurEmployeeId === moi);
      const canDecide =
        enAttente &&
        moi !== request.employeeId &&
        Boolean(
          att &&
          (att.valideurs.some((v) => v.userId === user.userId) ||
            (att.etape === 'dch' && estDirecteur && !att.demandeDuDirecteur)),
        );
      const confieeA = request.confieeAEmployeeId;
      const traitement =
        att?.etape === 'dch'
          ? {
              traitants: nomsDe(att.valideurs),
              confiee:
                confieeA && confieeA !== att.dch?.directeurEmployeeId
                  ? { employeeId: confieeA, nom: await nomDe(tx, confieeA) }
                  : null,
              peutConfier: estDirecteur && !att.demandeDuDirecteur,
              aConfier: false,
              pourMoi: att.valideurs.some((v) => v.employeeId === moi),
            }
          : null;

      // Ce que l'utilisateur peut faire de ce congé, s'il est validé.
      const sienne = moi !== null && moi === request.employeeId;
      const valide = request.status === 'approved';
      const commence = valide && request.startDate <= today;
      const aVenir = valide && request.startDate > today;
      const sonN1 = Boolean(moi && n1s.get(request.employeeId) === moi);
      let repriseAttendDe: string | null = null;
      let confirmerReprise = false;
      if (valide && request.repriseDemandee) {
        const attRep = await attenduPourLaReprise(tx, request);
        repriseAttendDe = nomsDe(attRep.valideurs);
        confirmerReprise =
          !sienne &&
          (attRep.valideurs.some((v) => v.userId === user.userId) ||
            Boolean(
              attRep.etape === 'dch' &&
              moi &&
              attRep.dch?.directeurEmployeeId === moi &&
              !attRep.demandeDuDirecteur,
            ));
      }

      vues.push({
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
        currentLevel: att?.etape === 'dch' ? NIVEAU_DCH : request.currentLevel,
        etapeAttendue: att?.etape ?? null,
        circuit: [etapeN1, etapeDCH],
        canDecide,
        traitement,
        documentName: documentRows.find((d) => d.requestId === request.id)?.filename ?? null,
        finInitiale: request.finInitiale,
        ecourtement:
          request.ecourteNature === 'retour' || request.ecourteNature === 'rappel'
            ? {
                nature: request.ecourteNature,
                par: request.ecourteParUserId ? (noms.get(request.ecourteParUserId) ?? null) : null,
                le: (request.ecourteLe ?? request.updatedAt).toISOString(),
                motif: request.ecourteMotif,
              }
            : null,
        annulation:
          request.status === 'cancelled' && request.annuleParUserId
            ? { par: noms.get(request.annuleParUserId) ?? null, motif: request.annuleMotif }
            : null,
        repriseDemandee: valide ? request.repriseDemandee : null,
        repriseAttendDe,
        gestes: {
          annuler: sienne ? request.status === 'pending' || aVenir : gere && aVenir,
          demanderReprise:
            sienne && commence && request.endDate > today && !request.repriseDemandee,
          confirmerReprise,
          rappeler: !sienne && commence && request.endDate > today && (sonN1 || gere),
        },
        approvals: visas.map((a) => ({
          level: a.level,
          decision: a.decision,
          decidedByName: a.nom,
          comment: a.comment,
          decidedAt: new Date(a.decided_at).toISOString(),
        })),
        createdAt: request.createdAt.toISOString(),
      });
    }
    return vues;
  }

  private async requireEmployee(tx: Tx, id: string) {
    const [employee] = await tx.select().from(t.employees).where(eq(t.employees.id, id)).limit(1);
    if (!employee) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return employee;
  }
}
