import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ancienneteEnLettres,
  autoEvaluationSchema,
  autoEvaluationRelue,
  autoEvaluationTransmise,
  autoEvaluationVide,
  avecSonArrondi,
  ceQuiManqueALAutoEvaluation,
  ceQuiManqueALEvaluationDuN1,
  ceQuiManqueAuxObjectifs,
  competencesDe,
  dateEnLettres,
  evaluationDuN1Schema,
  evaluationDuN1Vide,
  nomDeLaFiche,
  objectifAVenirSchema,
  objectifEvalueSchema,
  objectifsEcrits,
  partieReserveeSchema,
  partieReserveeVide,
  personnelDeLaFiche,
  peut,
  sansLignesVides,
  type AccueilDeLaCampagne,
  type AdministrationDeLaCampagne,
  type AvancementDeLaFiche,
  type AgentACommenter,
  type AgentAObjectifs,
  type AgentDeLaCampagne,
  type AgentDeLEquipe,
  type AutoDeLAgent,
  type AutoEvaluation,
  type CommentairesDuN2,
  type DatesDeLaCampagne,
  type DatesDesObjectifs,
  type EcritureDeLEvaluation,
  type EtapeDeLaFiche,
  type EvaluateurDeLAgent,
  type EtatDeLaTransmission,
  type EtatDeLEvaluation,
  type EtatDeMonEvaluation,
  type EtatDesCommentaires,
  type EtatDesObjectifs,
  type EvaluationDeLAgent,
  type EvaluationDuN1,
  type EvaluationRecue,
  type FichePourLaDCH,
  type FichePourLeN2,
  type MonAutoEvaluation,
  type MonEvaluation,
  type ObjectifDeLAnneeAVenir,
  type ObjectifEvalue,
  type ObjectifsDeLAccueil,
  type ObjectifsDeLAgent,
  type PartieReservee,
  type PeriodeDeLaCampagne,
  type PeriodeDesObjectifs,
  type PersonneDeLaCampagne,
  type PersonneDesignee,
  type PersonnelDeLaFiche,
  type PhaseDeLaCampagne,
  type PhaseDesObjectifs,
  type SessionUser,
  type SuiviDeLaDCH,
  type TransmissionDeLEvaluation,
} from '@teranga/contracts';
import { v7 as uuidv7 } from 'uuid';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import { TenantDb, type Tx } from '../../db/tenant-db';
import {
  ficheDEntretienPdf,
  ficheDeLAgentPdf,
  type DonneesDeLaFiche,
} from '../entretiens/fiche-pdf';
import { evaluable } from '../evaluations/circuit';
import { avancementDeLaFiche, ficheCommencee, REMISE_A_ZERO } from './remise-a-zero';
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
   plus (ADR-0217). Le renvoi au N+1 n'existe plus (ADR-0267).

   En transmettant l'évaluation à l'agent, le N+1 peut envoyer la fiche, en
   même temps, au N+2, l'évaluateur du N+1 ; plus tard, ce n'est plus
   possible (ADR-0278). Le N+2 de ce jour-là la garde, même si
   l'organigramme change ensuite (ADR-0289). Ce N+2 la lit en entier,
   partie réservée comprise, la commente s'il y a lieu, et transmet ses
   commentaires au N+1 (ADR-0218), sans attendre la validation de l'agent.

   Le N+1 transmet ensuite la fiche à la DCH : validée par l'agent, une fois
   les commentaires du N+2 reçus, ou sans attendre quand elle n'a pas été
   envoyée au N+2. Un N+2 qui tarde ne bloque rien : le N+1 reprend la
   fiche, pour de bon, puis la transmet ; le N+2 la lit toujours, sans plus
   la commenter. Transmise à la DCH, la fiche ne change plus, ni
   d'évaluateur. La DCH, avec l'habilitation « Tableau de bord », suit
   toutes les fiches de l'année et lit en entier celles qui lui sont
   transmises, avec leur PDF (ADR-0221), sauf la sienne (ADR-0289).

   Chaque écriture revérifie ses conditions sous le verrou de la ligne :
   deux gestes qui se croisent ne passent pas tous les deux, et le second
   reçoit le même refus que s'il était arrivé après (ADR-0289).

   Les objectifs ont leur propre campagne, en début d'année, après la fin
   de l'évaluation (ADR-0274) : le N+1 de l'organigramme écrit ceux de
   chaque agent de son équipe, en brouillon, puis les transmet à l'agent.
   Transmis, ils deviennent les objectifs de sa fiche de l'année, ceux
   qu'appréciera l'évaluation de fin d'année. Avant l'ouverture de leur
   période, rien ne les annonce.
   ──────────────────────────────────────────────────────────────── */

/**
 * L'évaluateur de la campagne, sur un agent `e` et sa fiche de l'année `f`.
 * Transmise à la DCH, la fiche reste au N+1 qui l'a transmise : un
 * changement d'organigramme ne la fait plus passer à quelqu'un d'autre
 * (ADR-0222, ADR-0289).
 */
