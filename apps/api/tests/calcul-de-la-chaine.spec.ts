/**
 * Le calcul des deux N+1 (ADR-0147), sans base.
 *
 * La fonction est pure : l'organigramme se pose en quelques lignes, et chaque
 * règle s'éprouve seule. Le N+1 hiérarchique suit l'organigramme ; à la
 * Direction Générale, la place choisie (le DGA, la tête d'une autre unité)
 * prend le relais du DG. Le N+1 fonctionnel se choisit, et ce choix ne tient
 * que si la personne le peut.
 */
import { describe, expect, it } from 'vitest';
import {
  calculerLaChaine,
  peutChoisirSonRattachement,
  type AgentDeLaChaine,
  type PhotoDeLaChaine,
  type UniteDeLaChaine,
} from '../src/modules/people/calcul-de-la-chaine';

/*
   L'organigramme d'essai :
     DG (tête : dg, DGA : dga)
       ├─ DFC, direction (tête : dfc)
       │    ├─ DEP, département (tête : dep)
       │    │    └─ SRV, service (tête : srv)
       │    └─ SVD, service rattaché à la direction (tête : svd)
       ├─ DCH, direction (tête : dch)
       ├─ CAB, département rattaché à la Direction Générale (tête : cab)
       └─ COM, service rattaché à la Direction Générale (tête : com)
*/
function unites(plus: Partial<Record<string, Partial<UniteDeLaChaine>>> = {}): UniteDeLaChaine[] {
  const base: UniteDeLaChaine[] = [
    { id: 'DG', parentId: null, type: 'direction', teteId: 'dg' },
    { id: 'DFC', parentId: 'DG', type: 'direction', teteId: 'dfc' },
    { id: 'DEP', parentId: 'DFC', type: 'department', teteId: 'dep' },
    { id: 'SRV', parentId: 'DEP', type: 'service', teteId: 'srv' },
    { id: 'SVD', parentId: 'DFC', type: 'service', teteId: 'svd' },
    { id: 'DCH', parentId: 'DG', type: 'direction', teteId: 'dch' },
    { id: 'CAB', parentId: 'DG', type: 'department', teteId: 'cab' },
    { id: 'COM', parentId: 'DG', type: 'service', teteId: 'com' },
  ];
  return base.map((u) => ({ ...u, ...plus[u.id] }));
}

function agent(id: string, uniteId: string | null, plus: Partial<AgentDeLaChaine> = {}) {
  return {
    id,
    uniteId,
    n1Actuel: null,
    n1UniteId: null,
    n1Dga: false,
    n1FonctionnelId: null,
    ...plus,
  } satisfies AgentDeLaChaine;
}

const AGENTS: AgentDeLaChaine[] = [
  agent('dg', 'DG'),
  agent('dga', 'DG'),
  agent('dfc', 'DFC'),
  agent('dep', 'DEP'),
  agent('srv', 'SRV'),
  agent('svd', 'SVD'),
  agent('dch', 'DCH'),
  agent('cab', 'CAB'),
  agent('com', 'COM'),
  agent('a-srv', 'SRV'),
  agent('a-dep', 'DEP'),
  agent('a-dfc', 'DFC'),
  agent('a-dg', 'DG'),
];

function photo(
  plus: {
    unites?: UniteDeLaChaine[];
    agents?: AgentDeLaChaine[];
    remplacer?: Record<string, Partial<AgentDeLaChaine>>;
    sans?: string[];
    adjointId?: string | null;
    inaptes?: string[];
  } = {},
): PhotoDeLaChaine {
  const agents = (plus.agents ?? AGENTS)
    .filter((a) => !plus.sans?.includes(a.id))
    .map((a) => ({ ...a, ...plus.remplacer?.[a.id] }));
  return {
    sommetId: 'DG',
    adjointId: plus.adjointId === undefined ? 'dga' : plus.adjointId,
    unites: plus.unites ?? unites(),
    agents,
    inaptes: new Set(plus.inaptes ?? []),
  };
}

const n1 = (p: PhotoDeLaChaine, id: string) => calculerLaChaine(p).hierarchique.get(id);

