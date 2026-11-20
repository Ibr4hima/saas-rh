import { z } from 'zod';
import { niveauSchema, type Niveau } from './evaluations';

/* ────────────────────────────────────────────────────────────────
   La fiche d'entretien annuel d'évaluation de l'APIX (réf. S1/EN05),
   ADR-0205.

   Une seule fiche pour tout le personnel, cadre ou non cadre. L'agent la
   commence (son auto-évaluation), le N+1 la complète après l'entretien,
   l'agent la valide, le N+2 la commente. La dernière partie est réservée à
   la hiérarchie : l'agent ne la voit jamais.

   Le texte est celui de la grille de la DCH, corrigé de ses fautes et écrit
   sans accord au masculin ni au féminin. Les écrans et le PDF le lisent
   ici : il n'existe qu'à un endroit.
   ──────────────────────────────────────────────────────────────── */

/** La référence de la fiche dans le système documentaire de la DCH. */
export const REFERENCE_DE_LA_FICHE = {
  reference: 'S1/EN05',
  version: '02',
  /** AAAA-MM-JJ. */
  application: '2018-12-15',
} as const;

export const TITRE_DE_LA_FICHE = 'Fiche d’entretien annuel d’évaluation';

/** Les niveaux d'atteinte d'un objectif, et ce qu'ils disent des résultats. */
export const NIVEAUX_D_ATTEINTE: Record<Niveau, { libelle: string; resultats: string }> = {
  A: { libelle: 'Dépassé', resultats: 'Résultats excellents' },
  B: { libelle: 'Réalisé', resultats: 'Résultats satisfaisants' },
  C: { libelle: 'Partiellement réalisé', resultats: 'Résultats à améliorer' },
  D: { libelle: 'Non réalisé', resultats: 'Résultats non acceptables' },
};

/** Les niveaux d'une compétence. */
export const NIVEAUX_DE_COMPETENCE: Record<Niveau, string> = {
  A: 'Excellent',
  B: 'Satisfaisant',
  C: 'À améliorer',
  D: 'Non acceptable',
};

export const CLES_DE_COMPETENCE = [
  'connaissances',
  'qualite',
  'organisation',
  'initiative',
  'engagement',
  'equipe',
  'responsabilite',
  'imprevus',
  'assiduite',
  'resolution',
  'management',
] as const;
export type CleDeCompetence = (typeof CLES_DE_COMPETENCE)[number];

export interface Competence {
  cle: CleDeCompetence;
  intitule: string;
  /** Ce que veut dire chaque niveau pour cette compétence. */
  niveaux: Record<Niveau, string>;
  /** Le management : le personnel cadre seulement, et s'il y a lieu. */
  cadres?: true;
}

