import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ancienneteEnLettres,
  autoEvaluationSchema,
  autoEvaluationRelue,
  autoEvaluationTransmise,
  autoEvaluationVide,
  ceQuiManqueALAutoEvaluation,
  ceQuiManqueALEvaluationDuN1,
  competencesDe,
  evaluationDuN1Schema,
  evaluationDuN1Vide,
  nomDeLaFiche,
  objectifEvalueSchema,
  partieReserveeSchema,
  partieReserveeVide,
  personnelDeLaFiche,
  peut,
  sansLignesVides,
  type AccueilDeLaCampagne,
  type AdministrationDeLaCampagne,
  type AgentACommenter,
  type AgentDeLaCampagne,
  type AgentDeLEquipe,
  type AutoDeLAgent,
  type AutoEvaluation,
  type CommentairesDuN2,
  type DatesDeLaCampagne,
  type EcritureDeLEvaluation,
  type EtapeDeLaFiche,
  type EvaluateurDeLAgent,
  type EtatDeLaTransmission,
  type EtatDeLEvaluation,
  type EtatDeMonEvaluation,
  type EtatDesCommentaires,
  type EvaluationDeLAgent,
  type EvaluationDuN1,
  type EvaluationRecue,
  type FichePourLaDCH,
  type FichePourLeN2,
  type MonAutoEvaluation,
  type MonEvaluation,
  type ObjectifEvalue,
  type PartieReservee,
  type PeriodeDeLaCampagne,
  type PersonneDeLaCampagne,
  type PersonneDesignee,
  type PersonnelDeLaFiche,
  type PhaseDeLaCampagne,
  type RenvoiDeLEvaluation,
  type SessionUser,
  type SuiviDeLaDCH,
} from '@teranga/contracts';
import { v7 as uuidv7 } from 'uuid';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { ficheDEntretienPdf, type DonneesDeLaFiche } from '../entretiens/fiche-pdf';
import { evaluable } from '../evaluations/circuit';
import { unitesDe } from '../evaluations/unites';
import { directionDeLUnite } from '../people/chaine';

/* ────────────────────────────────────────────────────────────────
   La campagne d'évaluation annuelle (ADR-0211, ADR-0215).

   À l'accueil, la personne connectée lit sa fiche, comme celle de son
   dossier, l'état de son auto-évaluation, et les agents qu'évalue cette
   personne, avec l'état de chaque auto-évaluation. L'évaluateur d'un agent :
   le choix de l'administration pour la campagne, sinon le N+1 dans
   l'organigramme. Ce choix ne touche pas à l'organigramme.

   L'auto-évaluation s'écrit sur sa propre fiche seulement, pendant sa
   période, et se garde en brouillon jusqu'à sa transmission au N+1 : elle
   ne change plus ensuite. Le N+1 la lit une fois transmise, jamais avant.

   L'évaluation du N+1 s'écrit ensuite, par l'évaluateur de l'agent et par
   personne d'autre, pendant la période de l'année, en brouillon puis
   transmise à l'agent (ADR-0216). La partie réservée à la hiérarchie se
   garde à part : l'agent ne la lit jamais.

   L'agent lit l'évaluation transmise, puis la valide : elle ne change
   plus. En désaccord, l'agent la renvoie au N+1 avec un mot, tant que le
   N+1 peut encore la reprendre ; le N+1 la corrige et la transmet de
   nouveau (ADR-0217).

   Validée par l'agent, la fiche arrive chez le N+2, l'évaluateur du N+1 :
   le N+2 la lit en entier, partie réservée comprise, la commente s'il y a
   lieu, et transmet ses commentaires au N+1 (ADR-0218).

   Le N+1 transmet ensuite la fiche à la DCH : une fois les commentaires du
   N+2 reçus, ou dès la validation de l'agent sans N+2. Un N+2 qui tarde ne
   bloque rien : le N+1 reprend la fiche au N+2, puis la transmet, ou la
   renvoie au N+2. La DCH, avec l'habilitation « Tableau de bord », suit toutes
   les fiches de l'année et lit en entier celles qui lui sont transmises,
   avec leur PDF (ADR-0221).
   ──────────────────────────────────────────────────────────────── */

/** L'évaluateur de la campagne, sur un agent `e` et sa fiche de l'année `f`. */
const EVALUATEUR = sql`COALESCE(f.evaluateur_employee_id, e.manager_employee_id)`;

/** L'état d'une auto-évaluation : transmise, commencée, ou encore à faire. */
const autoDe = (commencee: boolean, transmiseLe: string | null): AutoDeLAgent => ({
  etat: transmiseLe ? 'transmise' : commencee ? 'en_cours' : 'a_faire',
  transmiseLe,
});

