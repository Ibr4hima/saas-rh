import { z } from 'zod';
import { MOIS_DE_L_ANNEE } from './document-requests';
import type { Personnel } from './employees';

/* ────────────────────────────────────────────────────────────────
   L'évaluation annuelle sur la grille de l'APIX (ADR-0149).

   Qui dirige la DCH ouvre la période d'évaluation de l'année. Le N+1
   remplit la grille de chaque agent de son équipe : la grille du personnel
   cadre (réf. S1/EN02) ou celle du personnel non cadre, selon la fiche de
   l'agent. La grille passe ensuite à l'agent, qui la valide ou la renvoie ;
   puis, au choix du N+1, au N+2 ; enfin à la DCH, en PDF.

   Le texte de la grille est celui du modèle de l'APIX, corrigé de ses
   fautes ; il est ici, une fois, pour l'écran qui la fait remplir et pour
   le PDF qui l'imprime.
   ──────────────────────────────────────────────────────────────── */

export const NIVEAUX = ['A', 'B', 'C', 'D'] as const;
export type Niveau = (typeof NIVEAUX)[number];
export const niveauSchema = z.enum(NIVEAUX);

/** Ce que vaut un niveau, tel que le bas de la page 3 le rappelle. */
export const SIGNIFICATION_DES_NIVEAUX: Record<Niveau, string> = {
  A: 'Résultats excellents',
  B: 'Résultats satisfaisants',
  C: 'Résultats à améliorer',
  D: 'Résultats non acceptables',
};

/** Les niveaux d'un objectif de l'année écoulée, tels que la légende de la page 2 les nomme. */
export const NIVEAUX_D_OBJECTIF: Record<Niveau, string> = {
  A: 'Dépassés',
  B: 'Réalisés',
  C: 'Partiellement réalisés',
  D: 'Non réalisés',
};

/** Un critère de la grille : son intitulé, et ce que dit chacun de ses niveaux. */
export interface CritereDeGrille {
  numero: number;
  intitule: string;
  niveaux: Record<Niveau, string>;
  /** Ne vaut que pour un agent qui a des collaborateurs sous ses ordres. */
  commandement?: true;
}

/**
 * Les treize critères de la grille du personnel cadre, page 3, dans l'ordre
 * du modèle. Corrigés : « Porte un grand intérêt », « de bons résultats »,
 * « quelquefois », « A un contact », « subordonnés », « laisser-faire »,
 * « correctement », la ponctuation et l'orthographe de « maîtriser ».
 */