const EVALUATEUR = sql`CASE WHEN f.transmise_dch_le IS NOT NULL THEN f.transmise_dch_par
  ELSE COALESCE(f.evaluateur_employee_id, e.manager_employee_id) END`;

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
          objectifs: await objectifsDeLAccueil(tx, null),
        };
      }
      const fiche = await ficheDe(tx, moi, annee);
      return {
        annee,
        periode,
        phase,
        moi: fiche,
        equipe: await equipeDe(tx, moi, annee),
        monEvaluation: fiche.auto ? evaluationRecue(await ficheDeLAnnee(tx, moi, annee)) : null,
        aCommenter: await aCommenterDe(tx, moi, annee),
        dch,
        administration: user.role === 'admin',
        objectifs: await objectifsDeLAccueil(tx, moi),
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

  /**
   * La fiche d'un agent de son équipe, en PDF, telle que l'évaluation en
   * cours la remplit, enregistrée ou non : ce que « Valider » affiche avant
   * la transmission à l'agent (ADR-0260). Rien ne s'enregistre. Une fois
   * l'évaluation transmise, ou la période fermée, l'aperçu n'existe plus :
   * le PDF de la fiche est celui qui se télécharge (ADR-0289).
   */
  async apercuDeLEvaluation(
    user: SessionUser,
    employeeId: string,
    { evaluation, reservee }: EcritureDeLEvaluation,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const d = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx): Promise<DonneesDeLaFiche> => {
        const { annee, agent, annuelle } = await evaluationEcrivable(tx, user, employeeId);
        const { posteDepuis, aujourdhui } = await prisePoste(tx, employeeId);
        const personnel = personnelDeLaFiche(agent.personnel);
        const n1 = agent.evaluateur;
        return {
          annee,
          personnel,
          agent: agentDuPdf(agent, posteDepuis, aujourdhui),
          n1: n1 ? { prenom: n1.prenom, nom: n1.nom, fonction: n1.poste } : null,
          dateDeLEntretien: evaluation.entretienConfirme ? evaluation.dateDeLEntretien : null,
          objectifs: annuelle.objectifs,
          auto: annuelle.auto ?? autoEvaluationVide(),
          // Telle qu'elle partirait : sans les lignes de ses tableaux restées vides.
          evaluation: sansLignesVides(
            evaluationSurLaFiche(evaluation, annuelle.objectifs, personnel),
          ),
          reservee,
          validations: { n1: null, agent: null },
          n2: null,
        };
      },
    );
    return {
      filename: nomDeLaFiche(d.annee, d.agent.matricule, true),
      pdf: await ficheDEntretienPdf(d),
    };
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
    ecriture: TransmissionDeLEvaluation,
  ): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireEvaluation(tx, user, employeeId, ecriture, true, ecriture.envoyerAuN2 ?? false);
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

  /** Le N+1 reprend la fiche au N+2 qui ne l'a pas encore commentée : c'est définitif. */
  async reprendreAuN2(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await reprendreAuN2Dans(tx, user, employeeId);
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

  /**
   * La fiche complète d'un agent de son équipe, en PDF, partie réservée
   * comprise, dès que l'évaluation est transmise à l'agent (ADR-0279).
   */
  async pdfDeLEquipe(
    user: SessionUser,
    employeeId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const d = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const { annee } = await monAgent(tx, user, employeeId);
        const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
        if (!annuelle.evaluationTransmiseLe) {
          problem(
            409,
            'campagne.evaluation_non_transmise',
            'L’évaluation n’est pas encore transmise à l’agent',
          );
        }
        return pdfCompletDe(tx, employeeId, annee, annuelle);
      },
    );
    return {
      filename: nomDeLaFiche(d.annee, d.agent.matricule, true),
      pdf: await ficheDEntretienPdf(d),
    };
  }

  /**
   * La fiche complète d'un agent dont la personne connectée est le N+2, en
   * PDF, dès que le N+1 l'envoie au N+2, et même reprise : la copie du N+2
   * (ADR-0278, ADR-0279).
   */
  async pdfDuN2(user: SessionUser, employeeId: string): Promise<{ filename: string; pdf: Buffer }> {
    const d = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const { annee } = await monN2(tx, user, employeeId);
        const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
        if (!annuelle.envoyeeAuN2Le) {
          problem(409, 'campagne.fiche_non_envoyee', 'La fiche ne vous a pas été envoyée');
        }
        return pdfCompletDe(tx, employeeId, annee, annuelle);
      },
    );
    return {
      filename: nomDeLaFiche(d.annee, d.agent.matricule, true),
      pdf: await ficheDEntretienPdf(d),
    };
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

  /** Les dates de la fixation des objectifs de l'année suivante (ADR-0274). */
  async fixerLesDatesDesObjectifs(
    user: SessionUser,
    dates: DatesDesObjectifs,
  ): Promise<AdministrationDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await fixerLesDatesDesObjectifsDans(tx, user, dates);
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

  /**
   * La fiche de l'année d'un agent, remise à zéro par l'administration
   * (ADR-0271) : ce que la campagne y a écrit s'efface, les objectifs et
   * l'évaluateur choisi restent. Une fiche déjà vierge ne change pas.
   */
  async remettreAZero(user: SessionUser, employeeId: string): Promise<AdministrationDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await remettreAZeroDans(tx, user, employeeId);
      return administrationDans(tx, user);
    });
  }

  /** Son évaluation par le N+1, pour la lire, puis la valider (ADR-0217). */
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

  /**
   * Son évaluation de l'année, en PDF, une fois validée (ADR-0269) : la
   * version de l'agent, sans la partie réservée à la hiérarchie ni les
   * commentaires du N+2, qui en font partie (ADR-0268).
   */
  async pdfDeMonEvaluation(user: SessionUser): Promise<{ filename: string; pdf: Buffer }> {
    const d = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx): Promise<DonneesDeLaFiche> => {
        const annee = await anneeDeLaCampagne(tx);
        const { id, fiche: agent } = await monDossierEvalue(tx, user, annee);
        const annuelle = await ficheDeLAnnee(tx, id, annee);
        // Validée, elle est forcément transmise.
        if (!annuelle.valideeLe || !annuelle.evaluationTransmiseLe || !annuelle.evaluation) {
          problem(
            409,
            'campagne.evaluation_non_validee',
            'Votre évaluation n’est pas encore validée',
          );
        }
        const { posteDepuis, aujourdhui } = await prisePoste(tx, id);
        const n1 = annuelle.signataireN1 ?? agent.evaluateur;
        return {
          annee,
          personnel: personnelDeLaFiche(agent.personnel),
          agent: agentDuPdf(agent, posteDepuis, aujourdhui),
          n1: n1 ? { prenom: n1.prenom, nom: n1.nom, fonction: n1.poste } : null,
          dateDeLEntretien: annuelle.evaluation.dateDeLEntretien,
          objectifs: annuelle.objectifs,
          auto: annuelle.auto ?? autoEvaluationVide(),
          evaluation: annuelle.evaluation,
          reservee: null,
          validations: { n1: annuelle.evaluationTransmiseLe, agent: annuelle.valideeLe },
          n2: null,
        };
      },
    );
    return { filename: nomDeLaFiche(d.annee, d.agent.matricule), pdf: await ficheDEntretienPdf(d) };
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
   * La partie de l'agent de sa fiche, en PDF, telle que son formulaire la
   * montre, enregistrée ou non : ce que « Valider » affiche avant la
   * transmission (ADR-0241). Transmise, ou la période passée, l'aperçu
   * n'existe plus (ADR-0289).
   */
  async apercuDeMonAuto(
    user: SessionUser,
    auto: AutoEvaluation,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const d = await this.db.withTenant(
      { tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const { annee, id } = await autoEcrivable(tx, user);
        const agent = await ficheDe(tx, id, annee);
        const { objectifs } = await ficheDeLAnnee(tx, id, annee);
        const { posteDepuis, aujourdhui } = await prisePoste(tx, id);
        const donnees: DonneesDeLaFiche = {
          annee,
          personnel: personnelDeLaFiche(agent.personnel),
          agent: agentDuPdf(agent, posteDepuis, aujourdhui),
          n1: agent.evaluateur
            ? {
                prenom: agent.evaluateur.prenom,
                nom: agent.evaluateur.nom,
                fonction: agent.evaluateur.poste,
              }
            : null,
          dateDeLEntretien: null,
          objectifs,
          auto: surLesObjectifs(auto, objectifs),
          evaluation: evaluationDuN1Vide(),
          reservee: null,
          validations: { n1: null, agent: null },
          n2: null,
        };
        return donnees;
      },
    );
    return { filename: nomDeLaFiche(d.annee, d.agent.matricule), pdf: await ficheDeLAgentPdf(d) };
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

  /**
   * Les objectifs d'un agent de son équipe dans l'organigramme, pour son
   * N+1, une fois leur fixation ouverte (ADR-0274).
   */
  async objectifsDeLAgent(user: SessionUser, employeeId: string): Promise<ObjectifsDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      objectifsDeLAgentDans(tx, user, employeeId),
    );
  }

  /** Le brouillon des objectifs d'un agent, gardé tel qu'il est. */
  async enregistrerLesObjectifs(
    user: SessionUser,
    employeeId: string,
    objectifs: ObjectifDeLAnneeAVenir[],
  ): Promise<ObjectifsDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireLesObjectifs(tx, user, employeeId, objectifs, false);
      return objectifsDeLAgentDans(tx, user, employeeId);
    });
  }

  /**
   * Les objectifs d'un agent, complets, transmis à l'agent : ils ne changent
   * plus. Incomplets, ils restent en brouillon et la réponse dit ce qui manque.
   */
  async transmettreLesObjectifs(
    user: SessionUser,
    employeeId: string,
    objectifs: ObjectifDeLAnneeAVenir[],
  ): Promise<ObjectifsDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireLesObjectifs(tx, user, employeeId, objectifs, true);
      return objectifsDeLAgentDans(tx, user, employeeId);
    });
  }
}

/** L'évaluation du N+1 s'écrit du début à la fin de la période de l'année. */
const evaluationOuverte = (phase: PhaseDeLaCampagne) =>
  phase === 'auto_evaluation' || phase === 'evaluation';

/**
 * Après la date de fin de la période, la campagne d'évaluation est terminée
 * et la fiche verrouillée : plus personne ne la modifie (ADR-0273).
 */
const evaluationTerminee = (phase: PhaseDeLaCampagne) => phase === 'terminee';