@Injectable()
export class CampagneService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Ce que l'accueil montre à la personne connectée. */
  async accueil(user: SessionUser): Promise<AccueilDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const annee = await anneeDeLaCampagne(tx);
      const { periode, phase } = await periodeDe(tx, annee);
      const moi = await employeDuCompte(tx, user.userId);
      const dch = peut(user, 'pilotage') ? await suiviEnBref(tx, annee) : null;
      if (!moi) {
        return {
          annee,
          periode,
          phase,
          moi: null,
          equipe: [],
          monEvaluation: null,
          aCommenter: [],
          dch,
          administration: user.role === 'admin',
        };
      }
      const fiche = await ficheDe(tx, moi, annee);
      return {
        annee,
        periode,
        phase,
        moi: fiche,
        equipe: await equipeDe(tx, moi, annee, fiche.evaluateur !== null),
        monEvaluation: fiche.auto ? evaluationRecue(await ficheDeLAnnee(tx, moi, annee)) : null,
        aCommenter: await aCommenterDe(tx, moi, annee),
        dch,
        administration: user.role === 'admin',
      };
    });
  }

  /**
   * Un agent de l'équipe, ouvert par son évaluateur depuis sa carte. Hors de
   * l'équipe de la personne connectée, l'agent reste introuvable : la
   * réponse ne dit pas si ce dossier existe.
   */
  async agentDeLEquipe(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      agentDans(tx, user, employeeId),
    );
  }

  /** Le brouillon de l'évaluation d'un agent de son équipe, gardé tel qu'il est. */
  async enregistrerEvaluation(
    user: SessionUser,
    employeeId: string,
    ecriture: EcritureDeLEvaluation,
  ): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireEvaluation(tx, user, employeeId, ecriture, false);
      return agentDans(tx, user, employeeId);
    });
  }

  /**
   * L'évaluation, complète, transmise à l'agent : elle ne change plus.
   * Incomplète, elle reste en brouillon et la réponse dit ce qui manque.
   */
  async transmettreEvaluation(
    user: SessionUser,
    employeeId: string,
    ecriture: EcritureDeLEvaluation,
  ): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireEvaluation(tx, user, employeeId, ecriture, true);
      return agentDans(tx, user, employeeId);
    });
  }

  /** La fiche d'un agent dont la personne connectée est le N+2, pour la commenter (ADR-0218). */
  async ficheDuN2(user: SessionUser, employeeId: string): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      ficheDuN2Dans(tx, user, employeeId),
    );
  }

  /** Le brouillon des commentaires du N+2, gardé tel qu'il est. */
  async enregistrerCommentaires(
    user: SessionUser,
    employeeId: string,
    commentaires: string,
  ): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireCommentaires(tx, user, employeeId, commentaires, false);
      return ficheDuN2Dans(tx, user, employeeId);
    });
  }

  /** Les commentaires du N+2, transmis au N+1, avec ou sans un mot : ils ne changent plus. */
  async transmettreCommentaires(
    user: SessionUser,
    employeeId: string,
    commentaires: string,
  ): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireCommentaires(tx, user, employeeId, commentaires, true);
      return ficheDuN2Dans(tx, user, employeeId);
    });
  }

  /** Le N+1 transmet la fiche à la DCH : elle ne change plus (ADR-0221). */
  async transmettreALaDCH(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await transmettreALaDCHDans(tx, user, employeeId);
      return agentDans(tx, user, employeeId);
    });
  }

  /** Le N+1 reprend la fiche au N+2 qui ne l'a pas encore commentée. */
  async reprendreAuN2(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await reprendreAuN2Dans(tx, user, employeeId);
      return agentDans(tx, user, employeeId);
    });
  }

  /** La fiche reprise repart au N+2. */
  async renvoyerAuN2(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await renvoyerAuN2Dans(tx, user, employeeId);
      return agentDans(tx, user, employeeId);
    });
  }

  /** Le suivi de la DCH : chaque agent à évaluer cette année, et où en est sa fiche. */
  async suiviDeLaDCH(user: SessionUser): Promise<SuiviDeLaDCH> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      suiviDans(tx, user),
    );
  }

  /** La fiche d'un agent, transmise à la DCH, en entier. */
  async ficheDeLaDCH(user: SessionUser, employeeId: string): Promise<FichePourLaDCH> {
    const { fiche } = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      (tx) => ficheDeLaDCHDans(tx, user, employeeId),
    );
    return fiche;
  }

  /** Le PDF de la fiche transmise : la version complète, pour le dossier de l'agent. */
  async pdfDeLaDCH(
    user: SessionUser,
    employeeId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const lue = await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      ficheDeLaDCHDans(tx, user, employeeId),
    );
    return {
      filename: nomDeLaFiche(lue.fiche.annee, lue.fiche.agent.matricule, true),
      pdf: await ficheDEntretienPdf(donneesDuPdf(lue)),
    };
  }

  /** L'administration de la campagne : les dates, et qui évalue qui (ADR-0222). */
  async administration(user: SessionUser): Promise<AdministrationDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      administrationDans(tx, user),
    );
  }

  /** Les dates de l'évaluation de l'année. */
  async fixerLesDates(
    user: SessionUser,
    dates: DatesDeLaCampagne,
  ): Promise<AdministrationDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await fixerLesDatesDans(tx, user, dates);
      return administrationDans(tx, user);
    });
  }

  /** L'évaluateur d'un agent pour la campagne ; `null` : le N+1 de l'organigramme. */
  async choisirLEvaluateur(
    user: SessionUser,
    employeeId: string,
    evaluateurId: string | null,
  ): Promise<AdministrationDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await choisirLEvaluateurDans(tx, user, employeeId, evaluateurId);
      return administrationDans(tx, user);
    });
  }

  /** Son évaluation par le N+1, pour la lire, puis la valider ou la renvoyer (ADR-0217). */
  async monEvaluation(user: SessionUser): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      monEvaluationDans(tx, user),
    );
  }

  /** L'agent valide son évaluation : elle ne change plus. */
  async validerMonEvaluation(user: SessionUser): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await validerMonEvaluationDans(tx, user);
      return monEvaluationDans(tx, user);
    });
  }

  /** En désaccord, l'agent renvoie son évaluation au N+1, avec un mot. */
  async renvoyerMonEvaluation(user: SessionUser, mot: string): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await renvoyerMonEvaluationDans(tx, user, mot);
      return monEvaluationDans(tx, user);
    });
  }

  /** Son auto-évaluation, pour son formulaire. */
  async monAuto(user: SessionUser): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      monAutoDans(tx, user),
    );
  }

  /** Le brouillon de son auto-évaluation, gardé tel qu'il est. */
  async enregistrerMonAuto(user: SessionUser, auto: AutoEvaluation): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireMonAuto(tx, user, auto, false);
      return monAutoDans(tx, user);
    });
  }

  /**
   * Son auto-évaluation, complète, transmise au N+1 : elle ne change plus.
   * Incomplète, elle reste en brouillon et la réponse dit ce qui manque.
   */
  async transmettreMonAuto(user: SessionUser, auto: AutoEvaluation): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireMonAuto(tx, user, auto, true);
      return monAutoDans(tx, user);
    });
  }
}

/** L'évaluation du N+1 s'écrit du début à la fin de la période de l'année. */
const evaluationOuverte = (phase: PhaseDeLaCampagne) =>
  phase === 'auto_evaluation' || phase === 'evaluation';

/** Un agent de l'équipe de la personne connectée ; hors de son équipe, introuvable. */
async function agentDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<EvaluationDeLAgent> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  const { periode, phase } = await periodeDe(tx, annee);
  const agent = await ficheDe(tx, employeeId, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const autoTransmise = agent.auto?.etat === 'transmise';
  const etatDeLEvaluation = etatSurLaFiche(annuelle);
  const n2 = await n2De(tx, employeeId, annee);
  return {
    annee,
    periode,
    phase,
    agent,
    objectifs: annuelle.objectifs,
    // Le brouillon reste à l'agent : le N+1 ne lit que la version transmise.
    autoEvaluation: autoTransmise ? annuelle.auto : null,
    evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
    reservee: annuelle.reservee ?? partieReserveeVide(),
    etatDeLEvaluation,
    evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
    valideeLe: annuelle.valideeLe,
    renvoi: etatDeLEvaluation === 'renvoyee' ? annuelle.renvoi : null,
    n2: n2?.personne ?? null,
    etatDesCommentaires: n2 ? etatDesCommentaires(annuelle) : null,
    // Le brouillon du N+2 reste au N+2 : le N+1 ne lit que ce qui est transmis.
    commentairesDuN2: annuelle.commentairesDuN2,
    repriseAuN2Le: n2 ? annuelle.repriseAuN2Le : null,
    dch: etatDeLaTransmission(annuelle, n2 !== null),
    transmiseALaDCHLe: annuelle.transmiseALaDCHLe,
    modifiable:
      autoTransmise &&
      evaluationOuverte(phase) &&
      etatDeLEvaluation !== 'transmise' &&
      etatDeLEvaluation !== 'validee',
  };
}

/**
 * Écrit l'évaluation d'un agent de son équipe : le brouillon, ou la version
 * transmise, une fois complète. Seulement l'auto-évaluation transmise,
 * pendant la période de l'année, et tant que l'évaluation ne l'est pas.
 */