export const CRITERES_CADRE: readonly CritereDeGrille[] = [
  {
    numero: 1,
    intitule: 'Connaissances professionnelles générales et théoriques',
    niveaux: {
      A: 'A parfaitement assimilé les connaissances théoriques nécessaires à l’exercice de ses fonctions',
      B: 'Connaissances générales et théoriques satisfaisantes pour l’emploi',
      C: 'Connaissances générales et théoriques présentant encore certaines lacunes pour l’emploi',
      D: 'N’a pas assimilé les notions théoriques de base, indispensables à l’exercice de ses fonctions',
    },
  },
  {
    numero: 2,
    intitule: 'Connaissances techniques, expérience pratique',
    niveaux: {
      A: 'Domine parfaitement son travail, très sûr techniquement ; expérience riche et étendue',
      B: 'Assez compétent et bonne expérience pratique ; maîtrise ses tâches',
      C: 'Présente des lacunes techniques, a du mal à maîtriser son travail ; expérience limitée',
      D: 'Des lacunes graves dans ses connaissances techniques, ne maîtrise pas son travail, pas d’expérience',
    },
  },
  {
    numero: 3,
    intitule: 'Qualité du travail fourni',
    niveaux: {
      A: 'Travail irréprochable ; qualité parfaite, constante',
      B: 'Travail satisfaisant et de qualité',
      C: 'Travail à peine satisfaisant et souvent repris',
      D: 'Travail à reprendre constamment',
    },
  },
  {
    numero: 4,
    intitule: 'Organisation de son propre travail',
    niveaux: {
      A: 'Organise parfaitement le plan détaillé de son activité, améliore constamment son travail',
      B: 'Organise en général son travail ; cherche à améliorer ses méthodes de travail',
      C: 'Organise superficiellement son travail ; ne cherche pas à améliorer ses méthodes',
      D: 'N’organise pas son travail, ne fait aucun effort pour s’améliorer',
    },
  },
  {
    numero: 5,
    intitule: 'Planification du travail et respect des délais',
    niveaux: {
      A: 'Respecte les délais et prépare les tâches à venir',
      B: 'Respecte les délais impartis',
      C: 'Respecte difficilement les délais impartis',
      D: 'Il faut lui rappeler constamment les échéances de ses tâches ; il est facilement débordé',
    },
  },
  {
    numero: 6,
    intitule: 'Sens des responsabilités (obligations morales et fonctionnelles)',
    niveaux: {
      A: 'Assume pleinement ses responsabilités',
      B: 'Assume correctement ses responsabilités',
      C: 'N’assume ses responsabilités que si on le lui rappelle',
      D: 'N’assume pas ses responsabilités',
    },
  },
  {
    numero: 7,
    intitule: 'Sens de l’initiative',
    niveaux: {
      A: 'Prend l’initiative de décisions judicieuses en toutes circonstances',
      B: 'Prend souvent de bonnes initiatives',
      C: 'Prend peu d’initiatives, a besoin d’aide pour résoudre les problèmes non routiniers',
      D: 'Ne prend aucune initiative, évite les situations présentant de quelconques difficultés',
    },
  },
  {
    numero: 8,
    intitule: 'Intérêt pour le travail',
    niveaux: {
      A: 'Porte un grand intérêt à son travail et cherche constamment à l’enrichir',
      B: 'A de l’intérêt pour son travail et fait des efforts pour se perfectionner',
      C: 'Fait son travail sans grande conviction',
      D: 'Ne porte aucun intérêt à son travail',
    },
  },
  {
    numero: 9,
    intitule: 'Engagement',
    niveaux: {
      A: 'Ne ménage ni son temps ni ses efforts pour obtenir de bons résultats',
      B: 'Fait des efforts pour mener à bien ses tâches',
      C: 'A besoin quelquefois d’être rappelé à l’ordre et d’être encouragé pour travailler',
      D: 'Doit être constamment rappelé à l’ordre',
    },
  },
  {
    numero: 10,
    intitule: 'Relations humaines',
    niveaux: {
      A: 'A d’excellentes relations avec ses collègues et autrui ; sait résoudre les conflits',
      B: 'A un contact humain facile et évite de créer des conflits',
      C: 'Limite ses relations au strict nécessaire avec les autres',
      D: 'Manque de sociabilité, a souvent des rapports conflictuels avec les autres',
    },
  },
  {
    numero: 11,
    intitule: 'Esprit d’équipe',
    niveaux: {
      A: 'Excellent esprit d’équipe, fait preuve d’une solidarité sans faille avec ses collègues et supérieurs',
      B: 'S’intéresse bien à son équipe, collabore avec ses collègues et supérieurs',
      C: 'Collabore peu avec les autres, a tendance à travailler seul',
      D: 'Aucun esprit d’équipe, rejette toute collaboration avec les autres membres de son équipe',
    },
  },
  {
    numero: 12,
    intitule: 'Commandement',
    commandement: true,
    niveaux: {
      A: 'Très fort ascendant sur ses collaborateurs, a une aptitude naturelle à diriger',
      B: 'Son autorité est acceptée, se fait obéir de ses subordonnés',
      C: 'A besoin de s’affirmer, son autorité est souvent contestée',
      D: 'Aucune autorité, partisan du laisser-faire',
    },
  },
  {
    numero: 13,
    intitule: 'Confiance par rapport à l’exécution du travail',
    niveaux: {
      A: 'D’une grande fiabilité, on peut s’en remettre entièrement à lui',
      B: 'On peut lui faire confiance, s’en sort avec quelques directives',
      C: 'A besoin d’être suivi et assisté pour s’en sortir',
      D: 'On ne peut pas lui faire confiance, nécessite un contrôle systématique',
    },
  },
];