/** Tout geste sur la fiche, refusé une fois la campagne d'évaluation terminée (ADR-0273). */
async function ficheNonVerrouillee(tx: Tx, annee: number): Promise<void> {
  const { phase } = await periodeDe(tx, annee);
  if (evaluationTerminee(phase)) {
    problem(
      409,
      'campagne.evaluation_terminee',
      'La campagne d’évaluation est terminée',
      'La fiche ne change plus.',
    );
  }
}

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
    n2: await n2DeLaFiche(tx, employeeId, annee, annuelle),
    envoyeeAuN2Le: annuelle.envoyeeAuN2Le,
    // Sans envoi au N+2, la fiche n'a pas de commentaires du N+2 (ADR-0278).
    etatDesCommentaires: annuelle.envoyeeAuN2Le ? etatDesCommentaires(annuelle) : null,
    // Le brouillon du N+2 reste au N+2 : le N+1 ne lit que ce qui est transmis.
    commentairesDuN2: annuelle.commentairesDuN2,
    repriseAuN2Le: annuelle.repriseAuN2Le,
    dch: etatDeLaTransmission(annuelle),
    transmiseALaDCHLe: annuelle.transmiseALaDCHLe,
    modifiable:
      autoTransmise &&
      evaluationOuverte(phase) &&
      etatDeLEvaluation !== 'transmise' &&
      etatDeLEvaluation !== 'validee',
  };
}

/**
 * L'évaluation d'un agent de son équipe, encore à écrire : son
 * auto-évaluation transmise, la période ouverte, l'évaluation ni transmise
 * ni validée. Sinon, le refus qui dit pourquoi. L'écriture et l'aperçu en
 * PDF passent par là : ce qui ne s'écrit plus ne se prévisualise plus
 * (ADR-0289).
 */
async function evaluationEcrivable(tx: Tx, user: SessionUser, employeeId: string) {
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
  const autoTransmiseLe = agent.auto.transmiseLe;
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
  return { annee, moi, agent, autoTransmiseLe, annuelle };
}

/**
 * Écrit l'évaluation d'un agent de son équipe : le brouillon, ou la version
 * transmise, une fois complète. Transmise, elle part à l'agent, et au N+2
 * avec `envoyerAuN2` : c'est le seul moment de cet envoi (ADR-0278), et le
 * N+2 de ce jour-là la garde (ADR-0289).
 */
async function ecrireEvaluation(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  { evaluation, reservee }: EcritureDeLEvaluation,
  transmettre: boolean,
  envoyerAuN2 = false,
): Promise<void> {
  const { annee, moi, agent, autoTransmiseLe, annuelle } = await evaluationEcrivable(
    tx,
    user,
    employeeId,
  );
  const personnel = personnelDeLaFiche(agent.personnel);
  const surLaFiche = evaluationSurLaFiche(evaluation, annuelle.objectifs, personnel);
  // Transmise, l'évaluation part sans les lignes de ses tableaux restées
  // vides, ni un arrondi à 2 que la moyenne ne permet plus (ADR-0276).
  const propre = transmettre
    ? avecSonArrondi(sansLignesVides(surLaFiche), annuelle.objectifs)
    : surLaFiche;
  const n2 = transmettre && envoyerAuN2 ? await n2De(tx, employeeId, annee) : null;
  if (transmettre && envoyerAuN2 && !n2) {
    problem(409, 'campagne.sans_n2', 'Cet agent n’a pas de N+2');
  }
  if (transmettre) {
    // L'entretien a lieu entre la transmission de l'auto-évaluation et le
    // jour où l'évaluation part à l'agent (ADR-0265).
    const { aujourdhui } = await prisePoste(tx, employeeId);
    const manque = ceQuiManqueALEvaluationDuN1(propre, reservee, annuelle.objectifs, personnel, {
      du: autoTransmiseLe,
      au: aujourdhui,
    });
    if (manque.length > 0) {
      problem(
        422,
        'campagne.evaluation_incomplete',
        'Évaluation incomplète',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  // La ligne existe : l'auto-évaluation transmise l'a créée. L'écriture
  // revérifie tout ce qui précède sous le verrou de la ligne : transmise
  // entre-temps, remise à zéro, ou passée à un autre évaluateur, la fiche
  // ne prend pas ce texte, et la réponse le dit (ADR-0289).
  const { rows } = await tx.execute(sql`
    UPDATE fiches_entretien f
       SET evaluation = ${JSON.stringify(propre)}::jsonb,
           reservee = ${JSON.stringify(reservee)}::jsonb,
           evaluation_par_employee_id = ${moi},
           evaluation_transmise_le = ${transmettre ? sql`now()` : sql`NULL`},
           envoyee_n2_le = ${n2 ? sql`now()` : sql`NULL`},
           envoyee_n2_a = ${n2?.id ?? null},
           updated_at = now()
      FROM employees e
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee} AND e.id = f.employee_id
       AND f.auto_transmise_le IS NOT NULL
       AND f.evaluation_transmise_le IS NULL AND f.validee_le IS NULL
       AND ${EVALUATEUR} = ${moi}
    RETURNING f.id`);
  if (rows.length === 0) {
    await evaluationEcrivable(tx, user, employeeId);
    ficheModifiee();
  }
}

/**
 * La fiche a changé entre la lecture et l'écriture, sans qu'un refus plus
 * précis s'applique : rien ne s'écrit, la page se recharge.
 */
function ficheModifiee(): never {
  return problem(
    409,
    'campagne.fiche_modifiee',
    'La fiche vient de changer',
    'Rechargez la page pour la voir telle qu’elle est.',
  );
}

/**
 * Le N+2 de la fiche : le destinataire de l'envoi, gardé avec la fiche ;
 * sans envoi, le N+2 d'aujourd'hui, qui la recevrait (ADR-0289).
 */
async function n2DeLaFiche(
  tx: Tx,
  employeeId: string,
  annee: number,
  annuelle: FicheDeLAnnee,
): Promise<PersonneDeLaCampagne | null> {
  if (annuelle.envoyeeAuN2Le) return annuelle.destinataireN2?.personne ?? null;
  return (await n2De(tx, employeeId, annee))?.personne ?? null;
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
    // Sans la confirmation de l'entretien, pas de date d'entretien (ADR-0265).
    dateDeLEntretien: e.entretienConfirme ? e.dateDeLEntretien : null,
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
  const { annee, id } = await autoEcrivable(tx, user);
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
  // ne se réécrit plus, même par deux envois qui se croisent : le second
  // reçoit le refus du premier (ADR-0289).
  const { rows } = await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, auto, auto_transmise_le)
    VALUES (${uuidv7()}, ${user.tenantId}, ${id}, ${annee}, ${JSON.stringify(ecrite)}::jsonb,
            ${transmettre ? sql`now()` : sql`NULL`})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET auto = EXCLUDED.auto,
           auto_transmise_le = EXCLUDED.auto_transmise_le,
           updated_at = now()
     WHERE fiches_entretien.auto_transmise_le IS NULL
    RETURNING id`);
  if (rows.length === 0) autoDejaTransmise();
}

const autoDejaTransmise = (): never =>
  problem(409, 'campagne.auto_transmise', 'Auto-évaluation déjà transmise');

/**
 * Son auto-évaluation, encore à écrire : pendant sa période, et tant
 * qu'elle n'est pas transmise. L'écriture et l'aperçu passent par là.
 */
async function autoEcrivable(tx: Tx, user: SessionUser): Promise<{ annee: number; id: string }> {
  const annee = await anneeDeLaCampagne(tx);
  const { id, auto } = await monDossierEvalue(tx, user, annee);
  const { phase } = await periodeDe(tx, annee);
  if (phase !== 'auto_evaluation') {
    problem(409, 'campagne.auto_fermee', 'L’auto-évaluation n’est pas ouverte');
  }
  if (auto.etat === 'transmise') autoDejaTransmise();
  return { annee, id };
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
  /** AAAA-MM-JJ : l'envoi au N+2, avec l'évaluation ; `null` sans envoi (ADR-0278). */
  envoyeeAuN2Le: string | null;
  /**
   * Le N+2 à qui la fiche a été envoyée, gardé à l'envoi (ADR-0289) ; `null`
   * sans envoi, ou si son dossier n'existe plus.
   */
  destinataireN2: { id: string; personne: PersonneDeLaCampagne } | null;
  /** Le N+1 qui a transmis l'évaluation à l'agent, et qui la signe (ADR-0289). */
  signataireN1: PersonneDeLaCampagne | null;
  /** Le brouillon des commentaires du N+2 ; `null` tant que rien n'est écrit. */
  commentairesN2: string | null;
  /** Les commentaires du N+2, une fois transmis au N+1. */
  commentairesDuN2: CommentairesDuN2 | null;
  /** AAAA-MM-JJ : la reprise au N+2, définitive (ADR-0278). */
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
    envoyee_n2_le: string | null;
    d_id: string | null;
    d_prenom: string | null;
    d_nom: string | null;
    d_poste: string | null;
    s_prenom: string | null;
    s_nom: string | null;
    s_poste: string | null;
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
           f.validee_le::date::text AS validee_le,
           f.envoyee_n2_le::date::text AS envoyee_n2_le,
           d.id AS d_id, pd.given_name AS d_prenom, pd.family_name AS d_nom,
           ad.position_title AS d_poste,
           ps.given_name AS s_prenom, ps.family_name AS s_nom, asg.position_title AS s_poste,
           f.commentaires_n2,
           f.commentaires_n2_transmis_le::date::text AS commentaires_n2_le,
           pc.given_name AS n2_prenom, pc.family_name AS n2_nom, ac.position_title AS n2_poste,
           f.reprise_n2_le::date::text AS reprise_n2_le,
           f.transmise_dch_le::date::text AS transmise_dch_le,
           pt.given_name AS t_prenom, pt.family_name AS t_nom, atr.position_title AS t_poste
      FROM fiches_entretien f
      -- Chaque signature avec le poste du jour de son geste : elle ne
      -- change plus quand la personne change de poste ou part.
      LEFT JOIN employees d ON d.id = f.envoyee_n2_a AND f.envoyee_n2_le IS NOT NULL
      LEFT JOIN persons pd ON pd.id = d.person_id
      LEFT JOIN assignments ad ON ad.employee_id = d.id
                               AND ad.validity @> f.envoyee_n2_le::date
      LEFT JOIN employees sg ON sg.id = f.evaluation_par_employee_id
                             AND f.evaluation_transmise_le IS NOT NULL
      LEFT JOIN persons ps ON ps.id = sg.person_id
      LEFT JOIN assignments asg ON asg.employee_id = sg.id
                                AND asg.validity @> f.evaluation_transmise_le::date
      LEFT JOIN employees c ON c.id = f.commentaires_n2_par
      LEFT JOIN persons pc ON pc.id = c.person_id
      LEFT JOIN assignments ac ON ac.employee_id = c.id
                               AND ac.validity @> COALESCE(f.commentaires_n2_transmis_le::date,
                                                           CURRENT_DATE)
      LEFT JOIN employees t ON t.id = f.transmise_dch_par
      LEFT JOIN persons pt ON pt.id = t.person_id
      LEFT JOIN assignments atr ON atr.employee_id = t.id
                                AND atr.validity @> COALESCE(f.transmise_dch_le::date, CURRENT_DATE)
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee}
     LIMIT 1`);
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
    envoyeeAuN2Le: r?.envoyee_n2_le ?? null,
    destinataireN2:
      r?.d_id && r.d_nom
        ? { id: r.d_id, personne: { prenom: r.d_prenom!, nom: r.d_nom, poste: r.d_poste } }
        : null,
    signataireN1: r?.s_nom ? { prenom: r.s_prenom!, nom: r.s_nom, poste: r.s_poste } : null,
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
    envoyee: f.envoyeeAuN2Le !== null,
    commences: f.commentairesN2 !== null,
    transmis: f.commentairesDuN2 !== null,
    reprise: f.repriseAuN2Le !== null,
  });
}