async function ecrireEvaluation(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  { evaluation, reservee }: EcritureDeLEvaluation,
  transmettre: boolean,
): Promise<void> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  const agent = await ficheDe(tx, employeeId, annee);
  if (agent.auto?.etat !== 'transmise') {
    problem(
      409,
      'campagne.auto_non_transmise',
      'L’auto-évaluation de l’agent n’est pas encore transmise',
    );
  }
  const { phase } = await periodeDe(tx, annee);
  if (!evaluationOuverte(phase)) {
    problem(409, 'campagne.evaluation_fermee', 'L’évaluation n’est pas ouverte');
  }
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (annuelle.valideeLe) {
    problem(409, 'campagne.evaluation_validee', 'Évaluation déjà validée par l’agent');
  }
  if (annuelle.evaluationTransmiseLe) {
    problem(409, 'campagne.evaluation_transmise', 'Évaluation déjà transmise');
  }
  const personnel = personnelDeLaFiche(agent.personnel);
  const surLaFiche = evaluationSurLaFiche(evaluation, annuelle.objectifs, personnel);
  // Transmise, l'évaluation part sans les lignes de ses tableaux restées vides.
  const propre = transmettre ? sansLignesVides(surLaFiche) : surLaFiche;
  if (transmettre) {
    const manque = ceQuiManqueALEvaluationDuN1(propre, reservee, annuelle.objectifs, personnel);
    if (manque.length > 0) {
      problem(
        422,
        'campagne.evaluation_incomplete',
        'Évaluation incomplète',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  // La ligne existe : l'auto-évaluation transmise l'a créée. Transmise,
  // l'évaluation ne se réécrit plus, même par deux envois qui se croisent.
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET evaluation = ${JSON.stringify(propre)}::jsonb,
           reservee = ${JSON.stringify(reservee)}::jsonb,
           evaluation_par_employee_id = ${moi},
           evaluation_transmise_le = ${transmettre ? sql`now()` : sql`NULL`},
           updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND evaluation_transmise_le IS NULL`);
}

/** De ce qu'écrit le N+1, les objectifs de la fiche et les compétences de l'agent seulement. */
function evaluationSurLaFiche(
  e: EvaluationDuN1,
  objectifs: readonly ObjectifEvalue[],
  personnel: PersonnelDeLaFiche,
): EvaluationDuN1 {
  const ids = new Set(objectifs.map((o) => o.id));
  const cles = new Set<string>(competencesDe(personnel).map((c) => c.cle));
  return {
    ...e,
    objectifs: Object.fromEntries(Object.entries(e.objectifs).filter(([id]) => ids.has(id))),
    competences: Object.fromEntries(
      Object.entries(e.competences).filter(([cle]) => cles.has(cle)),
    ) as EvaluationDuN1['competences'],
  };
}

/** Le dossier de la personne connectée, évalué cette année ; sinon, introuvable. */
async function monDossierEvalue(
  tx: Tx,
  user: SessionUser,
  annee: number,
): Promise<{ id: string; fiche: AgentDeLaCampagne; auto: AutoDeLAgent }> {
  const id = await employeDuCompte(tx, user.userId);
  const fiche = id ? await ficheDe(tx, id, annee) : null;
  if (!id || !fiche?.auto) {
    problem(404, 'campagne.sans_auto_evaluation', 'Aucune auto-évaluation pour ce compte');
  }
  return { id, fiche, auto: fiche.auto };
}

async function monAutoDans(tx: Tx, user: SessionUser): Promise<MonAutoEvaluation> {
  const annee = await anneeDeLaCampagne(tx);
  const { fiche, auto, id } = await monDossierEvalue(tx, user, annee);
  const { periode, phase } = await periodeDe(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  return {
    annee,
    periode,
    phase,
    objectifs: annuelle.objectifs,
    auto: annuelle.auto ?? autoEvaluationVide(),
    etat: auto.etat,
    transmiseLe: auto.transmiseLe,
    evaluateur: fiche.evaluateur,
    modifiable: phase === 'auto_evaluation' && auto.etat !== 'transmise',
  };
}

/**
 * Écrit son auto-évaluation : le brouillon, ou la version transmise, une
 * fois complète. Seulement pendant l'auto-évaluation, et tant qu'elle n'est
 * pas transmise.
 */
async function ecrireMonAuto(
  tx: Tx,
  user: SessionUser,
  auto: AutoEvaluation,
  transmettre: boolean,
): Promise<void> {
  const annee = await anneeDeLaCampagne(tx);
  const { id, auto: etat } = await monDossierEvalue(tx, user, annee);
  const { phase } = await periodeDe(tx, annee);
  if (phase !== 'auto_evaluation') {
    problem(409, 'campagne.auto_fermee', 'L’auto-évaluation n’est pas ouverte');
  }
  if (etat.etat === 'transmise') {
    problem(409, 'campagne.auto_transmise', 'Auto-évaluation déjà transmise');
  }
  const { objectifs } = await ficheDeLAnnee(tx, id, annee);
  const propre = surLesObjectifs(auto, objectifs);
  if (transmettre) {
    const manque = ceQuiManqueALAutoEvaluation(propre, objectifs);
    if (manque.length > 0) {
      problem(
        422,
        'campagne.auto_incomplete',
        'Auto-évaluation incomplète',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  // Transmise, elle part sans ses puces vides ni la liste d'un non (ADR-0238).
  const ecrite = transmettre ? autoEvaluationTransmise(propre) : propre;
  // La ligne de l'année se crée au premier enregistrement. Transmise, elle
  // ne se réécrit plus, même par deux envois qui se croisent.
  await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, auto, auto_transmise_le)
    VALUES (${uuidv7()}, ${user.tenantId}, ${id}, ${annee}, ${JSON.stringify(ecrite)}::jsonb,
            ${transmettre ? sql`now()` : sql`NULL`})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET auto = EXCLUDED.auto,
           auto_transmise_le = EXCLUDED.auto_transmise_le,
           updated_at = now()
     WHERE fiches_entretien.auto_transmise_le IS NULL`);
}

/** De ce qu'écrit l'agent, les appréciations des objectifs de sa fiche seulement. */
function surLesObjectifs(
  auto: AutoEvaluation,
  objectifs: readonly ObjectifEvalue[],
): AutoEvaluation {
  const ids = new Set(objectifs.map((o) => o.id));
  return {
    ...auto,
    objectifs: Object.fromEntries(Object.entries(auto.objectifs).filter(([id]) => ids.has(id))),
  };
}

/** La fiche de l'année d'un agent, telle qu'elle est écrite. */
interface FicheDeLAnnee {
  objectifs: ObjectifEvalue[];
  /** `null` tant que rien n'est écrit. */
  auto: AutoEvaluation | null;
  evaluation: EvaluationDuN1 | null;
  reservee: PartieReservee | null;
  /** AAAA-MM-JJ. */
  evaluationTransmiseLe: string | null;
  /** AAAA-MM-JJ : la validation par l'agent. */
  valideeLe: string | null;
  /** Le dernier renvoi de l'agent au N+1, s'il y en a eu un. */
  renvoi: RenvoiDeLEvaluation | null;
  /** Le brouillon des commentaires du N+2 ; `null` tant que rien n'est écrit. */
  commentairesN2: string | null;
  /** Les commentaires du N+2, une fois transmis au N+1. */
  commentairesDuN2: CommentairesDuN2 | null;
  /** AAAA-MM-JJ : la reprise au N+2, tant que la fiche n'est pas renvoyée au N+2. */
  repriseAuN2Le: string | null;
  /** AAAA-MM-JJ : la transmission à la DCH. */
  transmiseALaDCHLe: string | null;
  /** Le N+1 qui l'a transmise. */
  transmisePar: PersonneDeLaCampagne | null;
}

/**
 * La fiche de l'année d'un agent : ses objectifs, son auto-évaluation,
 * l'évaluation du N+1 et la partie réservée. Ce que la base garde se relit
 * au contrat ; un champ qui manque reprend sa valeur vide.
 */
async function ficheDeLAnnee(tx: Tx, employeeId: string, annee: number): Promise<FicheDeLAnnee> {
  const { rows } = await tx.execute<{
    objectifs: unknown;
    auto: unknown;
    evaluation: unknown;
    reservee: unknown;
    evaluation_transmise_le: string | null;
    validee_le: string | null;
    renvoyee_le: string | null;
    renvoi_mot: string | null;
    commentaires_n2: string | null;
    commentaires_n2_le: string | null;
    n2_prenom: string | null;
    n2_nom: string | null;
    n2_poste: string | null;
    reprise_n2_le: string | null;
    transmise_dch_le: string | null;
    t_prenom: string | null;
    t_nom: string | null;
    t_poste: string | null;
  }>(sql`
    SELECT f.objectifs, f.auto, f.evaluation, f.reservee,
           f.evaluation_transmise_le::date::text AS evaluation_transmise_le,
           f.validee_le::date::text AS validee_le, f.renvoyee_le::date::text AS renvoyee_le,
           f.renvoi_mot, f.commentaires_n2,
           f.commentaires_n2_transmis_le::date::text AS commentaires_n2_le,
           pc.given_name AS n2_prenom, pc.family_name AS n2_nom, ac.position_title AS n2_poste,
           f.reprise_n2_le::date::text AS reprise_n2_le,
           f.transmise_dch_le::date::text AS transmise_dch_le,
           pt.given_name AS t_prenom, pt.family_name AS t_nom, atr.position_title AS t_poste
      FROM fiches_entretien f
      LEFT JOIN employees c ON c.id = f.commentaires_n2_par
      LEFT JOIN persons pc ON pc.id = c.person_id
      LEFT JOIN assignments ac ON ac.employee_id = c.id AND ac.validity @> CURRENT_DATE
      LEFT JOIN employees t ON t.id = f.transmise_dch_par
      LEFT JOIN persons pt ON pt.id = t.person_id
      LEFT JOIN assignments atr ON atr.employee_id = t.id AND atr.validity @> CURRENT_DATE
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee}`);
  const r = rows[0];
  const objectifs = objectifEvalueSchema.array().safeParse(r?.objectifs ?? []);
  const auto = r?.auto ? autoEvaluationSchema.partial().safeParse(r.auto) : null;
  const evaluation = r?.evaluation ? evaluationDuN1Schema.partial().safeParse(r.evaluation) : null;
  const reservee = r?.reservee ? partieReserveeSchema.partial().safeParse(r.reservee) : null;
  return {
    objectifs: objectifs.success ? objectifs.data : [],
    auto: auto?.success ? autoEvaluationRelue(auto.data) : null,
    evaluation: evaluation?.success ? { ...evaluationDuN1Vide(), ...evaluation.data } : null,
    reservee: reservee?.success ? { ...partieReserveeVide(), ...reservee.data } : null,
    evaluationTransmiseLe: r?.evaluation_transmise_le ?? null,
    valideeLe: r?.validee_le ?? null,
    renvoi: r?.renvoyee_le ? { mot: r.renvoi_mot ?? '', le: r.renvoyee_le } : null,
    commentairesN2: r?.commentaires_n2 ?? null,
    commentairesDuN2: r?.commentaires_n2_le
      ? {
          texte: r.commentaires_n2 ?? '',
          le: r.commentaires_n2_le,
          par: r.n2_nom ? { prenom: r.n2_prenom!, nom: r.n2_nom, poste: r.n2_poste } : null,
        }
      : null,
    repriseAuN2Le: r?.reprise_n2_le ?? null,
    transmiseALaDCHLe: r?.transmise_dch_le ?? null,
    transmisePar: r?.t_nom ? { prenom: r.t_prenom!, nom: r.t_nom, poste: r.t_poste } : null,
  };
}

/** Où en sont les commentaires du N+2, sur ce que garde la fiche de l'année. */
function etatDesCommentaires(f: FicheDeLAnnee): EtatDesCommentaires {
  return etatDesCommentairesDe({
    validee: f.valideeLe !== null,
    commences: f.commentairesN2 !== null,
    transmis: f.commentairesDuN2 !== null,
    reprise: f.repriseAuN2Le !== null,
  });
}

/**
 * Où en est la transmission de la fiche à la DCH : transmise, prête, ou en
 * attente de la validation de l'agent, puis des commentaires du N+2 s'il y
 * en a un. Reprise au N+2, la fiche est prête (ADR-0221).
 */
const etatDeLaTransmissionDe = (f: {
  validee: boolean;
  avecN2: boolean;
  commentairesTransmis: boolean;
  reprise: boolean;
  transmise: boolean;
}): EtatDeLaTransmission =>
  f.transmise
    ? 'transmise'
    : f.validee && (!f.avecN2 || f.commentairesTransmis || f.reprise)
      ? 'a_transmettre'
      : 'en_attente';

const etatDeLaTransmission = (f: FicheDeLAnnee, avecN2: boolean) =>
  etatDeLaTransmissionDe({
    validee: f.valideeLe !== null,
    avecN2,
    commentairesTransmis: f.commentairesDuN2 !== null,
    reprise: f.repriseAuN2Le !== null,
    transmise: f.transmiseALaDCHLe !== null,
  });

/**
 * L'état de l'évaluation, sur ce que garde la fiche de l'année : validée,
 * transmise, renvoyée par l'agent, commencée, ou encore à faire. Une
 * évaluation transmise de nouveau après un renvoi est transmise.
 */
function etatDeLEvaluation(f: {
  commencee: boolean;
  transmise: boolean;
  validee: boolean;
  renvoyee: boolean;
}): EtatDeLEvaluation {
  if (f.validee) return 'validee';
  if (f.transmise) return 'transmise';
  if (f.renvoyee) return 'renvoyee';
  return f.commencee ? 'en_cours' : 'a_faire';
}

const etatSurLaFiche = (f: FicheDeLAnnee) =>
  etatDeLEvaluation({
    commencee: f.evaluation !== null,
    transmise: f.evaluationTransmiseLe !== null,
    validee: f.valideeLe !== null,
    renvoyee: f.renvoi !== null,
  });

/** Ce que l'agent sait de son évaluation : rien du brouillon du N+1. */
const POUR_L_AGENT: Record<EtatDeLEvaluation, EtatDeMonEvaluation> = {
  a_faire: 'en_attente',
  en_cours: 'en_attente',
  renvoyee: 'renvoyee',
  transmise: 'a_valider',
  validee: 'validee',
};

/** Son évaluation par le N+1, vue par l'agent. */
function evaluationRecue(f: FicheDeLAnnee): EvaluationRecue {
  const etat = POUR_L_AGENT[etatSurLaFiche(f)];
  return {
    etat,
    transmiseLe: f.evaluationTransmiseLe,
    valideeLe: f.valideeLe,
    renvoyeeLe: etat === 'renvoyee' ? (f.renvoi?.le ?? null) : null,
  };
}

/**
 * Son évaluation, telle que l'agent la lit : la version transmise par le
 * N+1, jamais son brouillon, jamais la partie réservée à la hiérarchie.
 */
async function monEvaluationDans(tx: Tx, user: SessionUser): Promise<MonEvaluation> {
  const annee = await anneeDeLaCampagne(tx);
  const { id, fiche } = await monDossierEvalue(tx, user, annee);
  const { periode, phase } = await periodeDe(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  const recue = evaluationRecue(annuelle);
  return {
    annee,
    periode,
    phase,
    personnel: personnelDeLaFiche(fiche.personnel),
    objectifs: annuelle.objectifs,
    auto: annuelle.auto ?? autoEvaluationVide(),
    evaluation:
      recue.etat === 'a_valider' || recue.etat === 'validee'
        ? (annuelle.evaluation ?? evaluationDuN1Vide())
        : null,
    evaluateur: fiche.evaluateur,
    ...recue,
    renvoi: recue.etat === 'renvoyee' ? annuelle.renvoi : null,
    validable: recue.etat === 'a_valider',
    renvoyable: recue.etat === 'a_valider' && evaluationOuverte(phase),
  };
}

/** Son évaluation, transmise et pas encore validée ; sinon, 409. */
async function aValider(
  tx: Tx,
  user: SessionUser,
): Promise<{ id: string; annee: number; phase: PhaseDeLaCampagne }> {
  const annee = await anneeDeLaCampagne(tx);
  const { id } = await monDossierEvalue(tx, user, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  if (annuelle.valideeLe) {
    problem(409, 'campagne.evaluation_validee', 'Évaluation déjà validée');
  }
  if (!annuelle.evaluationTransmiseLe) {
    problem(
      409,
      'campagne.evaluation_non_transmise',
      'L’évaluation de votre N+1 n’est pas encore transmise',
    );
  }
  const { phase } = await periodeDe(tx, annee);
  return { id, annee, phase };
}

/**
 * L'agent valide son évaluation, à tout moment une fois transmise : la
 * fiche n'est valable qu'une fois validée. Elle ne change plus ensuite, même
 * par deux gestes qui se croisent.
 */
async function validerMonEvaluationDans(tx: Tx, user: SessionUser): Promise<void> {
  const { id, annee } = await aValider(tx, user);
  await tx.execute(sql`
    UPDATE fiches_entretien SET validee_le = now(), updated_at = now()
     WHERE employee_id = ${id} AND annee = ${annee}
       AND evaluation_transmise_le IS NOT NULL AND validee_le IS NULL`);
}

/**
 * L'agent renvoie son évaluation au N+1, avec son mot : elle redevient un
 * brouillon du N+1. Seulement pendant la période de l'année, où le N+1 peut
 * encore la reprendre.
 */
async function renvoyerMonEvaluationDans(tx: Tx, user: SessionUser, mot: string): Promise<void> {
  const { id, annee, phase } = await aValider(tx, user);
  if (!evaluationOuverte(phase)) {
    problem(
      409,
      'campagne.evaluation_fermee',
      'La période de l’évaluation est terminée : votre N+1 ne peut plus la reprendre',
    );
  }
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET evaluation_transmise_le = NULL, renvoyee_le = now(), renvoi_mot = ${mot},
           updated_at = now()
     WHERE employee_id = ${id} AND annee = ${annee}
       AND evaluation_transmise_le IS NOT NULL AND validee_le IS NULL`);
}

/** L'année de la campagne : celle du mode campagne, sinon l'année en cours. */
async function anneeDeLaCampagne(tx: Tx): Promise<number> {
  const campagne = loadEnv().CAMPAGNE_D_EVALUATION;
  if (campagne) return campagne;
  const { rows } = await tx.execute<{ annee: number }>(
    sql`SELECT extract(year FROM CURRENT_DATE)::int AS annee`,
  );
  return rows[0]!.annee;
}

/** La période de l'année, et la phase du jour (le jour de Dakar). */
async function periodeDe(
  tx: Tx,
  annee: number,
): Promise<{ periode: PeriodeDeLaCampagne | null; phase: PhaseDeLaCampagne }> {
  const { rows } = await tx.execute<{
    du: string;
    au: string;
    auto_au: string | null;
    phase: PhaseDeLaCampagne;
  }>(sql`
    SELECT du::text, au::text, auto_au::text,
           CASE WHEN CURRENT_DATE < du THEN 'a_venir'
                WHEN CURRENT_DATE <= COALESCE(auto_au, au) THEN 'auto_evaluation'
                WHEN CURRENT_DATE <= au THEN 'evaluation'
                ELSE 'terminee' END AS phase
      FROM evaluation_periodes WHERE annee = ${annee}`);
  const r = rows[0];
  if (!r) return { periode: null, phase: 'non_fixee' };
  return { periode: { du: r.du, autoAu: r.auto_au, au: r.au }, phase: r.phase };
}

/** Le dossier d'agent actif relié au compte. */
async function employeDuCompte(tx: Tx, userId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = ${userId} AND p.deleted_at IS NULL AND e.status = 'active'
     LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** La fiche de la personne connectée, et son évaluateur. */
async function ficheDe(tx: Tx, id: string, annee: number): Promise<AgentDeLaCampagne> {
  const { rows } = await tx.execute<{
    prenom: string;
    nom: string;
    matricule: string;
    personnel: PersonnelDeLaFiche | null;
    email: string | null;
    poste: string | null;
    unite_id: string | null;
    direction_abregee: string | null;
    evalue: boolean;
    commencee: boolean;
    transmise_le: string | null;
    ev_prenom: string | null;
    ev_nom: string | null;
    ev_poste: string | null;
    ev_genre: string | null;
  }>(sql`
    SELECT p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           e.personnel, e.work_email AS email, a.position_title AS poste,
           a.org_unit_id AS unite_id,
           ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_abregee,
           ${evaluable(sql`e`)} AS evalue,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           pv.given_name AS ev_prenom, pv.family_name AS ev_nom, av.position_title AS ev_poste,
           pv.gender AS ev_genre
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      LEFT JOIN employees v ON v.id = ${EVALUATEUR} AND v.status = 'active'
      LEFT JOIN persons pv ON pv.id = v.person_id
      LEFT JOIN assignments av ON av.employee_id = v.id AND av.validity @> CURRENT_DATE
     WHERE e.id = ${id}
     LIMIT 1`);
  const r = rows[0]!;
  return {
    employeeId: id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    personnel: r.personnel,
    ...(await unitesDe(tx, r.unite_id)),
    directionAbregee: r.direction_abregee,
    email: r.email,
    evaluateur: r.ev_nom
      ? {
          prenom: r.ev_prenom!,
          nom: r.ev_nom,
          poste: r.ev_poste,
          genre: r.ev_genre === 'female' || r.ev_genre === 'male' ? r.ev_genre : null,
        }
      : null,
    auto: r.evalue ? autoDe(r.commencee, r.transmise_le) : null,
  };
}

/** Vrai si `evaluateur` évalue cet agent cette année. */
async function dansLEquipe(
  tx: Tx,
  employeeId: string,
  evaluateur: string,
  annee: number,
): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND ${EVALUATEUR} = ${evaluateur}`);
  return rows.length > 0;
}

/**
 * Les agents qu'évalue la personne connectée, par ordre alphabétique. Leur
 * N+2 est l'évaluateur de cette personne : `avecN2` dit s'il y en a un.
 */
async function equipeDe(
  tx: Tx,
  id: string,
  annee: number,
  avecN2: boolean,
): Promise<AgentDeLEquipe[]> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    email: string | null;
    personnel: PersonnelDeLaFiche | null;
    commencee: boolean;
    transmise_le: string | null;
    evaluation_commencee: boolean;
    evaluation_transmise: boolean;
    evaluation_validee: boolean;
    evaluation_renvoyee: boolean;
    commentaires_commences: boolean;
    commentaires_transmis: boolean;
    reprise: boolean;
    transmise_dch: boolean;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste, e.work_email AS email, e.personnel,
           f.commentaires_n2 IS NOT NULL AS commentaires_commences,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.reprise_n2_le IS NOT NULL AS reprise,
           f.transmise_dch_le IS NOT NULL AS transmise_dch,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee,
           f.renvoyee_le IS NOT NULL AS evaluation_renvoyee
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE ${evaluable(sql`e`)} AND ${EVALUATEUR} = ${id}
     ORDER BY p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    email: r.email,
    personnel: r.personnel,
    auto: autoDe(r.commencee, r.transmise_le),
    evaluation: etatDeLEvaluation({
      commencee: r.evaluation_commencee,
      transmise: r.evaluation_transmise,
      validee: r.evaluation_validee,
      renvoyee: r.evaluation_renvoyee,
    }),
    commentaires: avecN2
      ? etatDesCommentairesDe({
          validee: r.evaluation_validee,
          commences: r.commentaires_commences,
          transmis: r.commentaires_transmis,
          reprise: r.reprise,
        })
      : null,
    dch: etatDeLaTransmissionDe({
      validee: r.evaluation_validee,
      avecN2,
      commentairesTransmis: r.commentaires_transmis,
      reprise: r.reprise,
      transmise: r.transmise_dch,
    }),
  }));
}

