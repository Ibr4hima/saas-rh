import type { Passage } from './feuille';

/*
 * Les mots que les modèles de la DCH partagent (ADR-0086) : les dates,
 * l'élision, les accords avec chaque personne nommée, le blanc à remplir à
 * la main.
 */

const INSECABLE = '\u00a0';

/** Un texte que la justification ne coupe ni n'étire : une civilité et son nom, une date. */
export const insecable = (texte: string) => texte.replace(/ /g, INSECABLE);

/** Le blanc à remplir à la main quand l'organigramme ne désigne personne. */
export const A_REMPLIR = '……………………………';

/**
 * « la fonction de Analyste » : l'élision ne se saute pas devant une voyelle.
 * Le h muet français est indécidable sans dictionnaire ; on élide devant les
 * voyelles seules, ce qui couvre les intitulés de poste réels.
 */
export function elide(prefixe: string, mot: string): string {
  return /^[aeiouyàâäéèêëîïôöùûü]/i.test(mot.trim()) ? `${prefixe}’${mot}` : `${prefixe}e ${mot}`;
}

export function frDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso}T00:00:00`) : iso;
  const texte = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
  // Le premier du mois est un ORDINAL en français : « le 1er février », jamais
  // « le 1 février ». Intl ne le sait pas, c'est un usage, pas une locale.
  return d.getDate() === 1 ? texte.replace(/^1 /, '1er ') : texte;
}

/** « mercredi 30 septembre 2026 », « jeudi 1er octobre 2026 » : la date complète, son jour devant. */
export function frDateAvecJour(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d);
  return `${jour} ${frDate(d)}`;
}

/** Une personne qu'un document nomme : son nom, et le genre que son dossier porte. */
export interface Personne {
  /** « Moussa NDIAYE » : le prénom, puis le nom en capitales. */
  nom: string;
  genre: string | null;
}

/**
 * Les mots qui s'accordent avec une personne, d'après le genre que son
 * dossier porte. Sans genre connu, les deux formes, comme sur un formulaire ;
 * l'article reste celui du modèle.
 */
export function accords(genre: string | null) {
  if (genre === 'female') return { civilite: 'Madame', e: 'e', pronom: 'Elle', le: 'La' };
  if (genre === 'male') return { civilite: 'Monsieur', e: '', pronom: 'Il', le: 'Le' };
  return { civilite: 'Monsieur/Madame', e: '(e)', pronom: 'Il/Elle', le: 'Le' };
}

/**
 * Une qualité au genre de qui la porte : « Directrice Générale ». Sans genre
 * connu, celle du modèle.
 */
export const auGenre = (genre: string | null, masculin: string, feminin: string) =>
  genre === 'female' ? feminin : masculin;

/** La qualité de qui dirige la DCH, au genre de son dossier. */
export const qualiteDCH = (genre: string | null) =>
  auGenre(genre, 'Directeur du Capital Humain', 'Directrice du Capital Humain');

/** Une personne nommée, en gras, d'un seul tenant : « Madame Fatou SALL ». */
export const nommee = (p: Personne): Passage => ({
  texte: insecable(`${accords(p.genre).civilite} ${p.nom}`),
  gras: true,
});
