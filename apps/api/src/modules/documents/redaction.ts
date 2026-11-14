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
 * Ce qui s'élide : une voyelle, ou un y qui n'en précède pas une (un y suivi
 * d'une voyelle sonne comme une consonne).
 */
const VOYELLE_INITIALE = /^(?:[aeiouàâäéèêëîïôöùûü]|y(?![aeiouàâäéèêëîïôöùûü]))/i;

/**
 * « la fonction de Analyste » : l'élision ne se saute pas devant une voyelle.
 * Le h muet français est indécidable sans dictionnaire ; on élide devant les
 * voyelles seules, ce qui couvre les intitulés de poste réels. Le y suivi
 * d'une voyelle est une consonne. Jamais devant un nom de personne : la
 * filiation écrit « Fils de Ousmane et de Aminata Ba ».
 */
export function elide(prefixe: string, mot: string): string {
  return VOYELLE_INITIALE.test(mot.trim()) ? `${prefixe}’${mot}` : `${prefixe}e ${mot}`;
}

/** Les noms d'unité féminins et masculins, par leur premier mot. */
const UNITES_AU_FEMININ = ['agence', 'cellule', 'coordination', 'direction', 'division', 'unité'];
const UNITES_AU_MASCULIN = ['bureau', 'cabinet', 'département', 'pôle', 'secrétariat', 'service'];

/**
 * Où la personne est affectée : « à la Direction du Capital Humain », « au
 * Service Comptabilité », « à l’Audit Interne ». L'article suit le premier mot
 * du nom de l'unité, à défaut son type (une direction, un département, un
 * service), et s'élide devant une voyelle.
 */
export function aLUnite(nom: string, type: string): string {
  if (VOYELLE_INITIALE.test(nom.trim())) return `à l’${nom}`;
  const premier = nom.trim().split(/\s+/)[0]!.toLocaleLowerCase('fr-FR');
  const feminin =
    UNITES_AU_FEMININ.includes(premier) ||
    (!UNITES_AU_MASCULIN.includes(premier) && type === 'direction');
  return feminin ? `à la ${nom}` : `au ${nom}`;
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