const etatDesCommentairesDe = (f: {
  validee: boolean;
  commences: boolean;
  transmis: boolean;
  reprise: boolean;
}): EtatDesCommentaires =>
  !f.validee
    ? 'en_attente'
    : f.transmis
      ? 'transmis'
      : f.reprise
        ? 'reprise'
        : f.commences
          ? 'en_cours'
          : 'a_commenter';

/**
 * Le N+2 de la campagne, sur un agent `e` et sa fiche `f`, son N+1 `n1` et
 * la fiche de l'année du N+1 `f1` : l'évaluateur de l'évaluateur, choisi
 * pour la campagne, sinon le N+1 de l'organigramme.
 */
const N2 = sql`COALESCE(f1.evaluateur_employee_id, n1.manager_employee_id)`;

/** Le N+2 d'un agent, pour la campagne de l'année ; `null` s'il n'y en a pas (le N+1 au sommet). */
async function n2De(
  tx: Tx,
  employeeId: string,
  annee: number,
): Promise<{ id: string; personne: PersonneDeLaCampagne } | null> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    poste: string | null;
  }>(sql`
    SELECT n2.id, p2.given_name AS prenom, p2.family_name AS nom, a2.position_title AS poste
      FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      JOIN employees n1 ON n1.id = ${EVALUATEUR}
      LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = ${annee}
      JOIN employees n2 ON n2.id = ${N2} AND n2.status = 'active'
      JOIN persons p2 ON p2.id = n2.person_id
      LEFT JOIN assignments a2 ON a2.employee_id = n2.id AND a2.validity @> CURRENT_DATE
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND n2.id <> e.id
     LIMIT 1`);
  const r = rows[0];
  return r ? { id: r.id, personne: { prenom: r.prenom, nom: r.nom, poste: r.poste } } : null;
}

