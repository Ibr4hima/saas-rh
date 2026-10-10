import type { StatutSuivi } from '@teranga/contracts';

/*
   Où en est un agent sur une formation : la règle, en fonction pure.

   La réponse tient en six états, et leur ordre compte : un certificat
   valide l'emporte sur tout ; des leçons toutes validées disent « terminée »
   ou « évaluation à passer » selon que la formation s'évalue ; une leçon
   ouverte suffit pour « en cours ».
 */

export interface FaitsFormation {
  /** Leçons prêtes de la formation. */
  lecons: number;
  /** Parmi elles, celles que l'agent a validées. */
  validees: number;
  /** L'agent a ouvert au moins une leçon. */
  commencee: boolean;
  /** La banque de questions n'est pas vide. */
  evaluation: boolean;
  /** Un certificat EN COURS DE VALIDITÉ. */
  certifiee: boolean;
  /** Au moins une copie rendue, aucune réussie. */
  echec: boolean;
}

export function statutSuivi(f: FaitsFormation): StatutSuivi {
  if (f.certifiee) return 'certifiee';
  if (f.lecons > 0 && f.validees >= f.lecons) {
    if (!f.evaluation) return 'terminee';
    return f.echec ? 'non_reussie' : 'evaluation_a_passer';
  }
  return f.commencee || f.validees > 0 ? 'en_cours' : 'a_commencer';
}