/** La note qui suit le tableau : le critère du commandement ne vaut pas pour tous. */
export const NOTE_COMMANDEMENT =
  'Utiliser ce critère uniquement pour les agents ayant des collaborateurs sous leurs ordres';

/** La synthèse générale du N+1, page 6 : deux critères, chacun de A à D. */
export const SYNTHESE_DU_N1: readonly {
  cle: 'comprehension' | 'tenue';
  intitule: string;
  niveaux: Record<Niveau, string>;
}[] = [
  {
    cle: 'comprehension',
    intitule: 'Compréhension du poste',
    niveaux: {
      A: 'Connaît parfaitement le poste de travail',
      B: 'Connaît assez bien le poste de travail',
      C: 'Connaît à peine le poste de travail',
      D: 'Ne connaît pas le poste de travail',
    },
  },
  {
    cle: 'tenue',
    intitule: 'Tenue du poste',
    niveaux: {
      A: 'Tient parfaitement le poste',
      B: 'Tient correctement le poste',
      C: 'A besoin d’être suivi pour tenir le poste',
      D: 'N’est pas à l’aise dans le poste',
    },
  },
];

/** Combien de lignes la grille donne à chaque liste. */
export const OBJECTIFS_ECOULES = 3;
export const OBJECTIFS_A_VENIR = 4;
export const FORMATIONS = 3;

/**
 * La longueur de chaque champ : ce qui tient dans sa place sur le PDF, où la
 * grille garde ses six pages.
 */
export const LIMITES_DE_LA_GRILLE = {
  objectif: 220,
  raisons: 700,
  pointsForts: 520,
  pointsFaibles: 520,
  actions: 520,
  objectifAVenir: 180,
  delai: 40,
  formation: 120,
  observations: 520,
  commentairesAgent: 520,
  commentairesN2: 360,
  renvoi: 500,
} as const;

const texte = (max: number) => z.string().trim().max(max).default('');

/**
 * Ce que le N+1 écrit dans la grille. Tout est facultatif tant que la grille
 * est en cours : elle s'enregistre telle qu'elle est, et ne s'envoie que
 * complète (cf. `ceQuiManque`).
 */
export const contenuDeGrilleSchema = z.object({
  /** « Agent nouveau à son poste actuel » ; `null` : la case suit l'ancienneté. */
  nouveauAuPoste: z.boolean().nullable().default(null),
  objectifs: z
    .array(
      z.object({
        texte: texte(LIMITES_DE_LA_GRILLE.objectif),
        niveau: niveauSchema.nullable().default(null),
      }),
    )
    .max(OBJECTIFS_ECOULES)
    .default([]),
  raisons: texte(LIMITES_DE_LA_GRILLE.raisons),
  /** Le niveau de chaque critère, dans l'ordre de la grille. */
  criteres: z.array(niveauSchema.nullable()).max(CRITERES_CADRE.length).default([]),
  pointsForts: texte(LIMITES_DE_LA_GRILLE.pointsForts),
  pointsFaibles: texte(LIMITES_DE_LA_GRILLE.pointsFaibles),
  actions: texte(LIMITES_DE_LA_GRILLE.actions),
  objectifsAVenir: z
    .array(
      z.object({
        texte: texte(LIMITES_DE_LA_GRILLE.objectifAVenir),
        delai: texte(LIMITES_DE_LA_GRILLE.delai),
      }),
    )
    .max(OBJECTIFS_A_VENIR)
    .default([]),
  formations: z.array(texte(LIMITES_DE_LA_GRILLE.formation)).max(FORMATIONS).default([]),
  comprehension: niveauSchema.nullable().default(null),
  tenue: niveauSchema.nullable().default(null),
  observations: texte(LIMITES_DE_LA_GRILLE.observations),
});
export type ContenuDeGrille = z.infer<typeof contenuDeGrilleSchema>;

/** Une grille vide, à la forme complète : trois objectifs, treize critères, quatre objectifs à venir, trois formations. */
export function grilleVide(): ContenuDeGrille {
  return completerLaGrille(contenuDeGrilleSchema.parse({}));
}