/**
 * Les agents dont la personne connectée est le N+2, rangés par N+1, puis
 * par ordre alphabétique : chacune de leurs fiches, où qu'elle en soit.
 */
async function aCommenterDe(tx: Tx, id: string, annee: number): Promise<AgentACommenter[]> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    email: string | null;
    commencee: boolean;
    transmise_le: string | null;
    evaluation_commencee: boolean;
    evaluation_transmise: boolean;
    evaluation_validee: boolean;
    evaluation_renvoyee: boolean;
    commentaires_commences: boolean;
    commentaires_transmis: boolean;
    reprise: boolean;
    n1_prenom: string;
    n1_nom: string;
    n1_poste: string | null;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste, e.work_email AS email,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee,
           f.renvoyee_le IS NOT NULL AS evaluation_renvoyee,
           f.commentaires_n2 IS NOT NULL AS commentaires_commences,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.reprise_n2_le IS NOT NULL AS reprise,
           p1.given_name AS n1_prenom, p1.family_name AS n1_nom, a1.position_title AS n1_poste
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      JOIN employees n1 ON n1.id = ${EVALUATEUR}
      JOIN persons p1 ON p1.id = n1.person_id
      LEFT JOIN assignments a1 ON a1.employee_id = n1.id AND a1.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = ${annee}
     WHERE ${evaluable(sql`e`)} AND ${N2} = ${id} AND e.id <> ${id}
     ORDER BY p1.family_name, p1.given_name, p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    email: r.email,
    n1: { prenom: r.n1_prenom, nom: r.n1_nom, poste: r.n1_poste },
    auto: autoDe(r.commencee, r.transmise_le),
    evaluation: etatDeLEvaluation({
      commencee: r.evaluation_commencee,
      transmise: r.evaluation_transmise,
      validee: r.evaluation_validee,
      renvoyee: r.evaluation_renvoyee,
    }),
    commentaires: etatDesCommentairesDe({
      validee: r.evaluation_validee,
      commences: r.commentaires_commences,
      transmis: r.commentaires_transmis,
      reprise: r.reprise,
    }),
  }));
}