/** Les onze compétences, dans l'ordre de la grille. */
export const COMPETENCES: readonly Competence[] = [
  {
    cle: 'connaissances',
    intitule: 'Connaissances techniques et pratiques',
    niveaux: {
      A: 'Maîtrise parfaitement son travail.',
      B: 'Maîtrise ses tâches avec compétence.',
      C: 'Lacunes techniques, maîtrise limitée.',
      D: 'Lacunes graves, ne maîtrise pas son travail.',
    },
  },
  {
    cle: 'qualite',
    intitule: 'Qualité du travail',
    niveaux: {
      A: 'Travail irréprochable et constant.',
      B: 'Travail satisfaisant et de qualité.',
      C: 'Travail à peine satisfaisant, souvent repris.',
      D: 'Travail à reprendre constamment.',
    },
  },
  {
    cle: 'organisation',
    intitule: 'Organisation et planification',
    niveaux: {
      A: 'Organise parfaitement son travail et anticipe.',
      B: 'Organise son travail et respecte les délais.',
      C: 'Difficultés à respecter les délais.',
      D: 'N’organise pas son travail, se laisse vite déborder.',
    },
  },
  {
    cle: 'initiative',
    intitule: 'Sens de l’initiative',
    niveaux: {
      A: 'Prend des initiatives et des décisions judicieuses.',
      B: 'Prend souvent de bonnes initiatives.',
      C: 'Prend peu d’initiatives, a besoin d’aide.',
      D: 'Ne prend aucune initiative.',
    },
  },
  {
    cle: 'engagement',
    intitule: 'Engagement et motivation',
    niveaux: {
      A: 'Ne ménage ni son temps ni ses efforts.',
      B: 'Fait des efforts pour mener à bien ses tâches.',
      C: 'A besoin d’encouragements pour travailler.',
      D: 'Doit faire l’objet de rappels à l’ordre constants.',
    },
  },
  {
    cle: 'equipe',
    intitule: 'Esprit d’équipe',
    niveaux: {
      A: 'Excellent esprit d’équipe, collaboration sans faille.',
      B: 'Collabore bien avec ses collègues et sa hiérarchie.',
      C: 'Collabore peu, tend à travailler en solitaire.',
      D: 'Rejette toute collaboration.',
    },
  },
  {
    cle: 'responsabilite',
    intitule: 'Sens des responsabilités et fiabilité',
    niveaux: {
      A: 'Assume pleinement ses responsabilités, grande fiabilité.',
      B: 'Assume correctement ses responsabilités.',
      C: 'N’assume qu’après rappel, a besoin d’un suivi.',
      D: 'N’assume pas ses responsabilités, demande un contrôle systématique.',
    },
  },
  {
    cle: 'imprevus',
    intitule: 'Capacité à faire face aux imprévus',
    niveaux: {
      A: 'Anticipe les imprévus avant qu’ils ne surviennent.',
      B: 'Gère efficacement les imprévus lorsqu’ils se présentent.',
      C: 'Perd pied face à une crise complexe ou à l’accumulation de problèmes.',
      D: 'Ignore le problème ou prend des décisions qui aggravent la situation initiale.',
    },
  },
  {
    cle: 'assiduite',
    intitule: 'Ponctualité, absentéisme et assiduité',
    niveaux: {
      A: 'Assiduité et ponctualité remarquables, ne quitte son lieu de travail qu’exceptionnellement.',
      B: 'Absences et retards rares, assiduité et ponctualité constantes.',
      C: 'Quelques absences et retards, perd parfois son temps dans la journée.',
      D: 'Beaucoup d’absences et de retards, ne se consacre jamais à son travail.',
    },
  },
  {
    cle: 'resolution',
    intitule: 'Capacité de résolution de problèmes',
    niveaux: {
      A: 'Identifie la cause profonde du problème, propose des solutions innovantes.',
      B: 'Autonome dans la résolution de la plupart des problèmes de son domaine d’expertise.',
      C: 'A souvent besoin d’un appui pour structurer son approche de résolution.',
      D: 'Évite de prendre en charge les problèmes ou réagit tardivement.',
    },
  },
  {
    cle: 'management',
    intitule: 'Management',
    niveaux: {
      A: 'Très fort ascendant, aptitude naturelle à diriger.',
      B: 'Son autorité est acceptée, se fait obéir.',
      C: 'Son autorité est souvent contestée.',
      D: 'Aucune autorité, pratique le laisser-faire.',
    },
    cadres: true,
  },
];

/** Les compétences de la fiche d'un agent : le management ne vaut que pour le personnel cadre. */
export const competencesDe = (personnel: PersonnelDeLaFiche): readonly Competence[] =>
  COMPETENCES.filter((c) => !c.cadres || personnel === 'cadre');

export const PERSONNELS_DE_LA_FICHE = ['cadre', 'non_cadre'] as const;
export type PersonnelDeLaFiche = (typeof PERSONNELS_DE_LA_FICHE)[number];

export const LIBELLES_DU_PERSONNEL: Record<PersonnelDeLaFiche, string> = {
  cadre: 'Cadre',
  non_cadre: 'Non-cadre',
};

