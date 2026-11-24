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

/**
 * Le personnel de la fiche d'un agent : cadre, sinon non cadre. Sans statut
 * connu, le management ne s'applique pas.
 */
export const personnelDeLaFiche = (statut: PersonnelDeLaFiche | null): PersonnelDeLaFiche =>
  statut === 'cadre' ? 'cadre' : 'non_cadre';

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

/*
   Une question peut se répondre en puces, une par ligne (`puces`), ou
   d'abord par oui ou par non, puis, si oui, en puces (`ouiNon`, la clé du
   choix) (ADR-0238).
*/

/** Le récapitulatif de l'année, rempli par l'agent. */
export const QUESTIONS_DU_BILAN = [
  { cle: 'vecu', question: 'Comment avez-vous vécu l’année ?' },
  {
    cle: 'difficultes',
    question: 'Avez-vous rencontré des difficultés dans vos tâches ? Si oui, lesquelles ?',
    ouiNon: 'aDesDifficultes',
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
    puces: true,
  },
  {
    cle: 'contraintes',
    question:
      'Quelles sont les principales difficultés ou contraintes que vous rencontrez dans votre travail ?',
    puces: true,
  },
  {
    cle: 'competencesInexploitees',
    question:
      'Y a-t-il des compétences ou des qualités qui ne sont pas assez exploitées dans votre poste ?',
    ouiNon: 'aDesCompetencesInexploitees',
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

/**
 * Les objectifs de l'année que fixe le N+1, pendant la campagne des
 * objectifs : trois au moins, cinq au plus (ADR-0239, ADR-0274). La fiche en
 * garde jusqu'à dix, la limite d'avant la règle.
 */
export const NOMBRE_D_OBJECTIFS_A_VENIR = { min: 3, max: 5 } as const;

const texte = z.string().max(LONGUEURS_DE_LA_FICHE.texte);
const ligne = z.string().max(LONGUEURS_DE_LA_FICHE.ligne);

/**
 * Un objectif de l'année évaluée, tel que la DCH l'a donné, ou que le N+1
 * l'a fixé pendant la campagne des objectifs, avec son échéance (ADR-0274).
 */
export const objectifEvalueSchema = z.object({
  id: z.uuid(),
  intitule: z.string().trim().min(1).max(LONGUEURS_DE_LA_FICHE.intitule),
  indicateurs: z.string().trim().max(LONGUEURS_DE_LA_FICHE.indicateurs),
  /** AAAA-MM-JJ. */
  echeance: z.iso.date().nullable().optional(),
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

/**
 * L'auto-évaluation : tout ce que l'agent écrit. Une réponse en puces garde
 * une puce par ligne. Un choix oui ou non vaut `null` tant que l'agent n'a
 * pas choisi (ADR-0238).
 */
export const autoEvaluationSchema = z.object({
  vecu: texte,
  aDesDifficultes: z.boolean().nullable(),
  /** En puces, si oui. */
  difficultes: texte,
  /** Par objectif, sous son identifiant. */
  objectifs: z.record(z.uuid(), appreciationDeLAgentSchema),
  autresRealisations: texte,
  avenir: texte,
  /** En puces. */
  missions: texte,
  /** En puces. */
  contraintes: texte,
  aDesCompetencesInexploitees: z.boolean().nullable(),
  /** En puces, si oui. */
  competencesInexploitees: texte,
  autresCommentaires: texte,
});
export type AutoEvaluation = z.infer<typeof autoEvaluationSchema>;

/** Les choix oui ou non de l'auto-évaluation. */
export type ChoixDeLAuto = 'aDesDifficultes' | 'aDesCompetencesInexploitees';

/**
 * Les puces d'une réponse : ses lignes écrites, sans le tiret ou la puce
 * qu'un texte collé ou écrit avant les puces mettait en tête (ADR-0238).
 */
export const pucesDe = (texte: string): string[] =>
  texte
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*–]\s+/, '').trim())
    .filter(Boolean);

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

/**
 * Les objectifs de l'année sans leurs lignes restées vides : une ligne
 * ajoutée puis laissée blanche ne part pas avec eux (ADR-0274).
 */
export const objectifsEcrits = (objectifs: readonly ObjectifDeLAnneeAVenir[]) =>
  objectifs.filter((o) => ecrite(o.objectif, o.indicateur, o.echeance));

/**
 * Ce qui manque aux objectifs de l'année pour partir à l'agent (ADR-0274) :
 * de trois à cinq, chacun avec son intitulé, son indicateur de réussite et
 * son échéance, dans l'année. Vide : ils peuvent partir.
 */
export function ceQuiManqueAuxObjectifs(
  objectifs: readonly ObjectifDeLAnneeAVenir[],
  annee: number,
): string[] {
  const manque: string[] = [];
  const ecrits = objectifsEcrits(objectifs);
  ecrits.forEach((o, i) => {
    const n = i + 1;
    if (!o.objectif.trim()) manque.push(`l’intitulé de l’objectif ${n}`);
    if (!o.indicateur.trim()) manque.push(`l’indicateur de réussite de l’objectif ${n}`);
    if (!o.echeance) manque.push(`l’échéance de l’objectif ${n}`);
    else if (!o.echeance.startsWith(`${annee}-`)) {
      manque.push(`l’échéance de l’objectif ${n} (en ${annee})`);
    }
  });
  if (ecrits.length < NOMBRE_D_OBJECTIFS_A_VENIR.min) {
    manque.push(`les objectifs (${NOMBRE_D_OBJECTIFS_A_VENIR.min} au moins)`);
  } else if (ecrits.length > NOMBRE_D_OBJECTIFS_A_VENIR.max) {
    manque.push(`les objectifs (${NOMBRE_D_OBJECTIFS_A_VENIR.max} au plus)`);
  }
  return manque;
}

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
  formations: z.array(formationSouhaiteeSchema).max(MAXIMUMS_DE_LA_FICHE.formations),
  /** Le N+1 confirme avoir reçu l'agent en entretien (ADR-0265). */
  entretienConfirme: z.boolean().default(false),
  /**
   * AAAA-MM-JJ : le jour de l'entretien, entre la transmission de
   * l'auto-évaluation et le jour où l'évaluation part à l'agent (ADR-0265).
   */
  dateDeLEntretien: z.iso.date().nullable().default(null),
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
 * Ce qui manque à une auto-évaluation pour partir au N+1 (ADR-0215,
 * ADR-0238), dans l'ordre de la fiche : les deux questions du
 * récapitulatif, pour chaque objectif son niveau et ses résultats obtenus,
 * puis les quatre questions des préoccupations et des souhaits. Une
 * question à choix demande oui ou non, et, si oui, une puce au moins. Les
 * commentaires, les autres réalisations et les autres commentaires se
 * remplissent s'il y a lieu. L'écran et l'API appliquent la même règle.
 */
export function ceQuiManqueALAutoEvaluation(
  auto: AutoEvaluation,
  objectifs: readonly ObjectifEvalue[],
): string[] {
  const manque: string[] = [];
  const choix = (oui: boolean | null, texte: string, quoi: string) => {
    if (oui === null || (oui && pucesDe(texte).length === 0)) manque.push(quoi);
  };
  if (!auto.vecu.trim()) manque.push('le vécu de l’année');
  choix(auto.aDesDifficultes, auto.difficultes, 'les difficultés rencontrées');
  objectifs.forEach((o, i) => {
    const a = auto.objectifs[o.id];
    if (!a?.niveau) manque.push(`le niveau de l’objectif ${i + 1}`);
    if (!a?.resultats.trim()) manque.push(`les résultats de l’objectif ${i + 1}`);
  });
  if (!auto.avenir.trim()) manque.push('l’avenir professionnel');
  if (pucesDe(auto.missions).length === 0) manque.push('les missions');
  if (pucesDe(auto.contraintes).length === 0) manque.push('les contraintes du travail');
  choix(
    auto.aDesCompetencesInexploitees,
    auto.competencesInexploitees,
    'les compétences peu exploitées',
  );
  return manque;
}

/** Les réponses obligatoires d'une auto-évaluation : six questions, et deux par objectif (ADR-0238). */
export const reponsesObligatoiresDeLAuto = (objectifs: readonly ObjectifEvalue[]): number =>
  6 + 2 * objectifs.length;

/**
 * Le choix que donnait une réponse écrite avant les choix oui ou non
 * (ADR-0238) : rien d'écrit, pas de choix ; une réponse courte qui commence
 * par « Non », « Aucune », « Néant » ou « Rien », non ; une autre, oui.
 */
function choixDUneReponseEcrite(texte: string): boolean | null {
  const mots = texte
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (mots.length === 0) return null;
  return !(mots.length <= 3 && ['non', 'aucun', 'aucune', 'neant', 'rien'].includes(mots[0]!));
}

/**
 * Une auto-évaluation relue depuis la base : un champ absent reprend sa
 * valeur vide, et un choix absent se déduit de la réponse écrite avant les
 * choix oui ou non (ADR-0238).
 */
export function autoEvaluationRelue(lue: Partial<AutoEvaluation>): AutoEvaluation {
  const auto = { ...autoEvaluationVide(), ...lue };
  return {
    ...auto,
    aDesDifficultes: auto.aDesDifficultes ?? choixDUneReponseEcrite(auto.difficultes),
    aDesCompetencesInexploitees:
      auto.aDesCompetencesInexploitees ?? choixDUneReponseEcrite(auto.competencesInexploitees),
  };
}

/**
 * L'auto-évaluation telle qu'elle part au N+1 : une réponse en puces sans
 * ses lignes vides, et, sur un non, sans la liste écrite avant de changer
 * d'avis (ADR-0238).
 */
export function autoEvaluationTransmise(auto: AutoEvaluation): AutoEvaluation {
  const enPuces = (texte: string) => pucesDe(texte).join('\n');
  return {
    ...auto,
    difficultes: auto.aDesDifficultes ? enPuces(auto.difficultes) : '',
    missions: enPuces(auto.missions),
    contraintes: enPuces(auto.contraintes),
    competencesInexploitees: auto.aDesCompetencesInexploitees
      ? enPuces(auto.competencesInexploitees)
      : '',
  };
}

/**
 * Ce qui manque à l'évaluation du N+1 pour partir à l'agent (ADR-0216), dans
 * l'ordre de la fiche : l'appréciation de chaque objectif, chaque compétence
 * (le management, pour le personnel cadre, seulement s'il y a lieu), les
 * points forts et les axes de développement, les objectifs de l'année à
 * venir, de trois à cinq, chacun avec son intitulé (ADR-0239), la synthèse
 * générale de la partie réservée, puis l'entretien : sa confirmation et sa
 * date (ADR-0265). Avec `entretien`, la date doit tomber entre la
 * transmission de l'auto-évaluation (`du`) et le jour même (`au`). Le plan
 * d'action, les formations et les observations se remplissent s'il y a lieu.
 */
export function ceQuiManqueALEvaluationDuN1(
  evaluation: EvaluationDuN1,
  reservee: PartieReservee,
  objectifs: readonly ObjectifEvalue[],
  personnel: PersonnelDeLaFiche,
  entretien?: { du: string | null; au: string },
): string[] {
  const manque: string[] = [];
  objectifs.forEach((o, i) => {
    if (!evaluation.objectifs[o.id]?.niveau) manque.push(`l’appréciation de l’objectif ${i + 1}`);
  });
  for (const c of competencesDe(personnel)) {
    if (!c.cadres && !evaluation.competences[c.cle]) {
      manque.push(`la compétence « ${c.intitule} »`);
    }
  }
  if (!evaluation.pointsForts.trim()) manque.push('les points forts');
  if (!evaluation.axesDeDeveloppement.trim()) manque.push('les axes de développement');
  for (const c of SYNTHESE_GENERALE) {
    if (!reservee[c.cle]) manque.push(`la ${c.intitule.toLocaleLowerCase('fr')}`);
  }
  const le = evaluation.dateDeLEntretien;
  if (!evaluation.entretienConfirme) {
    manque.push('la confirmation de l’entretien');
  } else if (
    !le ||
    (entretien && ((entretien.du !== null && le < entretien.du) || le > entretien.au))
  ) {
    manque.push('la date de l’entretien');
  }
  return manque;
}

/** Une case écrite : un texte qui n'est pas que des blancs, une date. */
const ecrite = (...cases: (string | null)[]) => cases.some((c) => c !== null && c.trim() !== '');

/**
 * Les tableaux de l'évaluation du N+1 sans leurs lignes restées vides : une
 * ligne ajoutée puis laissée blanche ne part pas avec l'évaluation transmise.
 */
export function sansLignesVides(e: EvaluationDuN1): EvaluationDuN1 {
  return {
    ...e,
    plan: e.plan.filter((a) => ecrite(a.action, a.delai, a.suivi)),
    formations: e.formations.filter((f) => ecrite(f.intitule, f.justification)),
  };
}

export const autoEvaluationVide = (): AutoEvaluation => ({
  vecu: '',
  aDesDifficultes: null,
  difficultes: '',
  objectifs: {},
  autresRealisations: '',
  avenir: '',
  missions: '',
  contraintes: '',
  aDesCompetencesInexploitees: null,
  competencesInexploitees: '',
  autresCommentaires: '',
});

export const evaluationDuN1Vide = (): EvaluationDuN1 => ({
  objectifs: {},
  competences: {},
  pointsForts: '',
  axesDeDeveloppement: '',
  plan: [],
  formations: [],
  entretienConfirme: false,
  dateDeLEntretien: null,
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