/** Un agent dont la personne connectée est le N+2 ; sinon, introuvable. */
async function monN2(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || (await n2De(tx, employeeId, annee))?.id !== moi) {
    problem(404, 'campagne.agent_hors_perimetre', 'Agent introuvable parmi les équipes de vos N+1');
  }
  return { moi, annee };
}

/**
 * La fiche d'un agent, telle que son N+2 l'ouvre : en entier, partie
 * réservée comprise, une fois validée par l'agent ; avant, seulement où
 * elle en est.
 */
async function ficheDuN2Dans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<FichePourLeN2> {
  const { annee } = await monN2(tx, user, employeeId);
  const { periode, phase } = await periodeDe(tx, annee);
  const agent = await ficheDe(tx, employeeId, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const etat = etatDesCommentaires(annuelle);
  // Reprise par le N+1, la fiche quitte le N+2, comme sur la plateforme de base (ADR-0156).
  if (etat === 'reprise') repriseParLeN1();
  return {
    annee,
    periode,
    phase,
    agent,
    objectifs: annuelle.objectifs,
    fiche: annuelle.valideeLe
      ? {
          auto: annuelle.auto ?? autoEvaluationVide(),
          evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
          reservee: annuelle.reservee ?? partieReserveeVide(),
        }
      : null,
    autoTransmiseLe: agent.auto?.transmiseLe ?? null,
    evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
    valideeLe: annuelle.valideeLe,
    commentaires: annuelle.commentairesDuN2?.texte ?? annuelle.commentairesN2 ?? '',
    etat,
    transmisLe: annuelle.commentairesDuN2?.le ?? null,
    modifiable: etat === 'a_commenter' || etat === 'en_cours',
  };
}

/**
 * Écrit les commentaires du N+2 : le brouillon, ou la version transmise au
 * N+1, avec ou sans un mot. Seulement la fiche validée par l'agent, et tant
 * qu'ils ne sont pas transmis ; transmis, ils ne se réécrivent plus.
 */
async function ecrireCommentaires(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  commentaires: string,
  transmettre: boolean,
): Promise<void> {
  const { moi, annee } = await monN2(tx, user, employeeId);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (!annuelle.valideeLe) {
    problem(409, 'campagne.fiche_non_validee', 'La fiche n’est pas encore validée par l’agent');
  }
  if (annuelle.commentairesDuN2) {
    problem(409, 'campagne.commentaires_transmis', 'Commentaires déjà transmis');
  }
  if (annuelle.repriseAuN2Le) repriseParLeN1();
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET commentaires_n2 = ${commentaires}, commentaires_n2_par = ${moi},
           commentaires_n2_transmis_le = ${transmettre ? sql`now()` : sql`NULL`},
           updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND validee_le IS NOT NULL AND commentaires_n2_transmis_le IS NULL
       AND reprise_n2_le IS NULL`);
}

/** La fiche reprise par le N+1 : le N+2 ne l'ouvre plus. */
function repriseParLeN1(): never {
  problem(409, 'campagne.fiche_reprise', 'La fiche a été reprise par le N+1');
}

// ──────────────────────────────────────────────── la transmission à la DCH (ADR-0221)

/** Un agent de l'équipe de la personne connectée, son évaluateur ; hors de son équipe, introuvable. */
async function monAgent(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  return { moi, annee };
}

const ficheTransmise = () =>
  problem(409, 'campagne.fiche_transmise', 'Fiche déjà transmise à la DCH');

/**
 * Le N+1 transmet la fiche à la DCH : validée par l'agent, une fois les
 * commentaires du N+2 reçus, ou reprise au N+2 ; sans N+2, dès la
 * validation. Transmise, elle ne change plus.
 */
async function transmettreALaDCHDans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  const { moi, annee } = await monAgent(tx, user, employeeId);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const n2 = await n2De(tx, employeeId, annee);
  const etat = etatDeLaTransmission(annuelle, n2 !== null);
  if (etat === 'transmise') ficheTransmise();
  if (!annuelle.valideeLe) {
    problem(409, 'campagne.fiche_non_validee', 'La fiche n’est pas encore validée par l’agent');
  }
  if (etat !== 'a_transmettre') {
    problem(
      409,
      'campagne.fiche_chez_le_n2',
      'La fiche est chez le N+2',
      'Attendez ses commentaires, ou reprenez la fiche au N+2.',
    );
  }
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET transmise_dch_le = now(), transmise_dch_par = ${moi}, updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND validee_le IS NOT NULL AND transmise_dch_le IS NULL`);
}

/**
 * Le N+1 reprend la fiche au N+2 qui ne l'a pas encore commentée : le N+2
 * ne l'ouvre plus, et le N+1 peut la transmettre à la DCH (ADR-0156).
 */
