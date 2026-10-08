import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AgentSaisieView,
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
  dansLaJournee,
  horsDeLaJournee,
  joursDHeures,
  peut,
  MAX_JUSTIFICATIF_BYTES,
  SENEGAL_FIXED_HOLIDAYS,
  SENEGAL_MOBILE_HOLIDAYS,
  type AbsenceFrequency,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { chiffrerPiece, contenuDeLaPiece, nomDeLaPiece } from '../../common/pieces-chiffrees';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { holidayDedupeKey } from '../notifications/notifications.service';
import { absence, accord, de, duAu, frDate, type Heures } from '../notifications/phrases';
import { DG } from '../people/chaine';
import { contratEchu, dernierContrat, typeDeContratAu } from '../people/en-activite';
import { notifier } from '../notifications/notifier';
import {
  detenteursDe,
  directionDuPersonnel,
  membreDCH,
  nomDe,
  nomsDe,
  pasSurSoi,
  subordonnesDe,
} from '../acces/dch';
import { aTraiterPar, voitToutLaFile } from '../acces/demandes';
import {
  aExpire,
  annoncerLeChangement,
  annoncerLeVerdict,
  attendu,
  attenduPourLaReprise,
  compterLesVisas,
  expirerLesDemandes,
  lireCircuit,
  lireDemande,
  NIVEAU_DCH,
  NIVEAU_N1,
  reconcilierDemande,
  reconcilierLeCircuit,
  reconcilierReprise,
  type Attendu,
} from './visas';
import { countWorkdays, joursParAnnee } from './workdays';

type DefaultType = {
  name: string;
  deductsBalance: boolean;
  allowanceDays: number | null;
  frequency: AbsenceFrequency;
  requiresDocument: boolean;
  resteJoignable?: boolean;
  motifConfidentiel?: boolean;
  allowsHours?: boolean;
  maxDaysPerRequest?: number;
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
    motifConfidentiel: true,
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
    resteJoignable: true,
  },
  // Quelques heures (un rendez-vous) ou un jour ou deux (un baptême, un
  // décès), sans justificatif. Trois jours ouvrés au plus, tant que la DCH
  // n'a pas fixé le sien.
  {
    name: 'Absence ponctuelle',
    deductsBalance: false,
    allowanceDays: null,
    frequency: 'none',
    requiresDocument: false,
    allowsHours: true,
    maxDaysPerRequest: 3,
  },
];

/** « 1 jour ouvré », « 3 jours ouvrés ». */
const enJoursOuvres = (n: number) => (n > 1 ? `${n} jours ouvrés` : `${n} jour ouvré`);

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/** Un justificatif : un PDF de 5 Mo au plus, sa signature le prouve. */
function lireJustificatif(input: { filename: string; contentBase64: string }): {
  filename: string;
  data: Buffer;
} {
  const data = Buffer.from(input.contentBase64, 'base64');
  if (data.length === 0 || data.length > MAX_JUSTIFICATIF_BYTES) {
    problem(422, 'absence.document_too_large', 'Le justificatif doit faire 5 Mo maximum');
  }
  if (!data.subarray(0, 5).toString().startsWith('%PDF')) {
    problem(422, 'absence.document_not_pdf', 'Le justificatif doit être un PDF');
  }
  return { filename: input.filename, data };
}