/**
 * Où en est la transmission de la fiche à la DCH : transmise, prête, ou en
 * attente de la validation de l'agent, puis des commentaires du N+2 quand
 * la fiche a été envoyée au N+2 (ADR-0278). Reprise au N+2, la fiche est
 * prête (ADR-0221).
 */
const etatDeLaTransmissionDe = (f: {
  validee: boolean;
  envoyeeAuN2: boolean;
  commentairesTransmis: boolean;
  reprise: boolean;
  transmise: boolean;
}): EtatDeLaTransmission =>
  f.transmise
    ? 'transmise'
    : f.validee && (!f.envoyeeAuN2 || f.commentairesTransmis || f.reprise)
      ? 'a_transmettre'
      : 'en_attente';

const etatDeLaTransmission = (f: FicheDeLAnnee) =>
  etatDeLaTransmissionDe({
    validee: f.valideeLe !== null,
    envoyeeAuN2: f.envoyeeAuN2Le !== null,
    commentairesTransmis: f.commentairesDuN2 !== null,
    reprise: f.repriseAuN2Le !== null,
    transmise: f.transmiseALaDCHLe !== null,
  });

/**
 * L'état de l'évaluation, sur ce que garde la fiche de l'année : validée,
 * transmise, commencée, ou encore à faire. Une évaluation renvoyée par
 * l'agent avant l'ADR-0267 se lit comme un brouillon du N+1 : commencée.
 */
function etatDeLEvaluation(f: {
  commencee: boolean;
  transmise: boolean;
  validee: boolean;
}): EtatDeLEvaluation {
  if (f.validee) return 'validee';
  if (f.transmise) return 'transmise';
  return f.commencee ? 'en_cours' : 'a_faire';
}

const etatSurLaFiche = (f: FicheDeLAnnee) =>
  etatDeLEvaluation({
    commencee: f.evaluation !== null,
    transmise: f.evaluationTransmiseLe !== null,
    validee: f.valideeLe !== null,
  });

/** Ce que l'agent sait de son évaluation : rien du brouillon du N+1. */
const POUR_L_AGENT: Record<EtatDeLEvaluation, EtatDeMonEvaluation> = {
  a_faire: 'en_attente',
  en_cours: 'en_attente',
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
    matricule: fiche.matricule,
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
    validable: recue.etat === 'a_valider' && !evaluationTerminee(phase),
  };
}

/** Son évaluation, transmise et pas encore validée ; sinon, 409. */
async function aValider(tx: Tx, user: SessionUser): Promise<{ id: string; annee: number }> {
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
  return { id, annee };
}

/**
 * L'agent valide son évaluation, à tout moment une fois transmise : la
 * fiche n'est valable qu'une fois validée. Elle ne change plus ensuite, même
 * par deux gestes qui se croisent.
 */
async function validerMonEvaluationDans(tx: Tx, user: SessionUser): Promise<void> {
  const { id, annee } = await aValider(tx, user);
  await ficheNonVerrouillee(tx, annee);
  const { rows } = await tx.execute(sql`
    UPDATE fiches_entretien SET validee_le = now(), updated_at = now()
     WHERE employee_id = ${id} AND annee = ${annee}
       AND evaluation_transmise_le IS NOT NULL AND validee_le IS NULL
    RETURNING id`);
  if (rows.length === 0) {
    await aValider(tx, user);
    ficheModifiee();
  }
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

/** Les agents qu'évalue la personne connectée, par ordre alphabétique. */
async function equipeDe(tx: Tx, id: string, annee: number): Promise<AgentDeLEquipe[]> {
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
    envoyee_n2: boolean;
    commentaires_commences: boolean;
    commentaires_transmis: boolean;
    reprise: boolean;
    transmise_dch: boolean;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste, e.work_email AS email, e.personnel,
           f.envoyee_n2_le IS NOT NULL AS envoyee_n2,
           f.commentaires_n2 IS NOT NULL AS commentaires_commences,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.reprise_n2_le IS NOT NULL AS reprise,
           f.transmise_dch_le IS NOT NULL AS transmise_dch,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee
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
    }),
    // Sans envoi au N+2, la fiche n'a pas de commentaires du N+2 (ADR-0278).
    commentaires: r.envoyee_n2
      ? etatDesCommentairesDe({
          envoyee: true,
          commences: r.commentaires_commences,
          transmis: r.commentaires_transmis,
          reprise: r.reprise,
        })
      : null,
    dch: etatDeLaTransmissionDe({
      validee: r.evaluation_validee,
      envoyeeAuN2: r.envoyee_n2,
      commentairesTransmis: r.commentaires_transmis,
      reprise: r.reprise,
      transmise: r.transmise_dch,
    }),
  }));
}

