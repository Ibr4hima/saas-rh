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
 * L'ordre des tests EST la priorité annoncée au contrat : une boucle avant un
 * n+1 manquant, un n+1 manquant avant un rattachement hors direction. Le
 * dernier cas — « sans direction » — n'est pas une faute de rattachement mais
 * un trou d'affectation : il empêche seulement de VÉRIFIER la règle.
 */
function anomalieDe(
  l: LigneHierarchie,
  boucles: Set<string>,
  directeurGeneralId: string | null,
): TypeAnomalieHierarchie | null {
  // Le directeur général n'a pas de n+1 : c'est le seul, et c'est voulu. En
  // avoir un n'est pas un détail — il entrerait dans l'équipe de quelqu'un.
  if (l.estDirecteurGeneral) return l.responsableId === null ? null : 'dg_rattache';
  if (boucles.has(l.employeeId)) return 'boucle';
  if (l.responsableId === null) return 'sans_responsable';
  if (l.responsableActif === false) return 'responsable_archive';
  if (l.dirigeUneDirection) {
    return l.responsableId === directeurGeneralId ? null : 'directeur_mal_rattache';
  }
  if (l.directionId === null) return 'sans_direction';
  // Un n+1 sans affectation ne prouve rien contre l'agent : c'est LE N+1 qui
  // est en défaut, et sa propre ligne le dit déjà. Le signaler ici ferait
  // corriger la mauvaise fiche.
  if (l.responsableDirectionId === null) return null;
  return l.responsableDirectionId === l.directionId ? null : 'hors_direction';
}

export const TYPES_ANOMALIE: TypeAnomalieHierarchie[] = [
  'boucle',
  'dg_rattache',
  'sans_responsable',
  'responsable_archive',
  'directeur_mal_rattache',
  'hors_direction',
  'sans_direction',
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
