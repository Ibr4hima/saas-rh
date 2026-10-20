import type { MotifChangement } from '@teranga/contracts';

/*
   Le calcul des deux N+1 (ADR-0147).

   Fonction PURE : la base rend une photo (les unités, leurs têtes, les
   agents actifs et ce qui a été choisi pour eux), et tout le jugement se
   fait ici, éprouvé sans base.

   Le N+1 HIÉRARCHIQUE suit l'organigramme :
     - le DG ne relève de personne ; les têtes de direction et le DGA
       relèvent du DG ;
     - la tête d'un département ou d'un service relève de la tête de l'unité
       au-dessus de la sienne ;
     - un autre agent relève de la tête de son unité ;
     - un poste vacant renvoie au premier niveau occupé au-dessus, jusqu'au DG ;
     - à la Direction Générale, les têtes des unités qui y sont rattachées
       directement, et les agents qui y sont rattachés directement, relèvent
       du DG, ou de la place que la DCH a choisie : le DGA, ou la tête d'une
       autre unité.
   Le N+1 FONCTIONNEL se choisit ; ce choix ne tient que si la personne est
   active, hors stage, et ne crée pas de boucle.
*/

export type TypeDUnite = 'direction' | 'department' | 'service';

/** Une unité vivante de l'organigramme. */
export interface UniteDeLaChaine {
  id: string;
  parentId: string | null;
  type: TypeDUnite;
  /** Sa tête, telle qu'écrite ; prise en compte seulement si l'agent est actif. */
  teteId: string | null;
}

/** Un agent ACTIF, et les choix faits à son sujet. */
export interface AgentDeLaChaine {
  id: string;
  /** L'unité de l'affectation qui fait foi (en cours, sinon la prochaine). */
  uniteId: string | null;
  /** Le N+1 hiérarchique écrit aujourd'hui. */
  n1Actuel: string | null;
  /** Le rattachement choisi à la Direction Générale : la tête de cette unité… */
  n1UniteId: string | null;
  /** … ou le DGA. */
  n1Dga: boolean;
  n1FonctionnelId: string | null;
}

export interface PhotoDeLaChaine {
  /** Le sommet : la Direction Générale. */
  sommetId: string | null;
  /** Le DGA EN PLACE (en activité, affecté à la Direction Générale). */
  adjointId: string | null;
  unites: UniteDeLaChaine[];
  agents: AgentDeLaChaine[];
  /**
   * Qui ne peut pas être N+1 fonctionnel bien qu'actif : en stage ou sur le
   * point de l'être, ou hors contrat.
   */
  inaptes: ReadonlySet<string>;
}

export interface N1Calcule {
  id: string | null;
  motif: MotifChangement;
}

export interface ResultatDeLaChaine {
  /** Le N+1 hiérarchique attendu de chaque agent actif. */
  hierarchique: Map<string, N1Calcule>;
  /**
   * Les rattachements choisis qui ne tiennent plus et s'effacent : l'agent
   * n'est plus là où un choix se fait, l'unité n'existe plus, ou le choix
   * ferait une boucle. (Une place choisie vacante, elle, reste choisie : le
   * DG reprend le temps de la vacance.)
   */
  choixCaducs: string[];
  /** Les N+1 fonctionnels qui ne tiennent plus et s'effacent. */
  fonctionnelsCaducs: string[];
}

/** Ce que sait l'organigramme : de qui relève une place, qui la tient. */
class Organigramme {
  private readonly unites: Map<string, UniteDeLaChaine>;
  private readonly actifs: ReadonlySet<string>;
  readonly dg: string | null;
  /** Les unités que chaque agent actif dirige (une seule, en principe). */
  readonly dirigees = new Map<string, UniteDeLaChaine>();

  constructor(private readonly photo: PhotoDeLaChaine) {
    this.unites = new Map(photo.unites.map((u) => [u.id, u]));
    this.actifs = new Set(photo.agents.map((a) => a.id));
    this.dg = photo.sommetId ? this.tete(photo.sommetId) : null;
    for (const u of photo.unites) {
      const tete = this.tete(u.id);
      if (tete && !this.dirigees.has(tete)) this.dirigees.set(tete, u);
    }
  }

  unite(id: string | null): UniteDeLaChaine | null {
    return id ? (this.unites.get(id) ?? null) : null;
  }

  /** La tête d'une unité, quand l'agent est actif ; sinon la place est vacante. */
  tete(uniteId: string): string | null {
    const t = this.unites.get(uniteId)?.teteId ?? null;
    return t && this.actifs.has(t) ? t : null;
  }

  estSommet(uniteId: string | null): boolean {
    return uniteId !== null && uniteId === this.photo.sommetId;
  }

  /**
   * Le premier niveau occupé à partir d'une unité, elle comprise, en
   * remontant : sa tête, sinon la tête de l'unité au-dessus, et ainsi de
   * suite jusqu'au sommet, dont la tête est le DG. `exclure` : l'agent en
   * question, qui ne relève pas de soi. La remontée s'arrête sur une boucle
   * d'unités d'avant la règle.
   */
  premierNiveauOccupe(depuis: string | null, exclure: string): string | null {
    const vues = new Set<string>();
    let courante = this.unite(depuis);
    while (courante && !vues.has(courante.id)) {
      vues.add(courante.id);
      const t = this.tete(courante.id);
      if (t && t !== exclure) return t;
      courante = this.unite(courante.parentId);
    }
    return this.dg && this.dg !== exclure ? this.dg : null;
  }
}