describe('le N+1 hiérarchique suit l’organigramme', () => {
  it('le DG ne relève de personne', () => {
    expect(n1(photo(), 'dg')).toEqual({ id: null, motif: 'dg' });
  });

  it('les têtes de direction et le DGA relèvent du DG', () => {
    expect(n1(photo(), 'dfc')).toEqual({ id: 'dg', motif: 'tete_de_direction' });
    expect(n1(photo(), 'dch')).toEqual({ id: 'dg', motif: 'tete_de_direction' });
    expect(n1(photo(), 'dga')).toEqual({ id: 'dg', motif: 'dga' });
  });

  it('la tête d’un département relève de la tête de sa direction', () => {
    expect(n1(photo(), 'dep')).toEqual({ id: 'dfc', motif: 'unite_au_dessus' });
  });

  it('la tête d’un service relève du département qui le contient, sinon de la direction', () => {
    expect(n1(photo(), 'srv')).toEqual({ id: 'dep', motif: 'unite_au_dessus' });
    expect(n1(photo(), 'svd')).toEqual({ id: 'dfc', motif: 'unite_au_dessus' });
  });

  it('un autre agent relève de la tête de son unité', () => {
    expect(n1(photo(), 'a-srv')).toEqual({ id: 'srv', motif: 'tete_de_son_unite' });
    expect(n1(photo(), 'a-dep')).toEqual({ id: 'dep', motif: 'tete_de_son_unite' });
    expect(n1(photo(), 'a-dfc')).toEqual({ id: 'dfc', motif: 'tete_de_son_unite' });
  });

  it('un agent rattaché directement à la Direction Générale relève du DG', () => {
    expect(n1(photo(), 'a-dg')).toEqual({ id: 'dg', motif: 'direction_generale' });
  });

  it('un poste vacant renvoie au premier niveau occupé au-dessus', () => {
    // Le service sans tête : son agent relève du département.
    const p1 = photo({ sans: ['srv'] });
    expect(n1(p1, 'a-srv')).toEqual({ id: 'dep', motif: 'niveau_au_dessus' });
    // Le département aussi : la direction.
    const p2 = photo({ sans: ['srv', 'dep'] });
    expect(n1(p2, 'a-srv')).toEqual({ id: 'dfc', motif: 'niveau_au_dessus' });
    // Toute la branche : le DG.
    const p3 = photo({ sans: ['srv', 'dep', 'dfc'] });
    expect(n1(p3, 'a-srv')).toEqual({ id: 'dg', motif: 'niveau_au_dessus' });
    // La tête d'un service sous un département vacant : la direction.
    expect(n1(photo({ sans: ['dep'] }), 'srv')).toEqual({ id: 'dfc', motif: 'unite_au_dessus' });
  });

  it('une tête qui n’est plus active laisse sa place vacante', () => {
    // `dep` reste écrit à la tête du département, mais n'est plus actif.
    const p = photo({ sans: ['dep'] });
    expect(n1(p, 'a-dep')).toEqual({ id: 'dfc', motif: 'niveau_au_dessus' });
  });

  it('sans unité, pas de N+1 hiérarchique', () => {
    const p = photo({ agents: [...AGENTS, agent('perdu', null)] });
    expect(n1(p, 'perdu')).toEqual({ id: null, motif: 'sans_unite' });
  });

  it('sans DG, personne au-dessus des têtes de direction', () => {
    const p = photo({ sans: ['dg'] });
    expect(n1(p, 'dfc')).toEqual({ id: null, motif: 'sans_dg' });
    expect(n1(p, 'dga')).toEqual({ id: null, motif: 'sans_dg' });
    expect(n1(p, 'a-dg')).toEqual({ id: null, motif: 'sans_dg' });
    // Le reste de la chaîne tient.
    expect(n1(p, 'a-srv')).toEqual({ id: 'srv', motif: 'tete_de_son_unite' });
  });
});

