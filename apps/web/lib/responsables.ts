'use client';

import { useQuery } from '@tanstack/react-query';
import type { EmployeeListItem, EmployeeListPage, OrgUnitView } from '@teranga/contracts';
import { api } from './api';

/* ————————————————————————————————————————————————————————————————
   Les N+1 qu'on peut choisir (ADR-0147).

   Le N+1 HIÉRARCHIQUE ne se choisit pas : le serveur le calcule à partir de
   l'organigramme. Seule exception, à la Direction Générale : la place dont
   relève un agent qui y est rattaché directement (le DG par défaut, le DGA,
   ou la tête d'une autre unité).

   Le N+1 FONCTIONNEL se choisit parmi tous les agents actifs, de toutes les
   directions, hors stage : la liste se lit donc page après page, sans filtre
   de direction.
   ———————————————————————————————————————————————————————————————— */

export interface OptionResponsable {
  id: string;
  nom: string;
  matricule: string | null;
}

/**
 * Un N+1 dans une liste de choix : son nom, puis son matricule. Le
 * matricule distingue deux homonymes, là où le poste ne dit rien de sûr.
 */
export function libelleResponsable(m: OptionResponsable): string {
  return m.matricule ? `${m.nom} · ${m.matricule}` : m.nom;
}

/**
 * Qui peut être N+1 fonctionnel : les agents actifs hors stage, de toutes
 * les directions, par ordre alphabétique.
 *
 * @param exclure L'agent lui-même : on ne relève pas de soi.
 * @param actif Faux quand aucun choix n'est à faire : la liste du personnel
 *   n'est alors pas demandée.
 */
export function useN1FonctionnelsPossibles(
  exclure?: string,
  actif = true,
): { options: OptionResponsable[]; chargement: boolean } {
  const agents = useQuery({
    queryKey: ['employees', 'n1-fonctionnels'],
    queryFn: async () => {
      const tous: EmployeeListItem[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page: EmployeeListPage = await api<EmployeeListPage>(
          `/employees?status=active&horsStage=true&sort=name&dir=asc&limit=100&offset=${offset}`,
        );
        tous.push(...page.items);
        offset = page.nextOffset;
      }
      return tous;
    },
    enabled: actif,
  });
  const options = (agents.data ?? [])
    .filter((m) => m.id !== exclure)
    .map((m) => ({ id: m.id, nom: `${m.givenName} ${m.familyName}`, matricule: m.employeeNumber }));
  return { options, chargement: agents.isPending };
}

/** Un rattachement possible à la Direction Générale : sa valeur dans la liste, et ce qu'on y lit. */
export interface OptionRattachement {
  /** `''` : le DG ; `dga` : le DGA ; `unite:<id>` : la tête de cette unité. */
  valeur: string;
  libelle: string;
}

/**
 * Les places dont peut relever un agent rattaché directement à la Direction
 * Générale : le DG (par défaut), le DGA, la tête de toute autre unité
 * pourvue. Jamais une personne sans responsabilité.
 *
 * @param agentId L'agent : l'unité dirigée par l'agent n'est pas proposée.
 */
export function rattachementsPossibles(
  unites: OrgUnitView[],
  agentId: string,
): OptionRattachement[] {
  const sommet = unites.find((u) => u.sommet);
  const options: OptionRattachement[] = [
    { valeur: '', libelle: sommet?.managerName ? `DG · ${sommet.managerName}` : 'DG' },
  ];
  if (sommet?.adjoint && sommet.adjoint.employeeId !== agentId) {
    options.push({ valeur: 'dga', libelle: `DGA · ${sommet.adjoint.nomAbrege}` });
  }
  const tetes = unites
    .filter((u) => !u.sommet && u.managerEmployeeId && u.managerEmployeeId !== agentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  for (const u of tetes) {
    options.push({
      valeur: `unite:${u.id}`,
      libelle: `${u.shortName ?? u.name} · ${u.managerName ?? ''}`,
    });
  }
  return options;
}