function num(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

/** Aujourd'hui, à Dakar (UTC+0, sans heure d'été). */
function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** L'heure qu'il est, à Dakar : « 14:05 ». */
function maintenant(): string {
  return new Date().toISOString().slice(11, 16);
}

/**
 * Une absence qui n'a pas commencé : elle commence demain ou plus tard ; à
 * l'heure, plus tard dans la journée aussi.
 */
function pasCommencee(r: { startDate: string; startTime: string | null }): boolean {
  const jour = aujourdhui();
  return (
    r.startDate > jour ||
    (r.startTime !== null && r.startDate === jour && r.startTime.slice(0, 5) > maintenant())
  );
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
 * Les absences du calendrier : validées, en cours ou commençant dans les
 * trente jours. Quelques heures déjà passées aujourd'hui en sortent.
 */
export const absencesDesTrenteJours = () => [
  eq(t.absenceRequests.status, 'approved'),
  gte(t.absenceRequests.endDate, sql`CURRENT_DATE`),
  lte(t.absenceRequests.startDate, sql`CURRENT_DATE + 30`),
  sql`NOT (${t.absenceRequests.endTime} IS NOT NULL AND ${t.absenceRequests.endDate} = CURRENT_DATE
           AND ${t.absenceRequests.endTime} <= LOCALTIME)`,
];

/**
 * Une demande se décompte selon le paramétrage de l'année où elle commence :
 * celui que son type avait alors, s'il a changé depuis. Le badge d'une
 * demande dit ainsi ce que le solde de son année en a fait.
 */
const decompteDeLaDemande = sql<boolean>`COALESCE(
  (SELECT p.deducts_balance FROM absence_types_passe p
    WHERE p.absence_type_id = absence_requests.absence_type_id
      AND p.jusqu_a_annee >= extract(year FROM absence_requests.start_date)
      AND extract(year FROM absence_requests.start_date) < extract(year FROM CURRENT_DATE)
    ORDER BY p.jusqu_a_annee LIMIT 1),
  absence_types.deducts_balance)`;

/** Une demande `r` qui a au moins un jour dans l'année. */
const toucheLAnnee = (annee: number) => sql`(
  r.start_date <= make_date(${annee}::int, 12, 31) AND r.end_date >= make_date(${annee}::int, 1, 1))`;

/** Les jours ouvrés d'une période, comptés comme `days_count` (week-ends et fériés exclus). */
const ouvresEntre = (debut: SQL, fin: SQL) => sql`(
  SELECT count(*) FROM generate_series(${debut}, ${fin}, interval '1 day') g(d)
   WHERE extract(isodow FROM g.d) < 6
     AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = g.d::date))`;

/**
 * Ce qu'une demande `r` retranche du solde d'une année : ses jours ouvrés
 * de cette année-là. L'année où elle commence garde le reste de `days_count`,
 * pour que les parts fassent toujours le total.
 */
const joursSurLAnnee = (annee: number) => sql`(CASE
  WHEN extract(year FROM r.start_date) = extract(year FROM r.end_date) THEN r.days_count
  WHEN extract(year FROM r.start_date) = ${annee}::int
    THEN greatest(r.days_count
           - ${ouvresEntre(sql`make_date(${annee}::int + 1, 1, 1)`, sql`r.end_date`)}, 0)
  ELSE ${ouvresEntre(
    sql`greatest(r.start_date, make_date(${annee}::int, 1, 1))`,
    sql`least(r.end_date, make_date(${annee}::int, 12, 31))`,
  )}
END)`;

/** Ce qu'un solde d'année lit d'un type d'absence. */
type TypePourSolde = {
  id: string;
  name: string;
  deductsBalance: boolean;
  allowanceDays: string | number | null;
  frequency: string;
  /** Retiré depuis : il ne figure qu'aux soldes des années où il a servi. */
  retire?: boolean;
  motifConfidentiel?: boolean;
};

/** Le droit à porter d'office sur un solde d'année : le quota annuel, s'il y en a un. */
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
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly crypto: EncryptionService = new EncryptionService(),
  ) {}

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
            resteJoignable: d.resteJoignable ?? false,
            motifConfidentiel: d.motifConfidentiel ?? false,
            allowsHours: d.allowsHours ?? false,
            maxDaysPerRequest: d.maxDaysPerRequest ?? null,
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
          resteJoignable: input.resteJoignable ?? false,
          motifConfidentiel: input.motifConfidentiel ?? false,
          allowsHours: input.allowsHours ?? false,
          maxDaysPerRequest: input.maxDaysPerRequest ?? null,
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
        .select()
        .from(t.absenceTypes)
        .where(and(eq(t.absenceTypes.id, id), isNull(t.absenceTypes.deletedAt)))
        .limit(1)
        .for('update');
      if (!row) problem(404, 'absence.type_not_found', 'Type d’absence introuvable');
      // Omis, il reste ce qu'il était, comme le motif confidentiel.
      const allowsHours = input.allowsHours ?? row.allowsHours;
      if (allowsHours && input.deductsBalance) {
        problem(
          422,
          'absence.heures_decomptees',
          'Un type décompté du solde se demande à la journée',
        );
      }
      const quota = input.allowanceDays ?? null;
      const change =
        row.deductsBalance !== input.deductsBalance ||
        row.frequency !== input.frequency ||
        (row.allowanceDays === null ? null : Number(row.allowanceDays)) !== quota;
      // Le changement vaut pour l'année en cours et les suivantes : les
      // années passées gardent le paramétrage qui les régissait. Un premier
      // changement de l'année le garde ; les suivants n'y touchent plus.
      if (change) {
        await tx.execute(sql`
          INSERT INTO absence_types_passe
            (tenant_id, absence_type_id, jusqu_a_annee, deducts_balance, allowance_days, frequency)
          VALUES (${user.tenantId}, ${id}, extract(year FROM CURRENT_DATE)::int - 1,
                  ${row.deductsBalance}, ${row.allowanceDays}, ${row.frequency})
          ON CONFLICT (absence_type_id, jusqu_a_annee) DO NOTHING`);
      }
      try {
        await tx
          .update(t.absenceTypes)
          .set({
            name: input.name,
            deductsBalance: input.deductsBalance,
            allowanceDays: input.allowanceDays?.toString() ?? null,
            frequency: input.frequency,
            requiresDocument: input.requiresDocument,
            resteJoignable: input.resteJoignable ?? false,
            // Omis, il reste ce qu'il était : un motif confidentiel ne
            // redevient pas visible par oubli.
            motifConfidentiel: input.motifConfidentiel ?? row.motifConfidentiel,
            allowsHours,
            maxDaysPerRequest:
              input.maxDaysPerRequest === undefined
                ? row.maxDaysPerRequest
                : input.maxDaysPerRequest,
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
      if (year) await this.semerAnnee(tx, user.tenantId, year);
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
      if (input.day) await this.recompterLesConges(tx, user.tenantId, [input.day]);
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
      if (row.day !== jour) {
        await this.recompterLesConges(
          tx,
          user.tenantId,
          [row.day, jour].filter((d): d is string => Boolean(d)),
        );
      }
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
      if (row.day) {
        await this.oublierRappel(tx, row.day);
        await this.recompterLesConges(tx, user.tenantId, [row.day]);
      }
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
  private async semerAnnee(tx: Tx, tenantId: string, year: number): Promise<void> {
    const marque = await tx
      .insert(t.holidaySeeds)
      .values({ tenantId, year })
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

    const poses: string[] = [];
    for (const modele of await this.modeleDAnnee(tx, year - 1)) {
      if (dejaLa.has(modele.label.toLowerCase())) continue;
      const [pose] = await tx
        .insert(t.holidays)
        .values({
          id: uuidv7(),
          tenantId,
          year,
          day: modele.fixedDate ? reporterSur(year, modele) : null,
          label: modele.label,
          fixedDate: modele.fixedDate,
        })
        // Une fête mobile a pu être datée là avant que la date civile n'y soit
        // posée : on ne l'écrase pas.
        .onConflictDoNothing()
        .returning({ day: t.holidays.day });
      if (pose?.day) poses.push(pose.day);
    }
    // Un congé posé sur cette année avant qu'elle soit semée a pu compter le
    // 1er janvier : il se recompte.
    await this.recompterLesConges(tx, tenantId, poses);
  }

  /**
   * Les fériés de la période existent avant qu'on la compte : sans quoi le
   * 1er janvier d'une année que personne n'a encore ouverte serait décompté.
   */
  private async semerLaPeriode(
    tx: Tx,
    tenantId: string,
    debut: string,
    fin: string,
  ): Promise<void> {
    for (let year = Number(debut.slice(0, 4)); year <= Number(fin.slice(0, 4)); year += 1) {
      await this.semerAnnee(tx, tenantId, year);
    }
  }

  /** Les fériés de l'année et de la suivante existent avant qu'on les lise. */
  async semerAutourDAujourdhui(tx: Tx, tenantId: string): Promise<void> {
    const annee = Number(aujourdhui().slice(0, 4));
    await this.semerAnnee(tx, tenantId, annee);
    await this.semerAnnee(tx, tenantId, annee + 1);
  }

  /**
   * Un jour devient férié, ou cesse de l'être : les congés en attente ou
   * validés qui le couvrent se recomptent, et le solde suit. Un congé qui ne
   * garde aucun jour ouvré n'a plus lieu d'être : il est annulé, et l'agent
   * le sait.
   */
  private async recompterLesConges(tx: Tx, tenantId: string, jours: string[]): Promise<void> {
    if (jours.length === 0) return;
    const { rows } = await tx.execute<{
      id: string;
      jours: number;
      user_id: string | null;
      type: string;
      debut: string;
      fin: string;
      heure_debut: string | null;
      heure_fin: string | null;
    }>(sql`
      SELECT r.id, p.user_id, ty.name AS type, r.start_date::text AS debut, r.end_date::text AS fin,
             to_char(r.start_time, 'HH24:MI') AS heure_debut,
             to_char(r.end_time, 'HH24:MI') AS heure_fin,
             (SELECT count(*)::int FROM generate_series(r.start_date, r.end_date, interval '1 day') g(d)
               WHERE extract(isodow FROM g.d) < 6
                 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = g.d::date)) AS jours
        FROM absence_requests r
        JOIN employees e ON e.id = r.employee_id
        JOIN persons p ON p.id = e.person_id
        JOIN absence_types ty ON ty.id = r.absence_type_id
       WHERE r.status IN ('pending', 'approved')
         AND EXISTS (SELECT 1 FROM unnest(${`{${jours.join(',')}}`}::date[]) j
                      WHERE j BETWEEN r.start_date AND r.end_date)`);
    for (const r of rows) {
      const heures =
        r.heure_debut && r.heure_fin ? { debut: r.heure_debut, fin: r.heure_fin } : null;
      if (r.jours > 0) {
        // Quelques heures gardent leur compte : leur jour reste ouvré.
        if (heures) continue;
        await tx.execute(sql`
          UPDATE absence_requests SET days_count = ${r.jours}
           WHERE id = ${r.id} AND days_count <> ${r.jours}`);
        continue;
      }
      await tx.execute(sql`
        UPDATE absence_requests SET status = 'cancelled', decided_at = now(), reprise_demandee = NULL
         WHERE id = ${r.id}`);
      await reconcilierDemande(tx, r.id);
      if (r.user_id) {
        const a = absence(r.type);
        await notifier(tx, tenantId, r.user_id, {
          type: 'conge_annule',
          sujet: 'conges',
          title: `Votre ${a.nom} ${duAu(r.debut, r.fin, heures)} est ${accord('annulé', a)} : ce jour est férié`,
          link: '/moi/conges/historique',
          dedupeKey: `conge:${r.id}:ferie`,
        });
      }
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
      await expirerLesDemandes(tx);
      const moi = await this.selfEmployeeId(tx, user);
      const rien = { documents: 0, informations: 0, pieces: 0, conges: 0 };
      if (!moi) return { equipe: 0, aViser: 0, aTraiter: rien };
      const { rows } = await tx.execute<{ equipe: number }>(sql`
        SELECT count(*)::int AS equipe FROM employees e
         WHERE e.manager_employee_id = ${moi}
           AND (e.status = 'active'
                -- Parti en laissant une auto-évaluation à évaluer : il reste
                -- de l'équipe le temps que son n+1 la termine.
                OR EXISTS (SELECT 1 FROM objectifs_fiches f
                            WHERE f.employee_id = e.id
                              AND f.commentaires_envoyes_le IS NOT NULL
                              AND f.evaluation_validee_le IS NULL))
           AND e.id IS DISTINCT FROM ${DG}`);
      const equipe = rows[0]?.equipe ?? 0;
      const { aViser, conges } = await compterLesVisas(tx, moi);
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
        if (
          request.employeeId !== moi &&
          (await subordonnesDe(tx, request.employeeId)).has(employeeId)
        ) {
          problem(
            422,
            'absence.confiee_au_subordonne',
            'On ne confie pas une demande à une personne placée sous celle qui la pose',
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
      await expirerLesDemandes(tx);
      await this.requireEmployee(tx, employeeId);
      await this.assertEmployeeScope(tx, user, employeeId);
      // Un type retiré garde son solde de l'année où il a servi : « rien
      // n'est effacé du passé », dit la fenêtre de retrait.
      const { rows: retires } = await tx.execute<{
        id: string;
        name: string;
        deducts_balance: boolean;
        allowance_days: string | null;
        frequency: string;
        motif_confidentiel: boolean;
      }>(sql`
        SELECT ty.id, ty.name, ty.deducts_balance, ty.allowance_days::text AS allowance_days,
               ty.frequency, ty.motif_confidentiel
          FROM absence_types ty
         WHERE ty.deleted_at IS NOT NULL
           AND (EXISTS (SELECT 1 FROM absence_requests r
                         WHERE r.absence_type_id = ty.id AND r.employee_id = ${employeeId}
                           AND r.status IN ('approved', 'pending')
                           AND ${toucheLAnnee(year)})
                OR EXISTS (SELECT 1 FROM absence_balances b
                            WHERE b.absence_type_id = ty.id AND b.employee_id = ${employeeId}
                              AND b.year = ${year}))
         ORDER BY ty.name`);
      // Les jours de maladie disent la maladie : comme le motif d'une
      // demande, ils restent à l'agent et à qui lit ses justificatifs.
      const voitLesMotifs =
        (await this.selfEmployeeId(tx, user)) === employeeId ||
        peut(user, 'personnel.sensible') ||
        ((await this.voitTout(tx, user)) && !(await this.horsDeMaMain(tx, user)).has(employeeId));
      const types: TypePourSolde[] = [
        ...(await this.selectTypes(tx)),
        ...retires.map((r) => ({
          id: r.id,
          name: r.name,
          deductsBalance: r.deducts_balance,
          allowanceDays: r.allowance_days,
          frequency: r.frequency,
          retire: true,
          motifConfidentiel: r.motif_confidentiel,
        })),
      ];
      const soldes = await this.balancesInTx(
        tx,
        user,
        employeeId,
        year,
        types.filter((ty) => voitLesMotifs || !ty.motifConfidentiel),
      );
      // Un stagiaire n'a pas de congé annuel : sa ligne n'apparaît pas, sauf
      // si des jours y sont déjà pris ou demandés. Rien du passé ne s'efface.
      const { rows: contrat } = await tx.execute<{ type: string | null }>(
        sql`SELECT ${typeDeContratAu(employeeId, sql`CURRENT_DATE`)} AS type`,
      );
      if (contrat[0]?.type !== 'stage') return soldes;
      return soldes.filter((b) => !b.deductsBalance || b.takenDays > 0 || b.pendingDays > 0);
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
      await this.semerLaPeriode(tx, user.tenantId, startDate, endDate);
      // Une fête non encore datée ne chôme rien : elle n'entre pas au décompte.
      const holidayRows = await tx
        .select({ day: sql<string>`${t.holidays.day}`, label: t.holidays.label })
        .from(t.holidays)
        .where(isNotNull(t.holidays.day));
      const feries = new Set(holidayRows.map((h) => h.day));
      const result = countWorkdays(startDate, endDate, feries);
      return {
        workingDays: result.workingDays,
        holidaysSkipped: result.holidaysSkipped.map((day) => ({
          day,
          label: holidayRows.find((h) => h.day === day)?.label ?? '',
        })),
        parAnnee: joursParAnnee(startDate, endDate, feries),
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
        // Chaque agent pose SES demandes depuis son portail. Qui traite les
        // congés pour la DCH saisit pour un agent qui ne le peut pas (sans
        // portail, hospitalisé) : la demande suit le même circuit.
        const self = await this.selfEmployeeId(tx, user);
        const pourSoi = self === input.employeeId;
        if (!pourSoi && !(await this.gereLesConges(tx, user))) {
          problem(403, 'absence.self_only', 'Vous ne pouvez poser une demande que pour vous-même');
        }
        const sonContrat = pourSoi ? 'votre contrat' : 'son contrat';
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
        // À l'heure : un jour, de telle heure à telle heure, quand le type
        // le permet. Le jour se contrôle ensuite comme une journée.
        const heures: Heures | null =
          input.startTime && input.endTime ? { debut: input.startTime, fin: input.endTime } : null;
        if (heures && !type.allowsHours) {
          problem(422, 'absence.heures_refusees', `« ${type.name} » se demande à la journée`);
        }
        if (heures && !dansLaJournee(heures.debut, heures.fin)) {
          problem(422, 'absence.hors_horaires', horsDeLaJournee);
        }

        // La période tient dans son contrat : ni avant son premier jour, ni
        // après la fin du dernier.
        const { rows: bornes } = await tx.execute<{ debut: string | null; fin: string | null }>(sql`
          SELECT (SELECT min(c.start_date)::text FROM contracts c
                   WHERE c.employee_id = ${input.employeeId}) AS debut,
                 (SELECT c.end_date::text FROM contracts c
                   WHERE c.id = ${dernierContrat(input.employeeId)}) AS fin`);
        const { debut: debutContrat, fin: finContrat } = bornes[0] ?? { debut: null, fin: null };
        if (debutContrat && input.startDate < debutContrat) {
          problem(
            422,
            'absence.hors_contrat',
            `Cette période commence avant ${sonContrat}`,
            `${pourSoi ? 'Votre' : 'Son'} contrat commence le ${frDate(debutContrat)} : commencez la demande ce jour-là au plus tôt.`,
          );
        }
        if (finContrat && input.endDate > finContrat) {
          problem(
            422,
            'absence.hors_contrat',
            `Cette période dépasse la fin de ${sonContrat}`,
            `${pourSoi ? 'Votre' : 'Son'} contrat prend fin le ${frDate(finContrat)} : terminez la demande ce jour-là au plus tard.`,
          );
        }

        // Un stage n'est pas un emploi : il n'ouvre pas de congé payé. Un type
        // qui se décompte d'un solde (le congé annuel) est fermé à qui est en
        // stage le premier jour de l'absence.
        if (type.deductsBalance) {
          const { rows: contrat } = await tx.execute<{ type: string | null }>(
            sql`SELECT ${typeDeContratAu(input.employeeId, sql`${input.startDate}::date`)} AS type`,
          );
          if (contrat[0]?.type === 'stage') {
            problem(422, 'absence.stagiaire', `« ${type.name} » n’est pas ouvert aux stagiaires`);
          }
        }

        await this.semerLaPeriode(tx, user.tenantId, input.startDate, input.endDate);
        const holidayRows = await tx
          .select({ day: sql<string>`${t.holidays.day}` })
          .from(t.holidays)
          .where(isNotNull(t.holidays.day));
        const feries = new Set(holidayRows.map((h) => h.day));
        daysCount = countWorkdays(input.startDate, input.endDate, feries).workingDays;
        if (daysCount === 0) {
          problem(
            422,
            'absence.no_working_days',
            heures ? 'Ce jour n’est pas un jour ouvré' : 'Aucun jour ouvré sur cette période',
            heures
              ? 'Le jour choisi est un week-end ou un jour férié.'
              : 'La période ne contient que des week-ends ou jours fériés.',
          );
        }
        // Le plafond du type, en jours ouvrés, que la DCH fixe.
        if (type.maxDaysPerRequest !== null && daysCount > type.maxDaysPerRequest) {
          problem(
            422,
            'absence.duree_max',
            `« ${type.name} » se demande pour ${enJoursOuvres(type.maxDaysPerRequest)} au plus`,
            `Cette période en compte ${daysCount}.`,
          );
        }
        // Quelques heures comptent pour une part de la journée.
        if (heures) daysCount = joursDHeures(heures.debut, heures.fin);

        // Le justificatif peut suivre la demande (un certificat médical
        // arrive après l'arrêt) : il n'est exigé qu'à la validation.
        const document = input.document ? lireJustificatif(input.document) : null;

        // Chaque année touchée retranche ses jours de son solde, au
        // paramétrage de cette année-là : du 28 décembre au 8 janvier, une
        // part sur chacune.
        for (const { annee, jours } of joursParAnnee(input.startDate, input.endDate, feries)) {
          const [view] = await this.balancesInTx(tx, user, input.employeeId, annee, [type]);
          if (view?.deductsBalance && jours > view.remainingDays) {
            problem(
              422,
              'absence.insufficient_balance',
              'Solde insuffisant',
              `Il reste ${view.remainingDays} jour(s) de « ${type.name} » sur ${annee} (demande : ${jours} j sur ${annee}, dont soldes en attente déjà réservés).`,
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
          startTime: heures?.debut ?? null,
          endTime: heures?.fin ?? null,
          daysCount: daysCount.toString(),
          reason: input.reason,
          requestedByUserId: user.userId,
        });
        if (document) {
          const pieceId = uuidv7();
          await tx.insert(t.absenceDocuments).values({
            id: pieceId,
            tenantId: user.tenantId,
            requestId: id,
            sizeBytes: document.data.length,
            ...chiffrerPiece(
              this.crypto,
              'absence_documents',
              { tenantId: user.tenantId, id: pieceId },
              document,
            ),
          });
        }
        // ——— Le circuit : le N+1 d'abord ; sans N+1 qui puisse viser, la
        // demande part directement à la DCH. Qui est attendu est prévenu.
        await reconcilierDemande(tx, id);
        await reconcilierLeCircuit(tx, user.tenantId);
        // Saisie pour lui : l'agent l'apprend, s'il a un compte.
        if (!pourSoi) {
          const d = await lireDemande(tx, id);
          if (d?.demandeurUserId) {
            const a = absence(d.type);
            await notifier(tx, user.tenantId, d.demandeurUserId, {
              type: 'conge_saisi',
              sujet: 'conges',
              title: `La DCH a saisi pour vous ${a.article} ${a.nom} ${duAu(d.debut, d.fin, d.heures)}`,
              link: '/moi/conges/historique',
              dedupeKey: `conge:${id}:saisie`,
            });
          }
        }
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
   * par exemple), on dit aussi le jour où la commencer. Deux absences à
   * l'heure du même jour ne se chevauchent que si leurs heures le font.
   */
  private async refuserLeChevauchement(
    user: SessionUser,
    input: CreateAbsenceRequestInput,
  ): Promise<never> {
    const candidates = await this.db.withTenant(ctxOf(user), (tx) =>
      tx
        .select({
          debut: t.absenceRequests.startDate,
          fin: t.absenceRequests.endDate,
          heureDebut: t.absenceRequests.startTime,
          heureFin: t.absenceRequests.endTime,
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
        .orderBy(asc(t.absenceRequests.startDate), asc(t.absenceRequests.startTime)),
    );
    // Le début et la fin, à la minute : une journée entière court de minuit
    // à minuit.
    const borne = (jour: string, heure: string | null | undefined, fin: boolean) =>
      heure ? `${jour}T${heure.slice(0, 5)}` : fin ? `${lendemain(jour)}T00:00` : `${jour}T00:00`;
    const debut = borne(input.startDate, input.startTime, false);
    const fin = borne(input.endDate, input.endTime, true);
    const autre = candidates.find(
      (c) => borne(c.debut, c.heureDebut, false) < fin && debut < borne(c.fin, c.heureFin, true),
    );
    if (!autre) {
      problem(
        409,
        'absence.overlap',
        'Cette période chevauche une absence déjà demandée ou approuvée',
      );
    }
    const a = absence(autre.type);
    const heures =
      autre.heureDebut && autre.heureFin
        ? { debut: autre.heureDebut.slice(0, 5), fin: autre.heureFin.slice(0, 5) }
        : null;
    const sienne = autre.statut === 'approved' ? `votre ${a.nom}` : `votre demande ${de(a.nom)}`;
    problem(
      409,
      'absence.overlap',
      `Cette période chevauche ${sienne} ${duAu(autre.debut, autre.fin, heures)}`,
      !heures && autre.debut <= input.startDate && autre.fin < input.endDate
        ? `V${sienne.slice(1)} va jusqu’au ${frDate(autre.fin)} : commencez celle-ci le ${frDate(lendemain(autre.fin))}.`
        : undefined,
    );
  }

  async listRequests(
    user: SessionUser,
    query: ListAbsenceRequestsQuery,
  ): Promise<AbsenceRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Aucune tâche ne tourne la nuit : une demande arrivée à son premier
      // jour sans réponse expire à la première lecture qui la montrerait.
      await expirerLesDemandes(tx);
      const conditions: (SQL | undefined)[] = [];
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
        // Une demande confiée ne se voit que tant qu'elle attend : traitée,
        // elle n'appartient plus à qui l'a traitée.
        conditions.push(
          sql`(${t.absenceRequests.employeeId} = ${self}
               OR (${t.absenceRequests.confieeAEmployeeId} = ${self}
                   AND ${t.absenceRequests.status} = 'pending'))`,
        );
      }

      // Ce qui attend une décision ne se coupe jamais : les demandes en
      // attente et les retours à confirmer viennent toutes ; la limite ne
      // porte que sur l'historique. Sinon les plus anciennes, que le badge
      // compte, disparaîtraient de la file.
      const ouverte = sql`(${t.absenceRequests.status} = 'pending'
        OR (${t.absenceRequests.status} = 'approved' AND ${t.absenceRequests.repriseDemandee} IS NOT NULL))`;
      const lire = (filtre: SQL) =>
        tx
          .select({
            request: t.absenceRequests,
            givenName: t.persons.givenName,
            familyName: t.persons.familyName,
            employeeNumber: t.employees.employeeNumber,
            workEmail: t.employees.workEmail,
            typeName: t.absenceTypes.name,
            deductsBalance: decompteDeLaDemande,
            requiresDocument: t.absenceTypes.requiresDocument,
            confidentiel: t.absenceTypes.motifConfidentiel,
          })
          .from(t.absenceRequests)
          .innerJoin(t.employees, eq(t.employees.id, t.absenceRequests.employeeId))
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .innerJoin(t.absenceTypes, eq(t.absenceTypes.id, t.absenceRequests.absenceTypeId))
          .where(and(...conditions, filtre))
          .orderBy(desc(t.absenceRequests.createdAt));
      const rows = [
        ...(await lire(ouverte)),
        ...(await lire(sql`NOT ${ouverte}`).limit(query.limit)),
      ].sort((a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime());

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
          deductsBalance: decompteDeLaDemande,
          requiresDocument: t.absenceTypes.requiresDocument,
          confidentiel: t.absenceTypes.motifConfidentiel,
        })
        .from(t.absenceRequests)
        .innerJoin(t.employees, eq(t.employees.id, t.absenceRequests.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .innerJoin(t.absenceTypes, eq(t.absenceTypes.id, t.absenceRequests.absenceTypeId))
        .where(and(...absencesDesTrenteJours(), ...scope))
        .orderBy(asc(t.absenceRequests.startDate));
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
      if (await aExpire(tx, requestId)) {
        problem(
          422,
          'absence.expiree',
          'Cette demande a expiré',
          'Son premier jour est arrivé sans réponse : l’agent peut en déposer une nouvelle.',
        );
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
        if (input.decision === 'approved') await this.exigerLeJustificatif(tx, requestId);
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
      sujet: 'dch.delegations',
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
      const aVenir = request.status === 'approved' && pasCommencee(request);
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
        if (!(await this.gereLeCongeDe(tx, user, request.employeeId))) {
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

  /**
   * Les agents dont le congé échappe à qui le gère pour la DCH : ses
   * supérieurs, de son N+1 au sommet. Un délégué n'annule, ne rappelle ni
   * ne touche au justificatif du congé de son chef, comme il ne le traite
   * pas seul (cf. traitementDe). Le directeur du Capital Humain garde la
   * main, et son propre congé reste traité par les membres de sa direction.
   */
  private async horsDeMaMain(tx: Tx, user: SessionUser): Promise<Set<string>> {
    const moi = await this.selfEmployeeId(tx, user);
    const dch = await directionDuPersonnel(tx);
    if (!moi || !dch || dch.directeurEmployeeId === moi) return new Set();
    const { rows } = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE chefs AS (
        SELECT e.manager_employee_id AS id, 1 AS n FROM employees e
         WHERE e.id = ${moi} AND e.manager_employee_id IS NOT NULL
        UNION
        SELECT e.manager_employee_id, c.n + 1 FROM employees e JOIN chefs c ON e.id = c.id
         WHERE e.manager_employee_id IS NOT NULL AND c.n < 50)
      SELECT id FROM chefs`);
    const chefs = new Set(rows.map((r) => r.id));
    if (dch.directeurEmployeeId) chefs.delete(dch.directeurEmployeeId);
    return chefs;
  }

  /** Gère les congés pour la DCH, et CE congé n'est pas celui d'un de ses chefs. */
  private async gereLeCongeDe(tx: Tx, user: SessionUser, employeeId: string): Promise<boolean> {
    if (!(await this.gereLesConges(tx, user))) return false;
    return !(await this.horsDeMaMain(tx, user)).has(employeeId);
  }

  /** Son N+1, ou la DCH, rappellent un agent. */
  private async peutRappeler(tx: Tx, user: SessionUser, employeeId: string): Promise<boolean> {
    const moi = await this.selfEmployeeId(tx, user);
    if (!moi) return false;
    const { rows } = await tx.execute<{ n1: string | null }>(sql`
      SELECT manager_employee_id AS n1 FROM employees WHERE id = ${employeeId}`);
    // Le DG ne relève de personne : il n'a pas de N+1 qui le rappelle.
    if (rows[0]?.n1 === moi) return true;
    return this.gereLeCongeDe(tx, user, employeeId);
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
          status: t.absenceRequests.status,
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
        // Confiée : tant qu'elle attend seulement.
        // Le congé d'un de ses chefs : ni le motif, ni la pièce (cf. horsDeMaMain).
        const traite = Boolean(
          self &&
          ((request.confieeA === self && request.status === 'pending') ||
            ((await voitToutLaFile(tx, user, 'conges')) &&
              !(await this.horsDeMaMain(tx, user)).has(request.employeeId))),
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
          id: t.absenceDocuments.id,
          tenantId: t.absenceDocuments.tenantId,
          filename: t.absenceDocuments.filename,
          contentType: t.absenceDocuments.contentType,
          data: t.absenceDocuments.data,
          cleVersion: t.absenceDocuments.cleVersion,
        })
        .from(t.absenceDocuments)
        .where(eq(t.absenceDocuments.requestId, requestId))
        .limit(1);
      if (!doc) {
        problem(404, 'absence.document_not_found', 'Aucun justificatif joint à cette demande');
      }
      return {
        filename: nomDeLaPiece(this.crypto, 'absence_documents', doc),
        contentType: doc.contentType,
        data: contenuDeLaPiece(this.crypto, 'absence_documents', doc),
      };
    });
  }

  /**
   * Le justificatif qui suit la demande : un certificat médical arrive après
   * l'arrêt, l'ordre de mission après le départ. L'agent le joint, ou qui a
   * saisi pour lui, ou la DCH. Tant que la demande attend, il se remplace ;
   * validée, il ne s'ajoute que s'il manquait.
   */
  async joindreJustificatif(
    user: SessionUser,
    requestId: string,
    input: { filename: string; contentBase64: string },
  ): Promise<void> {
    const fichier = lireJustificatif(input);
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const request = await this.verrouiller(tx, requestId);
      const self = await this.selfEmployeeId(tx, user);
      const autorise =
        request.employeeId === self ||
        request.requestedByUserId === user.userId ||
        (await this.gereLeCongeDe(tx, user, request.employeeId));
      if (!autorise) {
        problem(403, 'absence.document_forbidden', 'Justificatif réservé à la DCH et au titulaire');
      }
      const [existant] = await tx
        .select({ id: t.absenceDocuments.id })
        .from(t.absenceDocuments)
        .where(eq(t.absenceDocuments.requestId, requestId))
        .limit(1);
      const ouverte = request.status === 'pending';
      if (!ouverte && !(request.status === 'approved' && !existant)) {
        problem(
          422,
          'absence.justificatif_clos',
          'Le justificatif de cette demande ne se change plus',
          'Elle a été traitée avec celui-ci.',
        );
      }
      if (existant) {
        await tx.delete(t.absenceDocuments).where(eq(t.absenceDocuments.id, existant.id));
      }
      const pieceId = uuidv7();
      await tx.insert(t.absenceDocuments).values({
        id: pieceId,
        tenantId: user.tenantId,
        requestId,
        sizeBytes: fichier.data.length,
        ...chiffrerPiece(
          this.crypto,
          'absence_documents',
          { tenantId: user.tenantId, id: pieceId },
          fichier,
        ),
      });
    });
  }

  /**
   * Les agents pour qui la DCH peut saisir : ceux en activité, sauf
   * soi-même (on pose les siennes depuis son espace).
   */
  async agentsPourSaisie(user: SessionUser): Promise<AgentSaisieView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      if (!(await this.gereLesConges(tx, user))) {
        problem(403, 'absence.reserve_a_la_dch', 'Réservé à qui traite les congés pour la DCH');
      }
      const moi = await this.selfEmployeeId(tx, user);
      const { rows } = await tx.execute<{
        id: string;
        nom: string;
        matricule: string;
        stagiaire: boolean;
      }>(sql`
        SELECT e.id, p.given_name || ' ' || p.family_name AS nom, e.employee_number AS matricule,
               COALESCE(${typeDeContratAu(sql`e.id`, sql`CURRENT_DATE`)} = 'stage', false)
                 AS stagiaire
          FROM employees e JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
         WHERE e.status = 'active' AND NOT ${contratEchu(sql`e.id`)}
           AND e.id IS DISTINCT FROM ${moi}
         ORDER BY p.family_name, p.given_name`);
      return rows;
    });
  }

  /** Un type qui exige un justificatif n'est validé qu'avec lui. */
  private async exigerLeJustificatif(tx: Tx, requestId: string): Promise<void> {
    const { rows } = await tx.execute<{ type: string }>(sql`
      SELECT ty.name AS type FROM absence_requests r
        JOIN absence_types ty ON ty.id = r.absence_type_id AND ty.requires_document
       WHERE r.id = ${requestId}
         AND NOT EXISTS (SELECT 1 FROM absence_documents d WHERE d.request_id = r.id)`);
    const manque = rows[0];
    if (!manque) return;
    problem(
      422,
      'absence.justificatif_attendu',
      'Le justificatif manque',
      `« ${manque.type} » se valide avec son justificatif : il doit être joint d’abord.`,
    );
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
    // Qui traite les congés pour la DCH lit le solde de qui il saisit.
    if (await this.gereLesConges(tx, user)) return;
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
        resteJoignable: t.absenceTypes.resteJoignable,
        motifConfidentiel: t.absenceTypes.motifConfidentiel,
        allowsHours: t.absenceTypes.allowsHours,
        maxDaysPerRequest: t.absenceTypes.maxDaysPerRequest,
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

  /**
   * Le paramétrage qui régissait une année passée : celui que chaque type
   * avait alors, s'il a changé depuis (cf. `updateType`). Pour l'année en
   * cours et les suivantes, le type tel qu'il est.
   */
  private async parametrageDeLAnnee<T extends TypePourSolde>(
    tx: Tx,
    types: T[],
    year: number,
  ): Promise<T[]> {
    const { rows } = await tx.execute<{
      absence_type_id: string;
      deducts_balance: boolean;
      allowance_days: string | null;
      frequency: string;
    }>(sql`
      SELECT DISTINCT ON (absence_type_id) absence_type_id, deducts_balance,
             allowance_days::text AS allowance_days, frequency
        FROM absence_types_passe
       WHERE jusqu_a_annee >= ${year} AND ${year} < extract(year FROM CURRENT_DATE)
       ORDER BY absence_type_id, jusqu_a_annee`);
    return types.map((type) => {
      const passe = rows.find((r) => r.absence_type_id === type.id);
      return passe
        ? {
            ...type,
            deductsBalance: passe.deducts_balance,
            allowanceDays: passe.allowance_days,
            frequency: passe.frequency,
          }
        : type;
    });
  }

  /** Les soldes d'une année, dans une transaction déjà ouverte. */
  private async balancesInTx(
    tx: Tx,
    _user: SessionUser,
    employeeId: string,
    year: number,
    typesActuels: TypePourSolde[],
  ): Promise<BalanceView[]> {
    const types = await this.parametrageDeLAnnee(tx, typesActuels, year);
    const balanceRows = await tx
      .select()
      .from(t.absenceBalances)
      .where(and(eq(t.absenceBalances.employeeId, employeeId), eq(t.absenceBalances.year, year)));
    // Les demandes qui touchent l'année, pour leurs jours de cette année-là.
    const { rows: sums } = await tx.execute<{
      absenceTypeId: string;
      status: string;
      days: string;
    }>(sql`
      SELECT r.absence_type_id AS "absenceTypeId", r.status,
             coalesce(sum(${joursSurLAnnee(year)}), 0)::text AS days
        FROM absence_requests r
       WHERE r.employee_id = ${employeeId}
         AND r.status IN ('approved', 'pending')
         AND ${toucheLAnnee(year)}
       GROUP BY r.absence_type_id, r.status`);

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
        retire: Boolean(type.retire),
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
      requiresDocument: boolean;
      confidentiel: boolean;
    }>,
  ): Promise<AbsenceRequestView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.request.id);

    const documentRows = (
      await tx
        .select({
          id: t.absenceDocuments.id,
          tenantId: t.absenceDocuments.tenantId,
          requestId: t.absenceDocuments.requestId,
          filename: t.absenceDocuments.filename,
          cleVersion: t.absenceDocuments.cleVersion,
        })
        .from(t.absenceDocuments)
        .where(inArray(t.absenceDocuments.requestId, ids))
    ).map((d) => ({
      requestId: d.requestId,
      filename: nomDeLaPiece(this.crypto, 'absence_documents', d),
    }));

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
    const gereLesConges = await this.gereLesConges(tx, user);
    const horsDeMaMain = await this.horsDeMaMain(tx, user);
    // Un motif confidentiel (la maladie) : l'agent et qui ouvre son
    // justificatif le lisent, cf. `document`. Le N+1, le tableau de bord,
    // qui consulte les dossiers voient une absence.
    const sensible = peut(user, 'personnel.sensible');
    const voitLaFile = await this.voitTout(tx, user);
    // Qui a écourté ou annulé, et le N+1 de chaque agent : lus une fois.
    const auteurs = [
      ...new Set(
        rows.flatMap(({ request: r }) => [
          r.ecourteParUserId,
          r.annuleParUserId,
          r.requestedByUserId,
        ]),
      ),
    ].filter((x): x is string => Boolean(x));
    // Le compte de chaque agent : une demande saisie par un autre le dit.
    const comptes = new Map(
      (
        await tx
          .select({ id: t.employees.id, userId: t.persons.userId })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(inArray(t.employees.id, [...new Set(rows.map((r) => r.request.employeeId))]))
      ).map((e) => [e.id, e.userId]),
    );
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
      requiresDocument,
      confidentiel,
    } of rows) {
      const att = await attendu(tx, {
        id: request.id,
        employeeId: request.employeeId,
        status: request.status,
        currentLevel: request.currentLevel,
        confieeAEmployeeId: request.confieeAEmployeeId,
        deposeeLe: request.createdAt,
        debut: request.startDate,
      });
      const enAttente = request.status === 'pending';
      const expiree = request.status === 'expired';
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

      // L'étape du N+1 : signée ; attendue (on dit qui) ; sans réponse, quand
      // le délai a passé (la demande est allée à la DCH, ou a expiré) ;
      // passée, quand la demande est allée à la DCH sans lui ; sans objet si
      // elle a été annulée avant qu'il vise.
      const etapeN1 =
        signe(NIVEAU_N1) ??
        (att?.etape === 'n1'
          ? vide('n1', 'attendue', nomsDe(att.valideurs))
          : request.n1SansReponse || att?.n1SansReponse
            ? vide('n1', 'sans_reponse', null)
            : expiree && request.currentLevel === NIVEAU_N1
              ? vide('n1', 'sans_reponse', null)
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
            : expiree && request.currentLevel >= NIVEAU_DCH
              ? vide('dch', 'sans_reponse', null)
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
      const gere = gereLesConges && !horsDeMaMain.has(request.employeeId);
      const motif =
        !confidentiel ||
        sensible ||
        (voitLaFile && !horsDeMaMain.has(request.employeeId)) ||
        sienne ||
        request.requestedByUserId === user.userId ||
        (moi !== null && request.confieeAEmployeeId === moi && request.status === 'pending');
      const justificatif = documentRows.find((d) => d.requestId === request.id)?.filename ?? null;
      const valide = request.status === 'approved';
      const aVenir = valide && pasCommencee(request);
      const commence = valide && !aVenir;
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
        absenceTypeId: motif ? request.absenceTypeId : null,
        absenceTypeName: motif ? typeName : 'Absence',
        deductsBalance,
        startDate: request.startDate,
        endDate: request.endDate,
        startTime: request.startTime?.slice(0, 5) ?? null,
        endTime: request.endTime?.slice(0, 5) ?? null,
        daysCount: num(request.daysCount),
        reason: motif ? request.reason : null,
        status: request.status,
        currentLevel: att?.etape === 'dch' ? NIVEAU_DCH : request.currentLevel,
        etapeAttendue: att?.etape ?? null,
        circuit: [etapeN1, etapeDCH],
        canDecide,
        traitement,
        documentName: motif ? justificatif : null,
        justificatifAttendu:
          motif && requiresDocument && request.status === 'pending' && !justificatif,
        saisiePar:
          request.requestedByUserId && request.requestedByUserId !== comptes.get(request.employeeId)
            ? (noms.get(request.requestedByUserId) ?? null)
            : null,
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
          // Le justificatif qui suit la demande : l'agent, qui l'a saisie
          // pour lui, ou la DCH ; tant qu'elle attend, ou validée sans lui.
          joindreJustificatif:
            (request.status === 'pending' || (valide && !justificatif)) &&
            (sienne || request.requestedByUserId === user.userId || gere),
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