async function reprendreAuN2Dans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  const { annee } = await monAgent(tx, user, employeeId);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (annuelle.transmiseALaDCHLe) ficheTransmise();
  const n2 = await n2De(tx, employeeId, annee);
  if (!n2 || etatDesCommentaires(annuelle) === 'en_attente' || annuelle.repriseAuN2Le) {
    problem(409, 'campagne.fiche_pas_chez_le_n2', 'La fiche n’est pas chez le N+2');
  }
  if (annuelle.commentairesDuN2) {
    problem(409, 'campagne.commentaires_transmis', 'Commentaires déjà transmis');
  }
  await tx.execute(sql`
    UPDATE fiches_entretien SET reprise_n2_le = now(), updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND validee_le IS NOT NULL AND commentaires_n2_transmis_le IS NULL
       AND reprise_n2_le IS NULL AND transmise_dch_le IS NULL`);
}

/** La fiche reprise repart au N+2, avec le brouillon de ses commentaires. */
async function renvoyerAuN2Dans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  const { annee } = await monAgent(tx, user, employeeId);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (annuelle.transmiseALaDCHLe) ficheTransmise();
  if (!annuelle.repriseAuN2Le || !(await n2De(tx, employeeId, annee))) {
    problem(409, 'campagne.fiche_non_reprise', 'La fiche n’a pas été reprise au N+2');
  }
  await tx.execute(sql`
    UPDATE fiches_entretien SET reprise_n2_le = NULL, updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND reprise_n2_le IS NOT NULL AND transmise_dch_le IS NULL`);
}

/** Le suivi de la DCH et la lecture des fiches : l'habilitation « Tableau de bord ». */
function reserveALaDCH(user: SessionUser): void {
  if (!peut(user, 'pilotage')) {
    problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
  }
}

/** Le suivi en deux nombres, pour l'accueil : les fiches de l'année, celles transmises. */
async function suiviEnBref(tx: Tx, annee: number): Promise<{ fiches: number; transmises: number }> {
  const { rows } = await tx.execute<{ fiches: number; transmises: number }>(sql`
    SELECT count(*)::int AS fiches, count(f.transmise_dch_le)::int AS transmises
      FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE ${evaluable(sql`e`)}`);
  return rows[0] ?? { fiches: 0, transmises: 0 };
}

/** Chaque agent à évaluer cette année, par ordre alphabétique, et où en est sa fiche. */
async function suiviDans(tx: Tx, user: SessionUser): Promise<SuiviDeLaDCH> {
  reserveALaDCH(user);
  const annee = await anneeDeLaCampagne(tx);
  const { periode, phase } = await periodeDe(tx, annee);
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    direction: string | null;
    auto_transmise: boolean;
    evaluation_commencee: boolean;
    evaluation_transmise: boolean;
    evaluation_validee: boolean;
    evaluation_renvoyee: boolean;
    commentaires_transmis: boolean;
    reprise: boolean;
    avec_n2: boolean;
    transmise_le: string | null;
    n1_prenom: string | null;
    n1_nom: string | null;
    n1_poste: string | null;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction,
           f.auto_transmise_le IS NOT NULL AS auto_transmise,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee,
           f.renvoyee_le IS NOT NULL AS evaluation_renvoyee,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.reprise_n2_le IS NOT NULL AS reprise,
           n2.id IS NOT NULL AS avec_n2,
           f.transmise_dch_le::date::text AS transmise_le,
           p1.given_name AS n1_prenom, p1.family_name AS n1_nom, a1.position_title AS n1_poste
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      LEFT JOIN employees n1 ON n1.id = ${EVALUATEUR}
      LEFT JOIN persons p1 ON p1.id = n1.person_id
      LEFT JOIN assignments a1 ON a1.employee_id = n1.id AND a1.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = ${annee}
      LEFT JOIN employees n2 ON n2.id = ${N2} AND n2.status = 'active' AND n2.id <> e.id
     WHERE ${evaluable(sql`e`)}
     ORDER BY p.family_name, p.given_name`);
  return {
    annee,
    periode,
    phase,
    fiches: rows.map((r) => ({
      employeeId: r.id,
      prenom: r.prenom,
      nom: r.nom,
      matricule: r.matricule,
      poste: r.poste,
      direction: r.direction,
      n1: r.n1_nom ? { prenom: r.n1_prenom!, nom: r.n1_nom, poste: r.n1_poste } : null,
      etape: etapeDe(r),
      transmiseLe: r.transmise_le,
    })),
  };
}

/**
 * L'étape d'une fiche, pour le suivi de la DCH. L'auto-évaluation est faite
 * ou ne l'est pas : un brouillon ne compte pas (ADR-0226).
 */
function etapeDe(r: {
  auto_transmise: boolean;
  evaluation_commencee: boolean;
  evaluation_transmise: boolean;
  evaluation_validee: boolean;
  evaluation_renvoyee: boolean;
  commentaires_transmis: boolean;
  reprise: boolean;
  avec_n2: boolean;
  transmise_le: string | null;
}): EtapeDeLaFiche {
  if (r.transmise_le) return 'transmise';
  if (!r.auto_transmise) return 'auto_non_faite';
  const evaluation = etatDeLEvaluation({
    commencee: r.evaluation_commencee,
    transmise: r.evaluation_transmise,
    validee: r.evaluation_validee,
    renvoyee: r.evaluation_renvoyee,
  });
  if (evaluation === 'transmise') return 'chez_l_agent';
  if (evaluation !== 'validee') return 'chez_le_n1';
  return r.avec_n2 && !r.commentaires_transmis && !r.reprise ? 'chez_le_n2' : 'a_transmettre';
}

/** Une fiche transmise, et ce que le PDF imprime en plus : la prise du poste, le jour. */
interface FicheLueParLaDCH {
  fiche: FichePourLaDCH;
  /** AAAA-MM-JJ. */
  posteDepuis: string | null;
  aujourdhui: string;
}

/** La fiche d'un agent, transmise à la DCH, en entier ; avant, la DCH ne la lit pas. */
async function ficheDeLaDCHDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<FicheLueParLaDCH> {
  reserveALaDCH(user);
  const annee = await anneeDeLaCampagne(tx);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (!annuelle.transmiseALaDCHLe) {
    problem(409, 'campagne.fiche_non_transmise', 'La fiche n’est pas encore transmise à la DCH');
  }
  const agent = await ficheDe(tx, employeeId, annee);
  const n2 = await n2De(tx, employeeId, annee);
  const { rows } = await tx.execute<{ poste_depuis: string | null; aujourdhui: string }>(sql`
    SELECT (SELECT lower(a.validity)::text FROM assignments a
             WHERE a.employee_id = ${employeeId} AND a.validity @> CURRENT_DATE
             LIMIT 1) AS poste_depuis,
           CURRENT_DATE::text AS aujourdhui`);
  return {
    fiche: {
      annee,
      agent,
      objectifs: annuelle.objectifs,
      fiche: {
        auto: annuelle.auto ?? autoEvaluationVide(),
        evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
        reservee: annuelle.reservee ?? partieReserveeVide(),
      },
      autoTransmiseLe: agent.auto?.transmiseLe ?? null,
      evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
      valideeLe: annuelle.valideeLe,
      n2: n2?.personne ?? null,
      commentairesDuN2: annuelle.commentairesDuN2,
      repriseAuN2Le: annuelle.commentairesDuN2 ? null : annuelle.repriseAuN2Le,
      transmiseLe: annuelle.transmiseALaDCHLe,
      transmisePar: annuelle.transmisePar,
    },
    posteDepuis: rows[0]?.poste_depuis ?? null,
    aujourdhui: rows[0]!.aujourdhui,
  };
}

/**
 * Ce que le PDF imprime d'une fiche transmise : la version complète, partie
 * réservée comprise, avec les validations en ligne. La date de l'entretien
 * ne se saisit pas pendant la campagne : le PDF la laisse à fixer.
 */
function donneesDuPdf({ fiche: f, posteDepuis, aujourdhui }: FicheLueParLaDCH): DonneesDeLaFiche {
  const a = f.agent;
  const n1 = a.evaluateur;
  const c = f.commentairesDuN2;
  const n2 = c?.par ?? f.n2;
  return {
    annee: f.annee,
    personnel: personnelDeLaFiche(a.personnel),
    agent: {
      prenom: a.prenom,
      nom: a.nom,
      fonction: a.poste,
      matricule: a.matricule,
      direction: a.direction,
      departement: a.departement,
      service: a.service,
      anciennete: posteDepuis ? ancienneteEnLettres(posteDepuis, aujourdhui) : null,
      posteDepuis,
    },
    n1: n1 ? { prenom: n1.prenom, nom: n1.nom, fonction: n1.poste } : null,
    dateDeLEntretien: null,
    objectifs: f.objectifs,
    auto: f.fiche.auto,
    evaluation: f.fiche.evaluation,
    reservee: f.fiche.reservee,
    validations: { n1: f.evaluationTransmiseLe, agent: f.valideeLe },
    n2:
      c && n2
        ? { prenom: n2.prenom, nom: n2.nom, fonction: n2.poste, le: c.le, commentaires: c.texte }
        : null,
  };
}

// ──────────────────────────────────────────────── l'administration (ADR-0222)

/** Les dates de l'évaluation et qui évalue qui : les comptes d'administration seulement. */
function reserveALAdministration(user: SessionUser): void {
  if (user.role !== 'admin') {
    problem(
      403,
      'campagne.administration_reservee',
      'L’administration de la campagne est réservée aux comptes d’administration',
    );
  }
}

/** Une personne désignée, lue sous un préfixe de colonnes (`m_`, `c_`). */
const designee = (
  id: string | null,
  prenom: string | null,
  nom: string | null,
  matricule: string | null,
  poste: string | null,
): PersonneDesignee | null =>
  id && nom
    ? { employeeId: id, prenom: prenom ?? '', nom, matricule: matricule ?? '', poste }
    : null;

/**
 * Les agents à évaluer cette année, par ordre alphabétique : leur N+1 dans
 * l'organigramme, et le choix de l'administration pour la campagne, s'il y
 * en a un.
 */
async function administrationDans(tx: Tx, user: SessionUser): Promise<AdministrationDeLaCampagne> {
  reserveALAdministration(user);
  const annee = await anneeDeLaCampagne(tx);
  const { periode, phase } = await periodeDe(tx, annee);
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    direction: string | null;
    m_id: string | null;
    m_prenom: string | null;
    m_nom: string | null;
    m_matricule: string | null;
    m_poste: string | null;
    c_id: string | null;
    c_prenom: string | null;
    c_nom: string | null;
    c_matricule: string | null;
    c_poste: string | null;
    transmise: boolean;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction,
           m.id AS m_id, pm.given_name AS m_prenom, pm.family_name AS m_nom,
           m.employee_number AS m_matricule, am.position_title AS m_poste,
           c.id AS c_id, pc.given_name AS c_prenom, pc.family_name AS c_nom,
           c.employee_number AS c_matricule, ac.position_title AS c_poste,
           f.transmise_dch_le IS NOT NULL AS transmise
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      LEFT JOIN employees m ON m.id = e.manager_employee_id
      LEFT JOIN persons pm ON pm.id = m.person_id
      LEFT JOIN assignments am ON am.employee_id = m.id AND am.validity @> CURRENT_DATE
      LEFT JOIN employees c ON c.id = f.evaluateur_employee_id
      LEFT JOIN persons pc ON pc.id = c.person_id
      LEFT JOIN assignments ac ON ac.employee_id = c.id AND ac.validity @> CURRENT_DATE
     WHERE ${evaluable(sql`e`)}
     ORDER BY p.family_name, p.given_name`);
  return {
    annee,
    periode,
    phase,
    agents: rows.map((r): EvaluateurDeLAgent => ({
      employeeId: r.id,
      prenom: r.prenom,
      nom: r.nom,
      matricule: r.matricule,
      poste: r.poste,
      direction: r.direction,
      organigramme: designee(r.m_id, r.m_prenom, r.m_nom, r.m_matricule, r.m_poste),
      choisi: designee(r.c_id, r.c_prenom, r.c_nom, r.c_matricule, r.c_poste),
      transmise: r.transmise,
    })),
  };
}

