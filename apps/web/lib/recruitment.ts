// Le vocabulaire d'étapes — Présélection, Entretien, Offre… — n'est plus
// affiché nulle part : le tableau de flux à six colonnes qui le portait
// montrait cinq colonnes vides en permanence. Le champ `stage` reste dans
// l'API et en base, intact, pour le jour où un suivi plus fin sera voulu.

export const JOB_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  published: 'Publiée',
  closed: 'Archivée',
};

export const JOB_STATUS_TONES: Record<string, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  published: 'success',
  // Une campagne archivée n'est pas un incident : c'est une fin normale.
  closed: 'neutral',
};

export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  consultant: 'Consultant',
  detachement: 'Détachement',
};

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