/** La synthèse générale du N+1, dans la partie réservée à la hiérarchie. */
export const SYNTHESE_GENERALE: readonly {
  cle: 'comprehension' | 'tenue';
  intitule: string;
  niveaux: Record<Niveau, string>;
}[] = [
  {
    cle: 'comprehension',
    intitule: 'Compréhension du poste',
    niveaux: {
      A: 'Connaît parfaitement le poste de travail.',
      B: 'Connaît assez bien le poste de travail.',
      C: 'Connaît à peine le poste de travail.',
      D: 'Ne connaît pas le poste de travail.',
    },
  },
  {
    cle: 'tenue',
    intitule: 'Tenue du poste',
    niveaux: {
      A: 'Tient parfaitement le poste.',
      B: 'Tient correctement le poste.',
      C: 'A besoin d’un suivi pour tenir le poste.',
      D: 'N’est pas à l’aise dans le poste.',
    },
  },
];

/** Le récapitulatif de l'année, rempli par l'agent. */
export const QUESTIONS_DU_BILAN = [
  { cle: 'vecu', question: 'Comment avez-vous vécu l’année ?' },
  {
    cle: 'difficultes',
    question: 'Avez-vous rencontré des difficultés dans vos tâches ? Si oui, lesquelles ?',
  },
] as const;

/** Les préoccupations et les souhaits de l'agent. */
export const QUESTIONS_DES_SOUHAITS = [
  {
    cle: 'avenir',
    question: 'Comment envisagez-vous votre avenir professionnel ?',
    precision: 'Évolution, mobilité…',
  },
  {
    cle: 'missions',
    question:
      'Quelles missions vous conviennent le mieux, et lesquelles souhaiteriez-vous développer ?',
  },
  {
    cle: 'contraintes',
    question:
      'Quelles sont les principales difficultés ou contraintes que vous rencontrez dans votre travail ?',
  },
  {
    cle: 'competencesInexploitees',
    question:
      'Y a-t-il des compétences ou des qualités qui ne sont pas assez exploitées dans votre poste ?',
  },
] as const;

/** Les longueurs que chaque champ accepte, en caractères. */
export const LONGUEURS_DE_LA_FICHE = {
  intitule: 600,
  indicateurs: 600,
  /** Une réponse ou un commentaire. */
  texte: 2000,
  /** Une cellule d'un tableau : une action, une formation. */
  ligne: 300,
  delai: 80,
} as const;

/** Au plus, dans les tableaux de la fiche. */
export const MAXIMUMS_DE_LA_FICHE = {
  objectifs: 12,
  actions: 8,
  objectifsAVenir: 10,
  formations: 6,
} as const;

const texte = z.string().max(LONGUEURS_DE_LA_FICHE.texte);
const ligne = z.string().max(LONGUEURS_DE_LA_FICHE.ligne);

/** Un objectif de l'année évaluée, tel que la DCH l'a donné. */
export const objectifEvalueSchema = z.object({
  id: z.uuid(),
  intitule: z.string().trim().min(1).max(LONGUEURS_DE_LA_FICHE.intitule),
  indicateurs: z.string().trim().max(LONGUEURS_DE_LA_FICHE.indicateurs),
});
export type ObjectifEvalue = z.infer<typeof objectifEvalueSchema>;

/** Ce que l'agent dit d'un objectif. */
export const appreciationDeLAgentSchema = z.object({
  niveau: niveauSchema.nullable(),
  resultats: texte,
  commentaire: texte,
});
export type AppreciationDeLAgent = z.infer<typeof appreciationDeLAgentSchema>;

/** Ce que le N+1 retient d'un objectif, après l'entretien. */
export const appreciationDuN1Schema = z.object({
  niveau: niveauSchema.nullable(),
  commentaire: texte,
});
export type AppreciationDuN1 = z.infer<typeof appreciationDuN1Schema>;

/** L'auto-évaluation : tout ce que l'agent écrit. */
export const autoEvaluationSchema = z.object({
  vecu: texte,
  difficultes: texte,
  /** Par objectif, sous son identifiant. */
  objectifs: z.record(z.uuid(), appreciationDeLAgentSchema),
  autresRealisations: texte,
  avenir: texte,
  missions: texte,
  contraintes: texte,
  competencesInexploitees: texte,
  autresCommentaires: texte,
});
export type AutoEvaluation = z.infer<typeof autoEvaluationSchema>;

