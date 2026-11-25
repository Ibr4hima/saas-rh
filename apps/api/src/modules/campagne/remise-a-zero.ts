/* ────────────────────────────────────────────────────────────────
   Ce que la campagne écrit sur une fiche, et la remise à zéro qui
   l'efface. La commande pnpm campagne:reinitialiser (ADR-0270) et le bouton
   « Remettre à zéro » de l'administration (ADR-0271) partagent ces
   morceaux de SQL : les deux effacent exactement la même chose.

   Gardé : les objectifs de l'année et l'évaluateur choisi par
   l'administration. Le déclencheur d'audit de la table garde ce que la
   fiche contenait.
   ──────────────────────────────────────────────────────────────── */

/** Ce que la campagne écrit sur une fiche, de l'auto-évaluation à la DCH. */
export const COLONNES_DE_LA_CAMPAGNE = [
  'auto',
  'auto_transmise_le',
  'evaluation',
  'reservee',
  'evaluation_par_employee_id',
  'evaluation_transmise_le',
  'envoyee_n2_le',
  'envoyee_n2_a',
  'validee_le',
  'renvoyee_le',
  'renvoi_mot',
  'commentaires_n2',
  'commentaires_n2_par',
  'commentaires_n2_transmis_le',
  'reprise_n2_le',
  'transmise_dch_le',
  'transmise_dch_par',
] as const;

/** Vrai quand la campagne a écrit quelque chose sur la fiche `f`. */
export const ficheCommencee = (f: string): string =>
  `(${COLONNES_DE_LA_CAMPAGNE.map((c) => `${f}.${c} IS NOT NULL`).join(' OR ')})`;

/**
 * Jusqu'où est allée la fiche `f` (un `AvancementDeLaFiche`) ; NULL quand
 * la campagne n'y a rien écrit, ou qu'il n'y a pas de fiche.
 */
export const avancementDeLaFiche = (f: string): string => `CASE
    WHEN NOT ${ficheCommencee(f)} THEN NULL
    WHEN ${f}.transmise_dch_le IS NOT NULL THEN 'transmise_a_la_dch'
    WHEN ${f}.validee_le IS NOT NULL THEN 'validee'
    WHEN ${f}.evaluation_transmise_le IS NOT NULL THEN 'transmise_a_l_agent'
    WHEN ${f}.evaluation IS NOT NULL OR ${f}.reservee IS NOT NULL THEN 'evaluation_commencee'
    WHEN ${f}.auto_transmise_le IS NOT NULL THEN 'auto_transmise'
    ELSE 'auto_commencee'
  END`;

/** Ce qu'un UPDATE remet à zéro. */
export const REMISE_A_ZERO = COLONNES_DE_LA_CAMPAGNE.map((c) => `${c} = NULL`).join(', ');