/**
 * Le rattachement de cet agent se choisit-il ? Oui à la tête d'un
 * département ou d'un service rattaché DIRECTEMENT à la Direction Générale,
 * ou pour un agent rattaché directement à la Direction Générale sans rien
 * diriger. Ni pour le DG ni pour le DGA : leur place dit déjà leur N+1.
 */
export function peutChoisirSonRattachement(photo: PhotoDeLaChaine, agentId: string): boolean {
  const org = new Organigramme(photo);
  return eligible(org, photo, agentId);
}

function eligible(org: Organigramme, photo: PhotoDeLaChaine, agentId: string): boolean {
  if (!photo.sommetId || agentId === org.dg || agentId === photo.adjointId) return false;
  const dirigee = org.dirigees.get(agentId);
  if (dirigee) return dirigee.type !== 'direction' && dirigee.parentId === photo.sommetId;
  const a = photo.agents.find((x) => x.id === agentId);
  return Boolean(a && org.estSommet(a.uniteId));
}

/** Le N+1 hiérarchique d'un agent selon l'organigramme seul, sans choix. */
function parDefaut(org: Organigramme, photo: PhotoDeLaChaine, a: AgentDeLaChaine): N1Calcule {
  if (a.id === org.dg) return { id: null, motif: 'dg' };
  const dirigee = org.dirigees.get(a.id);
  if (dirigee) {
    if (dirigee.type === 'direction') {
      return org.dg ? { id: org.dg, motif: 'tete_de_direction' } : { id: null, motif: 'sans_dg' };
    }
    const id = org.premierNiveauOccupe(dirigee.parentId, a.id);
    return { id, motif: id ? 'unite_au_dessus' : 'sans_dg' };
  }
  if (a.id === photo.adjointId) {
    return org.dg ? { id: org.dg, motif: 'dga' } : { id: null, motif: 'sans_dg' };
  }
  if (!a.uniteId || !org.unite(a.uniteId)) return { id: null, motif: 'sans_unite' };
  if (org.estSommet(a.uniteId)) {
    return org.dg ? { id: org.dg, motif: 'direction_generale' } : { id: null, motif: 'sans_dg' };
  }
  const tete = org.tete(a.uniteId);
  if (tete && tete !== a.id) return { id: tete, motif: 'tete_de_son_unite' };
  const id = org.premierNiveauOccupe(a.uniteId, a.id);
  return { id, motif: id ? 'niveau_au_dessus' : 'sans_dg' };
}

/** La chaîne remonte-t-elle de `depuis` jusqu'à `cible` ? */
function remonteJusqua(
  n1: ReadonlyMap<string, string | null>,
  depuis: string | null,
  cible: string,
): boolean {
  const vus = new Set<string>();
  let courant = depuis;
  while (courant && !vus.has(courant)) {
    if (courant === cible) return true;
    vus.add(courant);
    courant = n1.get(courant) ?? null;
  }
  return false;
}

export function calculerLaChaine(photo: PhotoDeLaChaine): ResultatDeLaChaine {
  const org = new Organigramme(photo);
  const hierarchique = new Map<string, N1Calcule>();
  for (const a of photo.agents) hierarchique.set(a.id, parDefaut(org, photo, a));

  // Les rattachements choisis, un par un, dans un ordre stable : chaque choix
  // se vérifie contre la chaîne que les précédents ont déjà faite.
  const choixCaducs: string[] = [];
  const parId = [...photo.agents].sort((x, y) => x.id.localeCompare(y.id));
  for (const a of parId) {
    if (!a.n1Dga && !a.n1UniteId) continue;
    if (!eligible(org, photo, a.id) || (a.n1UniteId && !org.unite(a.n1UniteId))) {
      choixCaducs.push(a.id);
      continue;
    }
    // Vacante, la place choisie laisse le DG reprendre : le choix reste.
    const cible = a.n1Dga ? photo.adjointId : org.tete(a.n1UniteId!);
    if (!cible || cible === a.id) continue;
    const courant = new Map([...hierarchique].map(([id, n]) => [id, n.id]));
    if (remonteJusqua(courant, cible, a.id)) {
      choixCaducs.push(a.id);
      continue;
    }
    hierarchique.set(a.id, { id: cible, motif: 'rattachement_choisi' });
  }

  // Le N+1 fonctionnel : un agent actif, apte, et pas de boucle. Le N+1
  // effectif d'un agent sans choix est son N+1 hiérarchique. Le DG n'a pas
  // de N+1, d'aucune sorte.
  const actifs = new Set(photo.agents.map((a) => a.id));
  const fonctionnelsCaducs: string[] = [];
  const effectif = new Map<string, string | null>();
  for (const a of photo.agents) effectif.set(a.id, hierarchique.get(a.id)?.id ?? null);
  for (const a of parId) {
    const f = a.n1FonctionnelId;
    if (!f) continue;
    const tient =
      a.id !== org.dg &&
      f !== a.id &&
      actifs.has(f) &&
      !photo.inaptes.has(f) &&
      !remonteJusqua(effectif, f, a.id);
    if (!tient) {
      fonctionnelsCaducs.push(a.id);
      continue;
    }
    effectif.set(a.id, f);
  }
  return { hierarchique, choixCaducs, fonctionnelsCaducs };
}
