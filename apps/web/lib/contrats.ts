import { compte } from './mots';

/**
 * Une durée restante, comme on la dit : en jours sous un mois, puis en mois,
 * puis en années. Un compte rond se dit tel quel (« 1 mois », « 2 ans ») ;
 * entre deux, on dit la borne au-dessus (« < 2 mois » pour 35 jours). Un mois
 * compte 30 jours, une année 365.
 */
export function dureeRestante(jours: number): string {
  if (jours < 30) return compte(jours, 'jour');
  if (jours < 365) {
    if (jours % 30 === 0) return `${jours / 30} mois`;
    const borne = Math.ceil(jours / 30);
    // Douze mois passés sans faire l'année : c'est bientôt un an.
    return borne > 12 ? '< 1 an' : `< ${borne} mois`;
  }
  if (jours % 365 === 0) return compte(jours / 365, 'an');
  return `< ${Math.ceil(jours / 365)} ans`;
}

/**
 * L'échéance de contrat, écrite comme on la dirait. « 16 j » obligeait à
 * deviner de quel côté de la date on se trouvait ; « Échu · il y a 16 jours »
 * ne se devine pas. À venir, la durée seule : la colonne dit « Durée
 * restante ».
 */
export function deadlineLabel(daysLeft: number | null): {
  text: string;
  tone: 'rouge' | 'orange' | 'gris';
} {
  if (daysLeft === null) return { text: 'À préciser', tone: 'rouge' };
  if (daysLeft < 0) return { text: `Échu · il y a ${compte(-daysLeft, 'jour')}`, tone: 'rouge' };
  if (daysLeft === 0) return { text: "Échoit aujourd'hui", tone: 'rouge' };
  return { text: dureeRestante(daysLeft), tone: daysLeft <= 30 ? 'orange' : 'gris' };
}
