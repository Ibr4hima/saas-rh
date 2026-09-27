import { compte } from './mots';

/**
 * L'échéance de contrat, écrite comme on la dirait. « 16 j » obligeait à
 * deviner de quel côté de la date on se trouvait ; « Échu · il y a 16 jours »
 * ne se devine pas.
 */
export function deadlineLabel(daysLeft: number | null): {
  text: string;
  tone: 'danger' | 'warning' | 'neutral';
} {
  if (daysLeft === null) return { text: 'À préciser', tone: 'danger' };
  if (daysLeft < 0) return { text: `Échu · il y a ${compte(-daysLeft, 'jour')}`, tone: 'danger' };
  if (daysLeft === 0) return { text: "Échoit aujourd'hui", tone: 'danger' };
  if (daysLeft === 1) return { text: 'Échoit demain', tone: 'warning' };
  return { text: `Dans ${compte(daysLeft, 'jour')}`, tone: daysLeft <= 30 ? 'warning' : 'neutral' };
}