/** Où en sont les commentaires du N+2 : rien sans l'envoi de la fiche au N+2 (ADR-0278). */
const etatDesCommentairesDe = (f: {
  envoyee: boolean;
  commences: boolean;
  transmis: boolean;
  reprise: boolean;
}): EtatDesCommentaires =>
  !f.envoyee
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
 * Les fiches arrivées chez le N+2 qu'est la personne connectée : celles que
 * le N+1 a envoyées à cette personne avec l'évaluation, rangées par N+1, puis par ordre
 * alphabétique. Une fiche reprise par le N+1 y reste, en lecture (ADR-0255,
 * ADR-0278). Le destinataire se fixe le jour de l'envoi : un changement
 * d'organigramme ne la fait ni partir ni arriver ailleurs (ADR-0289).
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
     WHERE ${evaluable(sql`e`)} AND e.id <> ${id}
       AND f.envoyee_n2_le IS NOT NULL AND f.envoyee_n2_a = ${id}
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
    }),
    commentaires: etatDesCommentairesDe({
      envoyee: true,
      commences: r.commentaires_commences,
      transmis: r.commentaires_transmis,
      reprise: r.reprise,
    }),
  }));
}

/**
 * Un agent dont la personne connectée est le N+2 ; sinon, introuvable. La
 * fiche envoyée est à son destinataire, gardé à l'envoi ; avant l'envoi, le
 * N+2 d'aujourd'hui voit seulement où elle en est (ADR-0289).
 */
async function monN2(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (moi) {
    const { rows } = await tx.execute<{ envoyee: boolean; a: string | null }>(sql`
      SELECT f.envoyee_n2_le IS NOT NULL AS envoyee, f.envoyee_n2_a AS a
        FROM employees e
        LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
       WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND e.id <> ${moi}`);
    const r = rows[0];
    if (r && (r.envoyee ? r.a === moi : (await n2De(tx, employeeId, annee))?.id === moi)) {
      return { moi, annee };
    }
  }
  return problem(
    404,
    'campagne.agent_hors_perimetre',
    'Agent introuvable parmi les équipes de vos N+1',
  );
}

/**
 * La fiche d'un agent, telle que son N+2 l'ouvre : en entier, partie
 * réservée comprise, une fois envoyée par le N+1, sans attendre la
 * validation de l'agent ; sans envoi, seulement où elle en est. Reprise par
 * le N+1, le N+2 la lit toujours, sans plus la commenter (ADR-0278).
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
  return {
    annee,
    periode,
    phase,
    agent,
    objectifs: annuelle.objectifs,
    fiche: annuelle.envoyeeAuN2Le
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
    envoyeeLe: annuelle.envoyeeAuN2Le,
    transmisLe: annuelle.commentairesDuN2?.le ?? null,
    repriseLe: annuelle.repriseAuN2Le,
    modifiable: (etat === 'a_commenter' || etat === 'en_cours') && !evaluationTerminee(phase),
  };
}

/**
 * Écrit les commentaires du N+2 : le brouillon, ou la version transmise au
 * N+1, avec ou sans un mot. Seulement la fiche envoyée par le N+1, validée
 * par l'agent ou pas encore (ADR-0278), tant qu'ils ne sont pas transmis et
 * que la fiche n'est pas reprise ; transmis, ils ne se réécrivent plus.
 */
async function ecrireCommentaires(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  commentaires: string,
  transmettre: boolean,
): Promise<void> {
  const { moi, annee } = await commentairesEcrivables(tx, user, employeeId);
  // Revérifié sous le verrou de la ligne : reprise ou transmise entre-temps,
  // la fiche ne prend pas ces commentaires, et la réponse dit pourquoi.
  const { rows } = await tx.execute(sql`
    UPDATE fiches_entretien
       SET commentaires_n2 = ${commentaires}, commentaires_n2_par = ${moi},
           commentaires_n2_transmis_le = ${transmettre ? sql`now()` : sql`NULL`},
           updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND envoyee_n2_le IS NOT NULL AND envoyee_n2_a = ${moi}
       AND commentaires_n2_transmis_le IS NULL AND reprise_n2_le IS NULL
       AND transmise_dch_le IS NULL
    RETURNING id`);
  if (rows.length === 0) {
    await commentairesEcrivables(tx, user, employeeId);
    ficheModifiee();
  }
}

/**
 * Les commentaires du N+2, encore à écrire : la fiche envoyée à la personne
 * connectée, ni commentée, ni reprise, ni transmise à la DCH, la campagne
 * en cours. Sinon, le refus qui dit pourquoi.
 */
async function commentairesEcrivables(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const { moi, annee } = await monN2(tx, user, employeeId);
  await ficheNonVerrouillee(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (!annuelle.envoyeeAuN2Le) {
    problem(409, 'campagne.fiche_non_envoyee', 'La fiche ne vous a pas été envoyée');
  }
  if (annuelle.commentairesDuN2) {
    problem(409, 'campagne.commentaires_transmis', 'Commentaires déjà transmis');
  }
  if (annuelle.repriseAuN2Le) repriseParLeN1();
  if (annuelle.transmiseALaDCHLe) ficheTransmise();
  return { moi, annee };
}

/** La fiche reprise par le N+1 : le N+2 la lit, sans plus la commenter (ADR-0278). */
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
 * Le N+1 transmet la fiche à la DCH : validée par l'agent, et, quand elle a
 * été envoyée au N+2, une fois ses commentaires reçus ou la fiche reprise ;
 * sans envoi au N+2, dès la validation (ADR-0278). Transmise, elle ne
 * change plus.
 */
async function transmettreALaDCHDans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  const { moi, annee } = await transmissibleALaDCH(tx, user, employeeId);
  // Revérifié sous le verrou de la ligne, comme l'évaluation (ADR-0289).
  const { rows } = await tx.execute(sql`
    UPDATE fiches_entretien f
       SET transmise_dch_le = now(), transmise_dch_par = ${moi}, updated_at = now()
      FROM employees e
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee} AND e.id = f.employee_id
       AND f.validee_le IS NOT NULL AND f.transmise_dch_le IS NULL
       AND (f.envoyee_n2_le IS NULL OR f.commentaires_n2_transmis_le IS NOT NULL
            OR f.reprise_n2_le IS NOT NULL)
       AND ${EVALUATEUR} = ${moi}
    RETURNING f.id`);
  if (rows.length === 0) {
    await transmissibleALaDCH(tx, user, employeeId);
    ficheModifiee();
  }
}

/** La fiche, prête à partir à la DCH par la personne connectée ; sinon, le refus qui dit pourquoi. */
async function transmissibleALaDCH(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const { moi, annee } = await monAgent(tx, user, employeeId);
  await ficheNonVerrouillee(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const etat = etatDeLaTransmission(annuelle);
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
  return { moi, annee };
}

/**
 * Le N+1 reprend la fiche au N+2 qui ne l'a pas encore commentée, validée
 * par l'agent ou pas encore : le N+2 la lit toujours, sans plus la
 * commenter, et le N+1 pourra la transmettre à la DCH. La reprise est
 * définitive : la fiche ne repart plus au N+2 (ADR-0278).
 */
async function reprendreAuN2Dans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  const { moi, annee } = await reprenableAuN2(tx, user, employeeId);
  const { rows } = await tx.execute(sql`
    UPDATE fiches_entretien f SET reprise_n2_le = now(), updated_at = now()
      FROM employees e
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee} AND e.id = f.employee_id
       AND f.envoyee_n2_le IS NOT NULL AND f.commentaires_n2_transmis_le IS NULL
       AND f.reprise_n2_le IS NULL AND f.transmise_dch_le IS NULL
       AND ${EVALUATEUR} = ${moi}
    RETURNING f.id`);
  if (rows.length === 0) {
    await reprenableAuN2(tx, user, employeeId);
    ficheModifiee();
  }
}

