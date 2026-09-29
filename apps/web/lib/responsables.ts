'use client';

import { useQuery } from '@tanstack/react-query';
import type { EmployeeListPage, OrgUnitView } from '@teranga/contracts';
import { api } from './api';

/* ————————————————————————————————————————————————————————————————
   Les responsables hiérarchiques qu'on peut désigner.

   La règle de l'APIX veut le n+1 dans la MÊME DIRECTION que l'agent, un
   directeur exceptant — il relève du directeur général. Un formulaire qui
   proposerait les trois cents dossiers de l'agence ferait donc choisir un
   rattachement que le serveur refuse ensuite ; celui-ci ne propose que ce qui
   tient.

   Le filtrage se fait AU SERVEUR, par direction : filtrer après coup une page
   de cent lignes laisserait de côté les agents d'une grande direction, et
   c'est précisément là qu'on cherche un responsable.
   ———————————————————————————————————————————————————————————————— */

export interface OptionResponsable {
  id: string;
  nom: string;
  poste: string | null;
}

/**
 * @param unite La direction de l'agent, telle que la liste du personnel
 *   l'affiche (l'abrégé s'il existe, sinon le nom) — c'est exactement ce que
 *   le filtre `unit` de l'API compare. `null` : aucune direction connue, on ne
 *   restreint rien.
 * @param exclure L'agent lui-même : on ne relève pas de soi.
 * @param directeur L'agent dirige une direction : il ne relève que du DG.
 * @param actif Faux quand aucun choix n'est à faire (fiche en lecture) : la
 *   liste du personnel n'est alors pas demandée — l'agent sur sa propre
 *   fiche n'y a pas accès.
 */
export function useResponsablesPossibles(
  unite: string | null,
  exclure?: string,
  directeur = false,
  actif = true,
): { options: OptionResponsable[]; chargement: boolean } {
  const agents = useQuery({
    queryKey: ['employees', 'responsables', unite],
    queryFn: () =>
      api<EmployeeListPage>(
        `/employees?status=active&limit=100${unite ? `&unit=${encodeURIComponent(unite)}` : ''}`,
      ),
    enabled: actif && !directeur,
  });
  // L'organigramme sert à deux choses ici. Le directeur général, d'abord :
  // c'est le responsable du SOMMET, que le serveur désigne. Il n'appartient à
  // aucune des directions filtrées et resterait donc introuvable — alors que
  // c'est de lui que relève un directeur, et lui seul quand la direction n'a
  // pas encore de tête. La direction, ensuite : pourvue, le DG n'y est pas
  // proposé — le serveur le refuserait.
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
    enabled: actif,
  });

  const sommet = (unites.data ?? []).find((u) => u.sommet);
  const dg =
    sommet?.managerEmployeeId && sommet.managerName && sommet.managerEmployeeId !== exclure
      ? { id: sommet.managerEmployeeId, nom: sommet.managerName, poste: sommet.managerPosition }
      : null;
  if (directeur) {
    return { options: dg ? [dg] : [], chargement: unites.isPending };
  }
  const direction = unite
    ? (unites.data ?? []).find(
        (u) => u.unitType === 'direction' && (u.shortName ?? u.name) === unite,
      )
    : undefined;
  const options: OptionResponsable[] = (agents.data?.items ?? [])
    .filter((m) => m.id !== exclure)
    .map((m) => ({
      id: m.id,
      nom: `${m.givenName} ${m.familyName}`,
      poste: m.positionTitle,
    }));
  const dgPossible = !direction || direction.sommet || !direction.managerEmployeeId;
  if (dg && dgPossible && !options.some((o) => o.id === dg.id)) options.push(dg);
  return { options, chargement: agents.isPending || unites.isPending };
}

/**
 * Le n+1 d'office — la règle du serveur, lue sur l'organigramme : le
 * directeur coiffe sa direction. Pour un directeur, le DG ; sinon le
 * responsable de la direction de l'unité (le DG pour la Direction Générale).
 * `null` : l'agent est le DG, l'unité n'a pas de direction, ou la direction
 * attend sa tête — le n+1 reste alors à choisir.
 *
 * @param uniteId L'unité d'affectation de l'agent (ou visée).
 * @param agentId L'agent, s'il existe déjà : on ne relève pas de soi.
 */
export function n1DOffice(
  unites: OrgUnitView[],
  uniteId: string | null | undefined,
  agentId?: string,
): string | null {
  const dg = unites.find((u) => u.sommet)?.managerEmployeeId ?? null;
  if (agentId && agentId === dg) return null;
  if (
    agentId &&
    unites.some((u) => u.unitType === 'direction' && !u.sommet && u.managerEmployeeId === agentId)
  ) {
    return dg;
  }
  let u = unites.find((x) => x.id === uniteId) ?? null;
  const vus = new Set<string>();
  while (u && u.unitType !== 'direction' && !vus.has(u.id)) {
    vus.add(u.id);
    const parent: string | null = u.parentId;
    u = unites.find((x) => x.id === parent) ?? null;
  }
  const tete = u?.unitType === 'direction' ? u.managerEmployeeId : null;
  return tete && tete !== agentId ? tete : null;
}