/** La grille à sa forme complète, quoi qu'en ait gardé l'enregistrement. */
export function completerLaGrille(c: ContenuDeGrille): ContenuDeGrille {
  const remplir = <T>(liste: T[], n: number, vide: () => T) =>
    Array.from({ length: n }, (_, i) => liste[i] ?? vide());
  return {
    ...c,
    objectifs: remplir(c.objectifs, OBJECTIFS_ECOULES, () => ({ texte: '', niveau: null })),
    criteres: remplir(c.criteres, CRITERES_CADRE.length, () => null),
    objectifsAVenir: remplir(c.objectifsAVenir, OBJECTIFS_A_VENIR, () => ({
      texte: '',
      delai: '',
    })),
    formations: remplir(c.formations, FORMATIONS, () => ''),
  };
}

/**
 * Ce qui manque pour envoyer la grille à l'agent, section par section :
 * un objectif de l'année écoulée et son niveau au moins, les raisons quand un
 * objectif n'est que partiellement réalisé ou ne l'est pas, chaque critère
 * (le commandement pour qui encadre seulement), les points forts et les
 * points faibles, et la synthèse du N+1. Vide : la grille peut partir.
 */
export function ceQuiManque(c: ContenuDeGrille, avecCommandement: boolean): string[] {
  const manque: string[] = [];
  const objectifs = c.objectifs.filter((o) => o.texte !== '' || o.niveau !== null);
  if (objectifs.length === 0) manque.push('Un objectif de la période écoulée');
  if (objectifs.some((o) => o.texte === '' || o.niveau === null)) {
    manque.push('Le texte et le niveau de chaque objectif');
  }
  if (objectifs.some((o) => o.niveau === 'C' || o.niveau === 'D') && c.raisons === '') {
    manque.push('Les raisons des objectifs partiellement réalisés ou non réalisés');
  }
  const criteres = CRITERES_CADRE.filter((cr) => avecCommandement || !cr.commandement);
  if (criteres.some((cr) => !c.criteres[cr.numero - 1])) {
    manque.push('Le niveau de chaque critère');
  }
  if (c.pointsForts === '') manque.push('Les points forts');
  if (c.pointsFaibles === '') manque.push('Les points faibles');
  if (c.objectifsAVenir.some((o) => o.delai !== '' && o.texte === '')) {
    manque.push('L’objectif de chaque délai');
  }
  if (!c.comprehension || !c.tenue) manque.push('La synthèse générale');
  return manque;
}

export const enregistrerGrilleSchema = z.object({ contenu: contenuDeGrilleSchema });
export type EnregistrerGrilleInput = z.infer<typeof enregistrerGrilleSchema>;

export const validerGrilleSchema = z.object({
  commentaires: texte(LIMITES_DE_LA_GRILLE.commentairesAgent),
});
export type ValiderGrilleInput = z.infer<typeof validerGrilleSchema>;

export const renvoyerGrilleSchema = z.object({
  mot: z.string().trim().min(1).max(LIMITES_DE_LA_GRILLE.renvoi),
});
export type RenvoyerGrilleInput = z.infer<typeof renvoyerGrilleSchema>;

export const commenterGrilleSchema = z.object({
  commentaires: texte(LIMITES_DE_LA_GRILLE.commentairesN2),
});
export type CommenterGrilleInput = z.infer<typeof commenterGrilleSchema>;

// ──────────────────────────────────────────────── la période

export const periodeEvaluationSchema = z
  .object({ du: z.iso.date(), au: z.iso.date() })
  .refine((p) => p.du <= p.au, {
    message: 'La fin de la période précède son début',
    path: ['au'],
  });
export type PeriodeEvaluationInput = z.infer<typeof periodeEvaluationSchema>;

/** La période d'évaluation d'une année. */
export interface PeriodeEvaluation {
  annee: number;
  du: string;
  au: string;
}

/** La période d'une année, telle que la DCH la voit et la règle. */
export interface VueDeLaPeriode {
  annee: number;
  periode: PeriodeEvaluation | null;
  /** Qui dirige la DCH la fixe. */
  modifiable: boolean;
  /** Les années qui ont une période, de la plus récente à la plus ancienne. */
  annees: number[];
}