/** La fiche chez le N+2, pas encore commentée, que la personne connectée peut reprendre. */
async function reprenableAuN2(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const { moi, annee } = await monAgent(tx, user, employeeId);
  await ficheNonVerrouillee(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (annuelle.transmiseALaDCHLe) ficheTransmise();
  if (!annuelle.envoyeeAuN2Le || annuelle.repriseAuN2Le) {
    problem(409, 'campagne.fiche_pas_chez_le_n2', 'La fiche n’est pas chez le N+2');
  }
  if (annuelle.commentairesDuN2) {
    problem(409, 'campagne.commentaires_transmis', 'Commentaires déjà transmis');
  }
  return { moi, annee };
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
  const moi = await employeDuCompte(tx, user.userId);
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
    commentaires_transmis: boolean;
    reprise: boolean;
    envoyee_n2: boolean;
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
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.reprise_n2_le IS NOT NULL AS reprise,
           f.envoyee_n2_le IS NOT NULL AS envoyee_n2,
           f.transmise_dch_le::date::text AS transmise_le,
           p1.given_name AS n1_prenom, p1.family_name AS n1_nom, a1.position_title AS n1_poste
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      LEFT JOIN employees n1 ON n1.id = ${EVALUATEUR}
      LEFT JOIN persons p1 ON p1.id = n1.person_id
      LEFT JOIN assignments a1 ON a1.employee_id = n1.id AND a1.validity @> CURRENT_DATE
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
      // Sa propre fiche ne s'ouvre pas depuis le suivi (ADR-0289).
      ouvrable: r.transmise_le !== null && r.id !== moi,
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
  commentaires_transmis: boolean;
  reprise: boolean;
  envoyee_n2: boolean;
  transmise_le: string | null;
}): EtapeDeLaFiche {
  if (r.transmise_le) return 'transmise';
  if (!r.auto_transmise) return 'auto_non_faite';
  const evaluation = etatDeLEvaluation({
    commencee: r.evaluation_commencee,
    transmise: r.evaluation_transmise,
    validee: r.evaluation_validee,
  });
  if (evaluation === 'transmise') return 'chez_l_agent';
  if (evaluation !== 'validee') return 'chez_le_n1';
  // Chez l'agent d'abord : sa validation compte, même quand le N+2 a la
  // fiche en même temps (ADR-0278).
  return r.envoyee_n2 && !r.commentaires_transmis && !r.reprise ? 'chez_le_n2' : 'a_transmettre';
}

/** Une fiche transmise, et ce que le PDF imprime en plus : la prise du poste, le jour. */
interface FicheLueParLaDCH {
  fiche: FichePourLaDCH;
  /** AAAA-MM-JJ. */
  posteDepuis: string | null;
  aujourdhui: string;
}

/** Ce que le PDF complet imprime d'une fiche, partie réservée comprise. */
interface FicheDuPdfComplet {
  fiche: Pick<
    FichePourLaDCH,
    | 'annee'
    | 'agent'
    | 'objectifs'
    | 'fiche'
    | 'evaluationTransmiseLe'
    | 'valideeLe'
    | 'evaluePar'
    | 'n2'
    | 'commentairesDuN2'
  >;
  /** AAAA-MM-JJ. */
  posteDepuis: string | null;
  aujourdhui: string;
}

/**
 * La fiche d'un agent, transmise à la DCH, en entier ; avant, la DCH ne la
 * lit pas. Sa propre fiche non plus : la partie réservée à la hiérarchie et
 * les commentaires du N+2 ne sont pas pour l'agent, membre de la DCH ou non
 * (ADR-0268, ADR-0289).
 */
async function ficheDeLaDCHDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<FicheLueParLaDCH> {
  reserveALaDCH(user);
  const annee = await anneeDeLaCampagne(tx);
  if ((await employeDuCompte(tx, user.userId)) === employeeId) {
    problem(403, 'campagne.sa_propre_fiche', 'Votre propre fiche ne s’ouvre pas depuis le suivi');
  }
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (!annuelle.transmiseALaDCHLe) {
    problem(409, 'campagne.fiche_non_transmise', 'La fiche n’est pas encore transmise à la DCH');
  }
  const agent = await ficheDe(tx, employeeId, annee);
  const { posteDepuis, aujourdhui } = await prisePoste(tx, employeeId);
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
      evaluePar: annuelle.signataireN1,
      n2: await n2DeLaFiche(tx, employeeId, annee, annuelle),
      commentairesDuN2: annuelle.commentairesDuN2,
      repriseAuN2Le: annuelle.commentairesDuN2 ? null : annuelle.repriseAuN2Le,
      transmiseLe: annuelle.transmiseALaDCHLe,
      transmisePar: annuelle.transmisePar,
    },
    posteDepuis,
    aujourdhui,
  };
}

/** Le jour où l'agent a pris son poste actuel, et celui d'aujourd'hui : son ancienneté. */
async function prisePoste(
  tx: Tx,
  employeeId: string,
): Promise<{ posteDepuis: string | null; aujourdhui: string }> {
  const { rows } = await tx.execute<{ poste_depuis: string | null; aujourdhui: string }>(sql`
    SELECT (SELECT lower(a.validity)::text FROM assignments a
             WHERE a.employee_id = ${employeeId} AND a.validity @> CURRENT_DATE
             LIMIT 1) AS poste_depuis,
           CURRENT_DATE::text AS aujourdhui`);
  return { posteDepuis: rows[0]?.poste_depuis ?? null, aujourdhui: rows[0]!.aujourdhui };
}

/** L'agent tel que le PDF de sa fiche le présente. */
function agentDuPdf(
  a: AgentDeLaCampagne,
  posteDepuis: string | null,
  aujourdhui: string,
): DonneesDeLaFiche['agent'] {
  return {
    prenom: a.prenom,
    nom: a.nom,
    fonction: a.poste,
    matricule: a.matricule,
    direction: a.direction,
    departement: a.departement,
    service: a.service,
    anciennete: posteDepuis ? ancienneteEnLettres(posteDepuis, aujourdhui) : null,
    posteDepuis,
  };
}

/**
 * Ce que le PDF imprime d'une fiche transmise : la version complète, partie
 * réservée comprise, avec les validations en ligne. La date de l'entretien
 * est celle que le N+1 a confirmée (ADR-0265) ; sur une fiche transmise
 * avant, le PDF la laisse à fixer.
 */