describe('l’exception de la Direction Générale', () => {
  it('les têtes rattachées à la Direction Générale relèvent du DG par défaut', () => {
    expect(n1(photo(), 'cab')).toEqual({ id: 'dg', motif: 'unite_au_dessus' });
    expect(n1(photo(), 'com')).toEqual({ id: 'dg', motif: 'unite_au_dessus' });
  });

  it('le choix se fait pour ces têtes, et pour les agents rattachés directement', () => {
    const p = photo();
    for (const id of ['cab', 'com', 'a-dg']) expect(peutChoisirSonRattachement(p, id)).toBe(true);
    for (const id of ['dg', 'dga', 'dfc', 'dep', 'srv', 'svd', 'a-srv', 'a-dfc']) {
      expect(peutChoisirSonRattachement(p, id)).toBe(false);
    }
  });

  it('le DGA, ou la tête d’une autre unité, prend le relais du DG', () => {
    const p = photo({ remplacer: { cab: { n1Dga: true }, com: { n1UniteId: 'DFC' } } });
    const r = calculerLaChaine(p);
    expect(r.hierarchique.get('cab')).toEqual({ id: 'dga', motif: 'rattachement_choisi' });
    expect(r.hierarchique.get('com')).toEqual({ id: 'dfc', motif: 'rattachement_choisi' });
    expect(r.choixCaducs).toEqual([]);
  });

  it('le choix désigne une place : il suit qui la tient', () => {
    const p = photo({
      unites: unites({ DFC: { teteId: 'dch' } }),
      remplacer: { com: { n1UniteId: 'DFC' } },
    });
    expect(n1(p, 'com')).toEqual({ id: 'dch', motif: 'rattachement_choisi' });
  });

  it('vacante, la place choisie laisse le DG reprendre, et le choix reste', () => {
    const p = photo({ sans: ['dfc'], remplacer: { com: { n1UniteId: 'DFC' } } });
    const r = calculerLaChaine(p);
    expect(r.hierarchique.get('com')).toEqual({ id: 'dg', motif: 'unite_au_dessus' });
    expect(r.choixCaducs).toEqual([]);
    // Le DGA absent : de même.
    const sansDga = photo({ adjointId: null, remplacer: { cab: { n1Dga: true } } });
    expect(calculerLaChaine(sansDga).hierarchique.get('cab')?.id).toBe('dg');
    expect(calculerLaChaine(sansDga).choixCaducs).toEqual([]);
  });

  it('hors de la Direction Générale, un choix ne tient pas et s’efface', () => {
    const p = photo({ remplacer: { 'a-dfc': { n1Dga: true }, dep: { n1UniteId: 'DCH' } } });
    const r = calculerLaChaine(p);
    expect(r.choixCaducs.sort()).toEqual(['a-dfc', 'dep']);
    expect(r.hierarchique.get('a-dfc')).toEqual({ id: 'dfc', motif: 'tete_de_son_unite' });
    expect(r.hierarchique.get('dep')).toEqual({ id: 'dfc', motif: 'unite_au_dessus' });
  });

  it('une unité supprimée efface le choix', () => {
    const p = photo({ remplacer: { com: { n1UniteId: 'DISPARUE' } } });
    expect(calculerLaChaine(p).choixCaducs).toEqual(['com']);
  });

  it('un choix qui ferait une boucle s’efface', () => {
    // Un service sous le département rattaché à la Direction Générale : sa
    // tête relève de `cab`. Que `cab` relève de `scab` ferait une boucle.
    const p = photo({
      unites: [...unites(), { id: 'SCAB', parentId: 'CAB', type: 'service', teteId: 'scab' }],
      agents: [...AGENTS, agent('scab', 'SCAB')],
      remplacer: { cab: { n1UniteId: 'SCAB' } },
    });
    const r = calculerLaChaine(p);
    expect(r.choixCaducs).toEqual(['cab']);
    expect(r.hierarchique.get('cab')).toEqual({ id: 'dg', motif: 'unite_au_dessus' });
  });
});

describe('le N+1 fonctionnel', () => {
  it('tient quand la personne est active, hors stage, et sans boucle', () => {
    const p = photo({ remplacer: { 'a-srv': { n1FonctionnelId: 'dch' } } });
    expect(calculerLaChaine(p).fonctionnelsCaducs).toEqual([]);
  });

  it('s’efface quand la personne n’est plus active', () => {
    const p = photo({ sans: ['dch'], remplacer: { 'a-srv': { n1FonctionnelId: 'dch' } } });
    expect(calculerLaChaine(p).fonctionnelsCaducs).toEqual(['a-srv']);
  });

  it('s’efface quand la personne est en stage ou hors contrat', () => {
    const p = photo({ inaptes: ['dch'], remplacer: { 'a-srv': { n1FonctionnelId: 'dch' } } });
    expect(calculerLaChaine(p).fonctionnelsCaducs).toEqual(['a-srv']);
  });

  it('s’efface pour le DG, qui n’a de N+1 d’aucune sorte', () => {
    const p = photo({ remplacer: { dg: { n1FonctionnelId: 'dch' } } });
    expect(calculerLaChaine(p).fonctionnelsCaducs).toEqual(['dg']);
  });

  it('s’efface quand le choix ferait une boucle', () => {
    // `srv` relève de `dep` ; que `dep` ait `srv` pour N+1 fonctionnel
    // bouclerait.
    const p = photo({ remplacer: { dep: { n1FonctionnelId: 'srv' } } });
    expect(calculerLaChaine(p).fonctionnelsCaducs).toEqual(['dep']);
  });

  it('ne change jamais le N+1 hiérarchique', () => {
    const p = photo({ remplacer: { 'a-srv': { n1FonctionnelId: 'dch' } } });
    expect(n1(p, 'a-srv')).toEqual({ id: 'srv', motif: 'tete_de_son_unite' });
  });
});
