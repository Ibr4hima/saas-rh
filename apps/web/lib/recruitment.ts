// Le vocabulaire d'étapes — Présélection, Entretien, Offre… — n'est plus
// affiché nulle part : le tableau de flux à six colonnes qui le portait
// montrait cinq colonnes vides en permanence. Le champ `stage` reste dans
// l'API et en base, intact, pour le jour où un suivi plus fin sera voulu.

export const JOB_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  published: 'Publiée',
  closed: 'Archivée',
};

export const JOB_STATUS_TONES: Record<string, 'gris' | 'teal' | 'orange'> = {
  draft: 'gris',
  published: 'teal',
  // Une campagne archivée n'est pas un incident : c'est une fin normale.
  closed: 'gris',
};

export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  consultant: 'Consultant',
  detachement: 'Détachement',
};

/** « CDD · 12 mois » : le contrat, et sa durée quand il en a une. */
export function libelleContrat(type: string, dureeMois: number | null): string {
  const contrat = CONTRACT_LABELS[type] ?? type;
  return dureeMois ? `${contrat} · ${dureeMois} mois` : contrat;
}

/** L'expérience telle qu'on l'annonce : « 3 ans minimum », « Aucune exigée ». */
export function experienceExigee(ans: number): string {
  if (ans === 0) return 'Aucune exigée';
  if (ans >= 10) return '10 ans et plus';
  return ans === 1 ? '1 an minimum' : `${ans} ans minimum`;
}

/**
 * L'intitulé d'une pièce, tel qu'on le montre en grand.
 *
 * La RH saisit « CV » dans les pièces demandées — c'est ce qu'on veut sur un
 * onglet, où la place manque. En titre du lecteur, la forme longue se lit
 * mieux et fait moins sigle administratif.
 */
export function libelleDocument(label: string): string {
  return label.trim().toLowerCase() === 'cv' ? 'Curriculum Vitæ' : label;
}