export const actionSchema = z.object({
  action: ligne,
  delai: z.string().max(LONGUEURS_DE_LA_FICHE.delai),
  suivi: ligne,
});
export type ActionDuPlan = z.infer<typeof actionSchema>;

export const objectifAVenirSchema = z.object({
  objectif: z.string().max(LONGUEURS_DE_LA_FICHE.intitule),
  indicateur: z.string().max(LONGUEURS_DE_LA_FICHE.indicateurs),
  /** AAAA-MM-JJ. */
  echeance: z.iso.date().nullable(),
});
export type ObjectifDeLAnneeAVenir = z.infer<typeof objectifAVenirSchema>;

export const formationSouhaiteeSchema = z.object({
  intitule: ligne,
  justification: ligne,
});
export type FormationSouhaitee = z.infer<typeof formationSouhaiteeSchema>;

/** L'évaluation du N+1 : ce que l'agent lit aussi. */
export const evaluationDuN1Schema = z.object({
  objectifs: z.record(z.uuid(), appreciationDuN1Schema),
  competences: z.partialRecord(z.enum(CLES_DE_COMPETENCE), niveauSchema.nullable()),
  pointsForts: texte,
  axesDeDeveloppement: texte,
  plan: z.array(actionSchema).max(MAXIMUMS_DE_LA_FICHE.actions),
  objectifsAVenir: z.array(objectifAVenirSchema).max(MAXIMUMS_DE_LA_FICHE.objectifsAVenir),
  formations: z.array(formationSouhaiteeSchema).max(MAXIMUMS_DE_LA_FICHE.formations),
});
export type EvaluationDuN1 = z.infer<typeof evaluationDuN1Schema>;

/** La partie strictement réservée à la hiérarchie : jamais lue par l'agent. */
export const partieReserveeSchema = z.object({
  comprehension: niveauSchema.nullable(),
  tenue: niveauSchema.nullable(),
  observations: texte,
});
export type PartieReservee = z.infer<typeof partieReserveeSchema>;

/**
 * Ce qui manque à une auto-évaluation pour partir au N+1 (ADR-0215), dans
 * l'ordre de la fiche : les deux questions du récapitulatif, puis, pour
 * chaque objectif, son niveau et ses résultats obtenus. Le reste se remplit
 * s'il y a lieu. L'écran et l'API appliquent la même règle.
 */
export function ceQuiManqueALAutoEvaluation(
  auto: AutoEvaluation,
  objectifs: readonly ObjectifEvalue[],
): string[] {
  const manque: string[] = [];
  if (!auto.vecu.trim()) manque.push('le vécu de l’année');
  if (!auto.difficultes.trim()) manque.push('les difficultés rencontrées');
  objectifs.forEach((o, i) => {
    const a = auto.objectifs[o.id];
    if (!a?.niveau) manque.push(`le niveau de l’objectif ${i + 1}`);
    if (!a?.resultats.trim()) manque.push(`les résultats de l’objectif ${i + 1}`);
  });
  return manque;
}

export const autoEvaluationVide = (): AutoEvaluation => ({
  vecu: '',
  difficultes: '',
  objectifs: {},
  autresRealisations: '',
  avenir: '',
  missions: '',
  contraintes: '',
  competencesInexploitees: '',
  autresCommentaires: '',
});

export const evaluationDuN1Vide = (): EvaluationDuN1 => ({
  objectifs: {},
  competences: {},
  pointsForts: '',
  axesDeDeveloppement: '',
  plan: [],
  objectifsAVenir: [],
  formations: [],
});

export const partieReserveeVide = (): PartieReservee => ({
  comprehension: null,
  tenue: null,
  observations: '',
});

/** Le nom du PDF d'une fiche : « fiche-entretien-2026-EMP-002.pdf ». */
export function nomDeLaFiche(annee: number, matricule: string | null, complete = false): string {
  const sans = (matricule ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const net = sans.replace(/[^A-Za-z0-9-]/g, '_');
  return `fiche-entretien-${annee}${net ? `-${net}` : ''}${complete ? '-complete' : ''}.pdf`;
}