// ──────────────────────────────────────────────── le circuit

export const ETATS_DE_GRILLE = [
  'brouillon',
  'chez_agent',
  'validee_agent',
  'chez_n2',
  'terminee',
] as const;
export type EtatDeGrille = (typeof ETATS_DE_GRILLE)[number];

/** Où en est la grille d'un agent, telle que les listes la montrent. */
export type OuEnEst = 'a_remplir' | 'en_cours' | 'renvoyee' | EtatDeGrille;

export const LIBELLES_OU_EN_EST: Record<Exclude<OuEnEst, 'brouillon'>, string> = {
  a_remplir: 'À remplir',
  en_cours: 'En cours',
  renvoyee: 'Renvoyée par l’agent',
  chez_agent: 'Chez l’agent',
  validee_agent: 'Validée par l’agent',
  chez_n2: 'Chez le N+2',
  terminee: 'Transmise à la DCH',
};

/** Ce que la page 1 imprime de l'agent et de son N+1. */
export interface IdentificationDeGrille {
  direction: string | null;
  departement: string | null;
  service: string | null;
  agent: string;
  matricule: string | null;
  fonction: string | null;
  /** « 3 ans et 2 mois » ; null : pas d'affectation connue. */
  anciennete: string | null;
  /** Moins d'un an à son poste : la case « agent nouveau » se coche d'office. */
  nouveauAuPoste: boolean;
  evaluateur: string | null;
  fonctionEvaluateur: string | null;
}

/** Qui regarde la grille : son N+1, l'agent, le N+2, ou la DCH. */
export type RoleDansLaGrille = 'n1' | 'agent' | 'n2' | 'dch';

export interface ActionsSurLaGrille {
  enregistrer: boolean;
  envoyer: boolean;
  reprendre: boolean;
  renvoyer: boolean;
  valider: boolean;
  transmettreAuN2: boolean;
  terminer: boolean;
  commenter: boolean;
  pdf: boolean;
}

/** Une grille, telle que la personne qui l'ouvre a le droit de la lire. */
export interface VueDeGrille {
  employeeId: string;
  annee: number;
  modele: Personnel;
  /** Ce que dit la fiche de l'agent aujourd'hui ; null : à renseigner par la DCH. */
  personnel: Personnel | null;
  /** null : le N+1 ne l'a pas encore commencée. */
  etat: EtatDeGrille | null;
  role: RoleDansLaGrille;
  agent: { nom: string; poste: string | null };
  /** « Awa Diop » : qui a rempli la grille, ou qui la remplira. */
  evaluateur: string | null;
  /** La page 1, telle qu'elle s'imprime : « Moussa NDIAYE ». */
  identification: IdentificationDeGrille;
  /** Le critère « Commandement » vaut pour cet agent, qui encadre. */
  commandement: boolean;
  /** Pour l'agent, sans la page 6 : la synthèse et les observations du N+1 restent vides. */
  contenu: ContenuDeGrille;
  commentairesAgent: string;
  commentairesN2: string;
  /** Le dernier renvoi de l'agent, tant que la grille n'est pas repartie. */
  renvoi: { mot: string; le: string } | null;
  /** Le N+2 : la personne qui a reçu la grille, ou à qui le N+1 peut l'envoyer. */
  n2: { nom: string; fonction: string | null } | null;
  periode: PeriodeEvaluation | null;
  dates: {
    envoyeeLe: string | null;
    valideeAgentLe: string | null;
    envoyeeN2Le: string | null;
    valideeN2Le: string | null;
    termineeLe: string | null;
  };
  actions: ActionsSurLaGrille;
}

/** Une ligne des listes : l'équipe du N+1, le suivi de la DCH. */
export interface LigneDEvaluation {
  employeeId: string;
  nom: string;
  matricule: string | null;
  poste: string | null;
  direction: string | null;
  personnel: Personnel | null;
  ouEnEst: OuEnEst;
  /** Le N+1 de l'agent ; pour le N+2, le N+1 qui a envoyé la grille. */
  n1: string | null;
  /** La personne qui lit la ligne la voit en N+2. */
  enN2: boolean;
  /** Passé la fin de la période sans être transmise à la DCH. */
  enRetard: boolean;
  /** La dernière étape franchie, AAAA-MM-JJ. */
  le: string | null;
}