function donneesDuPdf({ fiche: f, posteDepuis, aujourdhui }: FicheDuPdfComplet): DonneesDeLaFiche {
  const a = f.agent;
  // La personne qui a transmis l'évaluation la signe, même après un
  // changement de poste ou un départ de l'APIX (ADR-0289).
  const n1 = f.evaluePar ?? a.evaluateur;
  const c = f.commentairesDuN2;
  const n2 = c?.par ?? f.n2;
  return {
    annee: f.annee,
    personnel: personnelDeLaFiche(a.personnel),
    agent: agentDuPdf(a, posteDepuis, aujourdhui),
    n1: n1 ? { prenom: n1.prenom, nom: n1.nom, fonction: n1.poste } : null,
    dateDeLEntretien: f.fiche.evaluation.dateDeLEntretien,
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

/**
 * La fiche complète d'un agent, en PDF, pour qui la lit en entier, partie
 * réservée comprise : son N+1 et son N+2 (ADR-0279), comme la DCH. Les
 * commentaires du N+2 n'y figurent qu'une fois transmis, jamais leur
 * brouillon.
 */
async function pdfCompletDe(
  tx: Tx,
  employeeId: string,
  annee: number,
  annuelle: FicheDeLAnnee,
): Promise<DonneesDeLaFiche> {
  const agent = await ficheDe(tx, employeeId, annee);
  const n2 = await n2DeLaFiche(tx, employeeId, annee, annuelle);
  const { posteDepuis, aujourdhui } = await prisePoste(tx, employeeId);
  return donneesDuPdf({
    fiche: {
      annee,
      agent,
      objectifs: annuelle.objectifs,
      fiche: {
        auto: annuelle.auto ?? autoEvaluationVide(),
        evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
        reservee: annuelle.reservee ?? partieReserveeVide(),
      },
      evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
      valideeLe: annuelle.valideeLe,
      evaluePar: annuelle.signataireN1,
      n2,
      commentairesDuN2: annuelle.commentairesDuN2,
    },
    posteDepuis,
    aujourdhui,
  });
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
    avancement: AvancementDeLaFiche | null;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction,
           m.id AS m_id, pm.given_name AS m_prenom, pm.family_name AS m_nom,
           m.employee_number AS m_matricule, am.position_title AS m_poste,
           c.id AS c_id, pc.given_name AS c_prenom, pc.family_name AS c_nom,
           c.employee_number AS c_matricule, ac.position_title AS c_poste,
           f.transmise_dch_le IS NOT NULL AS transmise,
           ${sql.raw(avancementDeLaFiche('f'))} AS avancement
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
  const suivante = annee + 1;
  return {
    annee,
    periode,
    phase,
    objectifs: { annee: suivante, ...(await periodeDesObjectifsDe(tx, suivante)) },
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
      avancement: r.avancement,
    })),
  };
}

/**
 * Les dates de l'évaluation de l'année : le début, la fin de
 * l'auto-évaluation, la fin. La période commence dans l'année évaluée ou
 * la suivante, comme sur la plateforme de base, et finit avant la fixation
 * des objectifs de l'année suivante (ADR-0274).
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
  const { periode: objectifs } = await periodeDesObjectifsDe(tx, annee + 1);
  if (objectifs && d.au >= objectifs.du) {
    problem(
      422,
      'campagne.evaluation_apres_les_objectifs',
      `L’évaluation ${annee} doit finir avant le début de la fixation des objectifs ${annee + 1} (${dateEnLettres(objectifs.du)})`,
    );
  }
  await tx.execute(sql`
    INSERT INTO evaluation_periodes (id, tenant_id, annee, du, auto_au, au)
    VALUES (${uuidv7()}, ${user.tenantId}, ${annee}, ${d.du}, ${d.autoAu}, ${d.au})
    ON CONFLICT (tenant_id, annee) DO UPDATE
       SET du = EXCLUDED.du, auto_au = EXCLUDED.auto_au, au = EXCLUDED.au, updated_at = now()`);
}

/**
 * La remise à zéro d'une fiche par l'administration (ADR-0271), sur un agent
 * de la campagne : ce que la campagne y a écrit s'efface, comme avec la
 * commande pnpm campagne:reinitialiser (ADR-0270).
 */
async function remettreAZeroDans(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
  reserveALAdministration(user);
  const annee = await anneeDeLaCampagne(tx);
  const { rows } = await tx.execute(
    sql`SELECT 1 FROM employees e WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)}`,
  );
  if (rows.length === 0) {
    problem(404, 'campagne.agent_introuvable', 'Agent introuvable parmi les agents de la campagne');
  }
  await tx.execute(sql`
    UPDATE fiches_entretien f
       SET ${sql.raw(REMISE_A_ZERO)}, updated_at = now()
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee}
       AND ${sql.raw(ficheCommencee('f'))}`);
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
  const { rows: ecrits } = await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, evaluateur_employee_id)
    VALUES (${uuidv7()}, ${user.tenantId}, ${employeeId}, ${annee}, ${choisi})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET evaluateur_employee_id = EXCLUDED.evaluateur_employee_id, updated_at = now()
     WHERE fiches_entretien.transmise_dch_le IS NULL
    RETURNING id`);
  // Transmise à la DCH pendant ce choix : elle garde son évaluateur.
  if (ecrits.length === 0) ficheTransmise();
}

// ──────────────────────────────────────────────── la fixation des objectifs (ADR-0274)

/**
 * L'année des objectifs : celle qui suit l'évaluation de la campagne. Avec
 * CAMPAGNE_D_EVALUATION=2026, la fixation des objectifs de 2027.
 */
async function anneeDesObjectifs(tx: Tx): Promise<number> {
  return (await anneeDeLaCampagne(tx)) + 1;
}

/** La période de la fixation des objectifs d'une année, et la phase du jour. */
async function periodeDesObjectifsDe(
  tx: Tx,
  annee: number,
): Promise<{ periode: PeriodeDesObjectifs | null; phase: PhaseDesObjectifs }> {
  const { rows } = await tx.execute<{ du: string; au: string; phase: PhaseDesObjectifs }>(sql`
    SELECT du::text, au::text,
           CASE WHEN CURRENT_DATE < du THEN 'a_venir'
                WHEN CURRENT_DATE <= au THEN 'ouverte'
                ELSE 'terminee' END AS phase
      FROM objectifs_periodes WHERE annee = ${annee}`);
  const r = rows[0];
  if (!r) return { periode: null, phase: 'non_fixee' };
  return { periode: { du: r.du, au: r.au }, phase: r.phase };
}

/** La fixation des objectifs, une fois ouverte ; avant, `null` : rien ne l'annonce. */
async function fixationOuverte(
  tx: Tx,
): Promise<{ annee: number; periode: PeriodeDesObjectifs; phase: 'ouverte' | 'terminee' } | null> {
  const annee = await anneeDesObjectifs(tx);
  const { periode, phase } = await periodeDesObjectifsDe(tx, annee);
  if (!periode || (phase !== 'ouverte' && phase !== 'terminee')) return null;
  return { annee, periode, phase };
}

/** Transmis à l'agent, les objectifs ne changent plus. */
const objectifsDejaTransmis = () =>
  problem(409, 'campagne.objectifs_transmis', 'Objectifs déjà transmis à l’agent');

/** Les objectifs relus sur la fiche de l'année : ceux transmis à l'agent, sinon le brouillon du N+1. */
interface ObjectifsSurLaFiche {
  objectifs: ObjectifDeLAnneeAVenir[];
  etat: EtatDesObjectifs;
  /** AAAA-MM-JJ. */
  transmisLe: string | null;
  /** Le N+1 qui les a écrits. */
  par: PersonneDeLaCampagne | null;
}

async function objectifsSurLaFiche(
  tx: Tx,
  employeeId: string,
  annee: number,
): Promise<ObjectifsSurLaFiche> {
  const { rows } = await tx.execute<{
    objectifs: unknown;
    brouillon: unknown;
    transmis_le: string | null;
    par_prenom: string | null;
    par_nom: string | null;
    par_poste: string | null;
  }>(sql`
    SELECT f.objectifs, f.objectifs_brouillon AS brouillon,
           f.objectifs_transmis_le::date::text AS transmis_le,
           pp.given_name AS par_prenom, pp.family_name AS par_nom, ap.position_title AS par_poste
      FROM fiches_entretien f
      LEFT JOIN employees par ON par.id = f.objectifs_par_employee_id
      LEFT JOIN persons pp ON pp.id = par.person_id
      LEFT JOIN assignments ap ON ap.employee_id = par.id AND ap.validity @> CURRENT_DATE
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee}`);
  const r = rows[0];
  const par = r?.par_nom
    ? { prenom: r.par_prenom ?? '', nom: r.par_nom, poste: r.par_poste }
    : null;
  if (r?.transmis_le) {
    // Transmis, ils sont les objectifs de la fiche.
    const transmis = objectifEvalueSchema.array().safeParse(r.objectifs);
    return {
      objectifs: transmis.success
        ? transmis.data.map((o) => ({
            objectif: o.intitule,
            indicateur: o.indicateurs,
            echeance: o.echeance ?? null,
          }))
        : [],
      etat: 'transmis',
      transmisLe: r.transmis_le,
      par,
    };
  }
  const brouillon = r?.brouillon ? objectifAVenirSchema.array().safeParse(r.brouillon) : null;
  return {
    objectifs: brouillon?.success ? brouillon.data : [],
    etat: brouillon?.success ? 'en_cours' : 'a_fixer',
    transmisLe: null,
    par,
  };
}

/** Vrai si l'agent, parmi les agents de la campagne, a `n1` pour N+1 dans l'organigramme. */
async function dansSonEquipe(tx: Tx, employeeId: string, n1: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM employees e
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND e.manager_employee_id = ${n1}`);
  return rows.length > 0;
}

