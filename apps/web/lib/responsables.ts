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
 */
export function useResponsablesPossibles(
  unite: string | null,
  exclure?: string,
): { options: OptionResponsable[]; chargement: boolean } {
  const agents = useQuery({
    queryKey: ['employees', 'responsables', unite],
    queryFn: () =>
      api<EmployeeListPage>(
        `/employees?status=active&limit=100${unite ? `&unit=${encodeURIComponent(unite)}` : ''}`,
      ),
  });
  // L'organigramme sert à une seule chose ici : le directeur général, qui est
  // le responsable de l'unité RACINE. Il n'appartient à aucune des directions
  // filtrées et resterait donc introuvable — alors que c'est de lui que
  // relève un directeur, et lui seul quand la direction n'a pas encore de
  // tête. L'unité porte déjà son nom et son poste : pas besoin d'un appel de
  // plus pour les lire.
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });

  const racine = (unites.data ?? []).find((u) => u.parentId === null);
  const options: OptionResponsable[] = (agents.data?.items ?? [])
    .filter((m) => m.id !== exclure)
    .map((m) => ({
      id: m.id,
      nom: `${m.givenName} ${m.familyName}`,
      poste: m.positionTitle,
    }));
  if (
    racine?.managerEmployeeId &&
    racine.managerName &&
    racine.managerEmployeeId !== exclure &&
    !options.some((o) => o.id === racine.managerEmployeeId)
  ) {
    options.push({
      id: racine.managerEmployeeId,
      nom: racine.managerName,
      poste: racine.managerPosition,
    });
  }
  return { options, chargement: agents.isPending || unites.isPending };
}
