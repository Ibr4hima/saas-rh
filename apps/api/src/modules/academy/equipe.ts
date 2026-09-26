import { STATUTS_SUIVI, type StatutSuivi } from '@teranga/contracts';

/* ————————————————————————————————————————————————————————————————
   « Mon équipe » — les règles, en fonctions pures.

   Où en est un agent sur une formation ? La réponse tient en six états, et
   leur ordre compte : un certificat valide l'emporte sur tout ; des leçons
   toutes validées disent « terminée » ou « évaluation à passer » selon que
   la formation s'évalue ; une leçon ouverte suffit pour « en cours ».

   Le n+1 voit si l'évaluation a été tentée sans succès — pas combien de
   fois, ni avec quels scores.
   ———————————————————————————————————————————————————————————————— */

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

export function compterStatuts(statuts: Iterable<StatutSuivi>): Record<StatutSuivi, number> {
  const comptes = Object.fromEntries(STATUTS_SUIVI.map((s) => [s, 0])) as Record<
    StatutSuivi,
    number
  >;
  for (const s of statuts) comptes[s] += 1;
  return comptes;
}

/**
 * L'ordre de lecture d'une fiche : ce qui attend l'agent d'abord, puis ce
 * qu'il suit, puis ce qu'il a obtenu, et ce qu'il n'a pas ouvert en dernier.
 * À état égal, la plus récemment travaillée devant, puis l'ordre alphabétique.
 */
export function ordreDeSuivi(
  a: { status: StatutSuivi; lastActivityAt: string | null; title: string },
  b: { status: StatutSuivi; lastActivityAt: string | null; title: string },
): number {
  const rang = STATUTS_SUIVI.indexOf(a.status) - STATUTS_SUIVI.indexOf(b.status);
  if (rang !== 0) return rang;
  const recent = (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
  if (recent !== 0) return recent;
  return a.title.localeCompare(b.title, 'fr');
}
