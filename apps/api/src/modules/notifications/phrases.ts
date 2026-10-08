import {
  heureEnLettres,
  type ContractType,
  type DocumentCategory,
  type RequestableDoc,
} from '@teranga/contracts';

/* Les mots des notifications. Un titre se lit comme une phrase : « Votre CNI
   est ajoutée à votre dossier », « Le CDD de Fatou Sall prend fin le
   18 octobre 2026 ». Ce qu'il faut pour l'écrire juste (article, accord,
   élision, dates) est ici, une fois. */

/** « 1er octobre 2026 », « 9 septembre 2026 » : jamais d'ISO brut dans un texte lu. */
export function frDate(iso: string, avecJour = false): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const texte = d.toLocaleDateString('fr-FR', {
    ...(avecJour ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return d.getUTCDate() === 1 ? texte.replace(/(^|\s)1 /, '$11er ') : texte;
}

/** Les heures d'une absence à l'heure, « 10:00 » à « 12:00 ». */
export interface Heures {
  debut: string;
  fin: string;
}

/**
 * « le 10 mai 2027 », « du 10 au 12 mai 2027 », « du 28 avril au 3 mai 2027 » ;
 * à l'heure, « le 10 mai 2027 de 10 h à 12 h ».
 */
export function duAu(debut: string, fin: string, heures?: Heures | null): string {
  if (heures) {
    return `le ${frDate(debut)} de ${heureEnLettres(heures.debut)} à ${heureEnLettres(heures.fin)}`;
  }
  if (debut === fin) return `le ${frDate(debut)}`;
  const [a, b] = [frDate(debut).split(' '), frDate(fin).split(' ')];
  if (a[2] !== b[2]) return `du ${a.join(' ')} au ${b.join(' ')}`;
  if (a[1] !== b[1]) return `du ${a[0]} ${a[1]} au ${b.join(' ')}`;
  return `du ${a[0]} au ${b.join(' ')}`;
}

/** Un nom commun : ce qu'il faut pour l'accorder. */
export interface Nom {
  nom: string;
  feminin: boolean;
  /** L'article d'un tiers qui le dépose ou le demande : « sa CNI », « une attestation ». */
  article: string;
}

const nom = (n: string, feminin: boolean, article = feminin ? 'une' : 'un'): Nom => ({
  nom: n,
  feminin,
  article,
});

/** Les pièces du dossier, telles qu'on les dit. */
export const PIECE: Record<DocumentCategory, Nom> = {
  cni: nom('CNI', true, 'sa'),
  passeport: nom('passeport', false, 'son'),
  diplome: nom('diplôme', false),
  certification: nom('certification', true),
  attestation_travail: nom('attestation de travail', true),
  attestation_stage: nom('attestation de stage', true),
  cv: nom('CV', false, 'son'),
  autre: nom('document', false),
};

/** Les documents qu'on demande à la DCH. */
export const DOCUMENT: Record<RequestableDoc, Nom> = {
  attestation_travail: nom('attestation de travail', true),
  attestation_stage: nom('attestation de stage', true),
  contrat_travail: nom('contrat de travail', false, 'son'),
  bulletin_salaire: nom('bulletin de salaire', false),
  attestation_salaire: nom('attestation de salaire', true),
  certificat_travail: nom('certificat de travail', false),
  autre: nom('document', false),
};

/** « le CDD », « le stage » : tous masculins. */
export const CONTRAT: Record<ContractType, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'stage',
  consultant: 'contrat de consultant',
  detachement: 'détachement',
};

/**
 * Le nom d'un type d'absence dans une phrase : « congé annuel », « congé
 * maladie », « mission », « absence ponctuelle ».
 */
export function absence(type: string): Nom {
  const bas = type.toLowerCase();
  if (bas === 'mission' || bas.startsWith('absence')) return nom(bas, true);
  return nom(bas.startsWith('congé') ? bas : `congé ${bas}`, false);
}

/** Une absence dont le motif ne regarde pas qui lit : la maladie, pour le N+1. */
export const ABSENCE: Nom = nom('absence', true);

const voyelle = (mot: string) => /^[aeiouyéèêâîôûh]/i.test(mot);

/** « son congé », « sa mission », « son absence ». */
export const sonSa = (n: Nom) => (n.feminin && !voyelle(n.nom) ? 'sa' : 'son');

/** « Le congé », « La mission », « L’absence ». */
export const leLa = (n: Nom) => (voyelle(n.nom) ? 'L’' : n.feminin ? 'La ' : 'Le ');

/** « approuvé », « approuvée ». */
export const accord = (mot: string, n: Pick<Nom, 'feminin'>) => (n.feminin ? `${mot}e` : mot);

/** « d’attestation », « de bulletin », « d’Awa Diop ». */
export const de = (mot: string) => (/^[aeiouyéèêâîôû]/i.test(mot) ? `d’${mot}` : `de ${mot}`);

/** « Moussa Ndiaye et Awa Diop », « a, b et c ». */
export function enumerer(mots: readonly string[]): string {
  return mots.length <= 1 ? (mots[0] ?? '') : `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}`;
}

/**
 * Le titre d'un rappel : « Rappel : » devant celui de l'appel. Un titre qui
 * s'ouvre sur un nom propre le garde ; « Votre demande… » passe en minuscule.
 */
export function rappel(titre: string): string {
  const debut = /^(Votre|Vos|Le|La|Les|Un|Une|Des)\b/.test(titre);
  return `Rappel : ${debut ? titre[0]!.toLowerCase() + titre.slice(1) : titre}`;
}

/** « du 1er semestre 2026 », « du 2nd semestre 2026 ». */
export const duSemestre = (semestre: number, annee: number) =>
  `du ${semestre === 1 ? '1er' : '2nd'} semestre ${annee}`;