/**
 * Les dates de l'évaluation de l'année : le début, la fin de
 * l'auto-évaluation, la fin. La période commence dans l'année évaluée ou
 * la suivante, comme sur la plateforme de base.
 */
async function fixerLesDatesDans(tx: Tx, user: SessionUser, d: DatesDeLaCampagne): Promise<void> {
  reserveALAdministration(user);
  const annee = await anneeDeLaCampagne(tx);
  const debut = Number(d.du.slice(0, 4));
  if (debut < annee || debut > annee + 1) {
    problem(
      422,
      'campagne.dates_hors_annee',
      `La période de l’évaluation ${annee} doit commencer en ${annee} ou en ${annee + 1}`,
    );
  }
  await tx.execute(sql`
    INSERT INTO evaluation_periodes (id, tenant_id, annee, du, auto_au, au)
    VALUES (${uuidv7()}, ${user.tenantId}, ${annee}, ${d.du}, ${d.autoAu}, ${d.au})
    ON CONFLICT (tenant_id, annee) DO UPDATE
       SET du = EXCLUDED.du, auto_au = EXCLUDED.auto_au, au = EXCLUDED.au, updated_at = now()`);
}

/**
 * L'évaluateur d'un agent pour la campagne, au choix de l'administration :
 * tout agent en activité, sans les règles de l'organigramme. `null`, ou le
 * choix du N+1 de l'organigramme : la fiche suit l'organigramme. Après un
 * changement d'évaluateur, la fiche reprend où elle en est ; transmise à la
 * DCH, elle ne change plus d'évaluateur.
 */
async function choisirLEvaluateurDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  evaluateurId: string | null,
): Promise<void> {
  reserveALAdministration(user);
  const annee = await anneeDeLaCampagne(tx);
  const { rows } = await tx.execute<{ manager: string | null; transmise: boolean }>(sql`
    SELECT e.manager_employee_id AS manager, f.transmise_dch_le IS NOT NULL AS transmise
      FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)}`);
  const agent = rows[0];
  if (!agent) {
    problem(404, 'campagne.agent_introuvable', 'Agent introuvable parmi les agents de la campagne');
  }
  if (agent.transmise) ficheTransmise();
  if (evaluateurId) {
    if (evaluateurId === employeeId) {
      problem(
        422,
        'campagne.evaluateur_soi_meme',
        'L’agent ne peut pas être son propre évaluateur',
      );
    }
    const { rows: actifs } = await tx.execute(
      sql`SELECT 1 FROM employees WHERE id = ${evaluateurId} AND status = 'active'`,
    );
    if (actifs.length === 0) {
      problem(
        422,
        'campagne.evaluateur_introuvable',
        'Évaluateur introuvable parmi les agents en activité',
      );
    }
  }
  const choisi = evaluateurId && evaluateurId !== agent.manager ? evaluateurId : null;
  await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, evaluateur_employee_id)
    VALUES (${uuidv7()}, ${user.tenantId}, ${employeeId}, ${annee}, ${choisi})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET evaluateur_employee_id = EXCLUDED.evaluateur_employee_id, updated_at = now()
     WHERE fiches_entretien.transmise_dch_le IS NULL`);
}
