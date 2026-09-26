import type { AnomalieHierarchie, TypeAnomalieHierarchie } from '@teranga/contracts';

/* ————————————————————————————————————————————————————————————————
   Le classement des anomalies de la chaîne hiérarchique.

   Fonction PURE, et volontairement : la lecture en base rend une photo de
   l'organigramme (qui relève de qui, qui dirige quoi, qui est où), et tout le
   jugement se fait ici. C'est ce jugement qui porte les règles métier, et
   c'est donc lui qui doit être éprouvé sans base — les boucles hiérarchiques
   notamment, qu'on ne veut pas fabriquer en SQL pour les tester.
   ———————————————————————————————————————————————————————————————— */

/** La photo d'un agent actif, telle que la base la rend. */
export interface LigneHierarchie {
  employeeId: string;
  matricule: string;
  nom: string;
  directionId: string | null;
  directionNom: string | null;
  responsableId: string | null;
  responsableNom: string | null;
  /** `false` quand le dossier du n+1 est archivé ; `null` s'il n'y en a pas. */
  responsableActif: boolean | null;
  responsableDirectionId: string | null;
  responsableDirectionNom: string | null;
  /** L'agent est responsable d'une unité de type « direction ». */
  dirigeUneDirection: boolean;
  /** L'agent est responsable de l'unité RACINE : c'est le directeur général. */
  estDirecteurGeneral: boolean;
  /** Sa direction a un responsable. Sans tête, c'est le DG qui la couvre. */
  directionPourvue: boolean;
  /** Sa direction est la Direction Générale — le sommet. */
  aLaDirectionGenerale: boolean;
}

/**
 * Les agents pris dans une boucle.
 *
 * On remonte chaque chaîne une seule fois : un nœud déjà classé « fini » n'est
 * pas réexaminé, et l'on ne retombe donc jamais dans un parcours quadratique
 * sur un effectif de plusieurs milliers. Seuls les membres DE la boucle sont
 * signalés — pas ceux qui y mènent : corriger la boucle les remet d'aplomb, et
 * les noyer dans la liste ferait chercher le vrai coupable.
 *
 * Une boucle qui passe par le directeur général n'en est pas une à signaler :
 * elle n'existe que parce qu'il a reçu un n+1. Le coupable est ce lien-là, et
 * c'est lui seul qu'on montre (« DG rattaché ») — le retirer répare tout.
 */
function membresDesBoucles(lignes: LigneHierarchie[]): Set<string> {
  const parent = new Map(lignes.map((l) => [l.employeeId, l.responsableId]));
  const dg = new Set(lignes.filter((l) => l.estDirecteurGeneral).map((l) => l.employeeId));
  const etat = new Map<string, 'en_cours' | 'fini'>();
  const boucles = new Set<string>();

  for (const depart of lignes) {
    if (etat.has(depart.employeeId)) continue;
    const chemin: string[] = [];
    let courant: string | null = depart.employeeId;
    while (courant !== null && !etat.has(courant)) {
      etat.set(courant, 'en_cours');
      chemin.push(courant);
      // Un n+1 absent de la photo — dossier archivé — termine la chaîne :
      // c'est une autre anomalie, pas une boucle.
      courant = parent.get(courant) ?? null;
    }
    if (courant !== null && etat.get(courant) === 'en_cours') {
      const boucle = chemin.slice(chemin.indexOf(courant));
      if (!boucle.some((id) => dg.has(id))) for (const id of boucle) boucles.add(id);
    }
    for (const id of chemin) etat.set(id, 'fini');
  }
  return boucles;
}

/**
 * L'anomalie d'un agent, ou rien si sa chaîne est en règle.
 *
 * Les tests suivent l'ordre de l'écriture (`validerRattachement`) : ce que
 * l'écriture refuse, le contrôle le signale, et sous le même nom. Une seule
 * anomalie par agent — la première qui s'applique ; l'ordre des types au
 * contrat en est la priorité d'affichage.
 */
function anomalieDe(
  l: LigneHierarchie,
  boucles: Set<string>,
  directeurGeneralId: string | null,
): TypeAnomalieHierarchie | null {
  // 1. Le directeur général ne relève de personne, et siège à la Direction
  //    Générale. Avoir un n+1 n'est pas un détail — il entrerait dans
  //    l'équipe de quelqu'un.
  if (l.estDirecteurGeneral) {
    if (l.responsableId !== null) return 'dg_rattache';
    if (l.directionId === null) return 'sans_direction';
    return l.aLaDirectionGenerale ? null : 'dg_hors_direction_generale';
  }
  if (boucles.has(l.employeeId)) return 'boucle';
  if (l.responsableId === null) return 'sans_responsable';
  if (l.responsableActif === false) return 'responsable_archive';
  // 2. D'abord l'affectation, ensuite le n+1 — pour l'agent comme pour son
  //    n+1. Sans l'une ou l'autre, la règle de direction ne se vérifie pas.
  if (l.directionId === null) return 'sans_direction';
  if (l.responsableDirectionId === null) return 'responsable_sans_direction';
  // 3. Un directeur relève du directeur général, de personne d'autre.
  if (l.dirigeUneDirection) {
    return l.responsableId === directeurGeneralId ? null : 'directeur_mal_rattache';
  }
  // 4. Le n+1 est de la même direction…
  if (l.responsableDirectionId === l.directionId) return null;
  // … sauf dans une direction sans tête : personne d'autre au-dessus que le
  // directeur général, qui couvre ses agents en attendant — l'écriture
  // l'accepte, le contrôle ne le reproche pas.
  if (l.responsableId === directeurGeneralId && !l.directionPourvue) return null;
  return 'hors_direction';
}

export const TYPES_ANOMALIE: TypeAnomalieHierarchie[] = [
  'boucle',
  'dg_rattache',
  'sans_responsable',
  'responsable_archive',
  'dg_hors_direction_generale',
  'directeur_mal_rattache',
  'hors_direction',
  'sans_direction',
  'responsable_sans_direction',
];

export function classerAnomalies(
  lignes: LigneHierarchie[],
  directeurGeneralId: string | null,
): AnomalieHierarchie[] {
  const boucles = membresDesBoucles(lignes);
  const anomalies: AnomalieHierarchie[] = [];
  for (const l of lignes) {
    const type = anomalieDe(l, boucles, directeurGeneralId);
    if (!type) continue;
    anomalies.push({
      employeeId: l.employeeId,
      matricule: l.matricule,
      nom: l.nom,
      direction: l.directionNom,
      type,
      responsable: l.responsableNom,
      directionDuResponsable: l.responsableDirectionNom,
    });
  }
  // Les plus bloquantes d'abord, puis par matricule : la liste se corrige de
  // haut en bas, et deux lectures successives la rendent dans le même ordre.
  return anomalies.sort(
    (a, b) =>
      TYPES_ANOMALIE.indexOf(a.type) - TYPES_ANOMALIE.indexOf(b.type) ||
      a.matricule.localeCompare(b.matricule, 'fr'),
  );
}

export function compterParType(
  anomalies: AnomalieHierarchie[],
): Record<TypeAnomalieHierarchie, number> {
  const parType = Object.fromEntries(TYPES_ANOMALIE.map((t) => [t, 0])) as Record<
    TypeAnomalieHierarchie,
    number
  >;
  for (const a of anomalies) parType[a.type] += 1;
  return parType;
}