/**
 * La fixation des objectifs ouverte, et l'agent dans l'équipe de la personne
 * connectée, dans l'organigramme. Sinon, introuvables : la réponse ne dit
 * pas si ce dossier existe.
 */
async function agentAObjectifs(tx: Tx, user: SessionUser, employeeId: string) {
  const fixation = await fixationOuverte(tx);
  if (!fixation) problem(404, 'campagne.objectifs_introuvables', 'Objectifs introuvables');
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansSonEquipe(tx, employeeId, moi))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  return { ...fixation, moi };
}

async function objectifsDeLAgentDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<ObjectifsDeLAgent> {
  const { annee, periode, phase } = await agentAObjectifs(tx, user, employeeId);
  const { objectifs, etat, transmisLe } = await objectifsSurLaFiche(tx, employeeId, annee);
  return {
    annee,
    periode,
    phase,
    agent: await ficheDe(tx, employeeId, annee),
    objectifs,
    etat,
    transmisLe,
    modifiable: phase === 'ouverte' && etat !== 'transmis',
  };
}

/**
 * Écrit les objectifs d'un agent de son équipe : le brouillon, ou la
 * version transmise, une fois complète. Pendant la période seulement, et
 * tant qu'ils ne sont pas transmis. Transmis, ils partent sans leurs lignes
 * restées vides, et deviennent les objectifs de sa fiche de l'année.
 */
async function ecrireLesObjectifs(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  objectifs: ObjectifDeLAnneeAVenir[],
  transmettre: boolean,
): Promise<void> {
  const { annee, phase, moi } = await agentAObjectifs(tx, user, employeeId);
  if (phase !== 'ouverte') {
    problem(409, 'campagne.objectifs_fermes', 'La fixation des objectifs est terminée');
  }
  if ((await objectifsSurLaFiche(tx, employeeId, annee)).etat === 'transmis') {
    objectifsDejaTransmis();
  }
  const ecrits = objectifsEcrits(objectifs).map((o) => ({
    objectif: o.objectif.trim(),
    indicateur: o.indicateur.trim(),
    echeance: o.echeance,
  }));
  if (transmettre) {
    const manque = ceQuiManqueAuxObjectifs(ecrits, annee);
    if (manque.length > 0) {
      problem(
        422,
        'campagne.objectifs_incomplets',
        'Objectifs incomplets',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  const surLaFiche: ObjectifEvalue[] = ecrits.map((o) => ({
    id: uuidv7(),
    intitule: o.objectif,
    indicateurs: o.indicateur,
    echeance: o.echeance,
  }));
  // Le brouillon garde ses lignes telles qu'elles sont ; rien d'écrit, rien à garder.
  const brouillon = transmettre ? ecrits : ecrits.length > 0 ? objectifs : null;
  const { rows } = await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, objectifs,
           objectifs_brouillon, objectifs_par_employee_id, objectifs_transmis_le)
    VALUES (${uuidv7()}, ${user.tenantId}, ${employeeId}, ${annee},
            ${JSON.stringify(transmettre ? surLaFiche : [])}::jsonb,
            ${brouillon ? JSON.stringify(brouillon) : null}::jsonb, ${moi},
            ${transmettre ? sql`now()` : sql`NULL`})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET objectifs_brouillon = EXCLUDED.objectifs_brouillon,
           objectifs_par_employee_id = EXCLUDED.objectifs_par_employee_id,
           objectifs_transmis_le = EXCLUDED.objectifs_transmis_le,
           ${transmettre ? sql`objectifs = EXCLUDED.objectifs,` : sql``}
           updated_at = now()
     WHERE fiches_entretien.objectifs_transmis_le IS NULL
    RETURNING id`);
  // Deux envois qui se croisent : le second trouve les objectifs transmis.
  if (rows.length === 0) objectifsDejaTransmis();
}

/**
 * La fixation des objectifs sur l'accueil, une fois ouverte : ses propres
 * objectifs, et ceux de son équipe dans l'organigramme. Avant, `null`.
 */
async function objectifsDeLAccueil(
  tx: Tx,
  moi: string | null,
): Promise<ObjectifsDeLAccueil | null> {
  const fixation = await fixationOuverte(tx);
  if (!fixation) return null;
  if (!moi) return { ...fixation, miens: null, equipe: [] };
  return {
    ...fixation,
    miens: await mesObjectifs(tx, moi, fixation.annee),
    equipe: await equipeAObjectifs(tx, moi, fixation.annee),
  };
}

/**
 * Ses propres objectifs, tels que son N+1 les a transmis, jamais le
 * brouillon. Sans N+1 dans l'organigramme, ou hors des agents de la campagne,
 * `null`, à moins d'en avoir déjà reçu.
 */
async function mesObjectifs(
  tx: Tx,
  moi: string,
  annee: number,
): Promise<ObjectifsDeLAccueil['miens']> {
  const lus = await objectifsSurLaFiche(tx, moi, annee);
  if (lus.transmisLe) {
    return { transmis: { objectifs: lus.objectifs, le: lus.transmisLe, par: lus.par } };
  }
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM employees e
      JOIN employees n1 ON n1.id = e.manager_employee_id AND n1.status = 'active'
     WHERE e.id = ${moi} AND ${evaluable(sql`e`)}`);
  return rows.length > 0 ? { transmis: null } : null;
}

/** Son équipe dans l'organigramme, parmi les agents de la campagne, et où en sont leurs objectifs. */
async function equipeAObjectifs(tx: Tx, moi: string, annee: number): Promise<AgentAObjectifs[]> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    email: string | null;
    commences: boolean;
    transmis_le: string | null;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste, e.work_email AS email,
           f.objectifs_brouillon IS NOT NULL AS commences,
           f.objectifs_transmis_le::date::text AS transmis_le
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE ${evaluable(sql`e`)} AND e.manager_employee_id = ${moi}
     ORDER BY p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    email: r.email,
    etat: r.transmis_le ? 'transmis' : r.commences ? 'en_cours' : 'a_fixer',
    transmisLe: r.transmis_le,
  }));
}

/**
 * Les dates de la fixation des objectifs : elle commence dans l'année des
 * objectifs, après la fin de l'évaluation de l'année d'avant.
 */
async function fixerLesDatesDesObjectifsDans(
  tx: Tx,
  user: SessionUser,
  d: DatesDesObjectifs,
): Promise<void> {
  reserveALAdministration(user);
  const annee = await anneeDesObjectifs(tx);
  if (Number(d.du.slice(0, 4)) !== annee) {
    problem(
      422,
      'campagne.dates_hors_annee',
      `La fixation des objectifs ${annee} doit commencer en ${annee}`,
    );
  }
  const { periode: evaluation } = await periodeDe(tx, annee - 1);
  if (evaluation && d.du <= evaluation.au) {
    problem(
      422,
      'campagne.objectifs_avant_la_fin',
      `La fixation des objectifs ${annee} doit commencer après la fin de l’évaluation ${annee - 1} (${dateEnLettres(evaluation.au)})`,
    );
  }
  await tx.execute(sql`
    INSERT INTO objectifs_periodes (id, tenant_id, annee, du, au)
    VALUES (${uuidv7()}, ${user.tenantId}, ${annee}, ${d.du}, ${d.au})
    ON CONFLICT (tenant_id, annee) DO UPDATE
       SET du = EXCLUDED.du, au = EXCLUDED.au, updated_at = now()`);
}