export interface EvaluationsDeLEquipe {
  annee: number;
  periode: PeriodeEvaluation | null;
  /** La période a commencé : les grilles se remplissent. */
  ouverte: boolean;
  annees: number[];
  lignes: LigneDEvaluation[];
}

export interface SuiviDesEvaluations extends EvaluationsDeLEquipe {
  modifiable: boolean;
}

/** Une grille terminée, au dossier de l'agent. */
export interface GrilleAuDossier {
  annee: number;
  modele: Personnel;
  termineeLe: string;
}

/** Les années où l'agent a une grille à lire, de la plus récente à la plus ancienne. */
export interface MesEvaluations {
  /** Son dossier en activité ; null : aucun. */
  employeeId: string | null;
  annees: { annee: number; etat: EtatDeGrille }[];
}

// ──────────────────────────────────────────────── dates en lettres

/** « 30 juin », « 1er janvier » : un jour et un mois, « MM-JJ », en lettres. */
export function jourEtMoisEnLettres(jour: string): string {
  const [mois = 1, j = 1] = jour.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS_DE_L_ANNEE[mois - 1]}`;
}

/** « 20 mars 2027 », ou « 20 mars » sans l'année : une date ISO en lettres. */
export function dateEnLettres(date: string, avecAnnee = true): string {
  const jour = jourEtMoisEnLettres(date.slice(5, 10));
  return avecAnnee ? `${jour} ${date.slice(0, 4)}` : jour;
}

/** « du 1er au 31 décembre 2026 », « du 15 décembre 2026 au 31 janvier 2027 ». */
export function periodeDEvaluationEnLettres(p: { du: string; au: string }): string {
  if (p.du === p.au) return `le ${dateEnLettres(p.du)}`;
  const memeAnnee = p.du.slice(0, 4) === p.au.slice(0, 4);
  const memeMois = memeAnnee && p.du.slice(5, 7) === p.au.slice(5, 7);
  const debut = memeMois
    ? Number(p.du.slice(8, 10)) === 1
      ? '1er'
      : String(Number(p.du.slice(8, 10)))
    : dateEnLettres(p.du, !memeAnnee);
  return `du ${debut} au ${dateEnLettres(p.au)}`;
}

/**
 * L'ancienneté dans le poste, en lettres : « 3 ans et 2 mois », « 8 mois »,
 * « moins d'un mois ». `depuis` et `au` : AAAA-MM-JJ.
 */
export function ancienneteEnLettres(depuis: string, au: string): string {
  const [a1, m1, j1] = depuis.split('-').map(Number) as [number, number, number];
  const [a2, m2, j2] = au.split('-').map(Number) as [number, number, number];
  let mois = (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0);
  if (mois < 1) return 'moins d’un mois';
  const ans = Math.floor(mois / 12);
  mois -= ans * 12;
  const enAns = ans > 0 ? `${ans} an${ans > 1 ? 's' : ''}` : '';
  const enMois = mois > 0 ? `${mois} mois` : '';
  return [enAns, enMois].filter(Boolean).join(' et ');
}

/** Le nom du PDF d'une grille : « grille-evaluation-2026-EMP-002.pdf ». */
export function nomDeLaGrille(annee: number, matricule: string | null): string {
  const sans = (matricule ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const net = sans.replace(/[^A-Za-z0-9-]/g, '_');
  return `grille-evaluation-${annee}${net ? `-${net}` : ''}.pdf`;
}

/** L'année d'une grille ou d'une période, dans l'adresse : de 2000 à 2100, comme en base. */
export const anneeDeGrilleSchema = z.coerce.number().int().min(2000).max(2100);

/** L'année d'évaluation, lue dans l'adresse (« ?annee=2026 ») ; absente : l'année en cours. */
export const anneeDEvaluationSchema = z.object({ annee: anneeDeGrilleSchema.optional() });
export type AnneeDEvaluation = z.infer<typeof anneeDEvaluationSchema>;
