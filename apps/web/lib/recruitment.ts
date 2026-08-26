import type { ApplicationStage } from '@teranga/contracts';

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  received: 'Reçues',
  screening: 'Présélection',
  interview: 'Entretien',
  offer: 'Offre',
  hired: 'Embauché·e',
  rejected: 'Refusées',
};

export const STAGE_TONES: Record<
  ApplicationStage,
  'neutral' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  received: 'neutral',
  screening: 'primary',
  interview: 'warning',
  offer: 'primary',
  hired: 'success',
  rejected: 'danger',
};

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
