'use client';

import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { orgUnitLabel, type OrgUnitView } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/**
 * L'organigramme, dessiné comme un organigramme.
 *
 * On le lisait jusqu'ici comme une liste à puces indentée : les directions
 * empilées les unes sous les autres, leurs départements décalés de seize
 * pixels. Une liste dit « ceci vient après cela » ; un organigramme doit dire
 * « ceci dépend de cela », et c'est une information de forme, pas d'ordre.
 *
 * Le dessin est donc un ARBRE DESCENDANT : un bloc au sommet, un trait qui
 * descend, une barre qui s'ouvre sur les enfants, un trait par enfant. Tout
 * est en CSS — pas de canevas, pas de calcul de coordonnées : chaque nœud est
 * une colonne centrée sur ses enfants, et les traits sont des bordures. La
 * structure reste donc du HTML sélectionnable, imprimable, et lisible par un
 * lecteur d'écran dans son ordre logique.
 *
 * Un tel arbre est LARGE : c'est sa nature, pas un défaut. Il se tient donc
 * dans un canevas — on le met à l'échelle, on l'attrape à la souris pour le
 * balader, et le cadre s'ouvre sur le sommet plutôt que sur le bord gauche
 * (voir `useCanevas`).
 */

/** Taille de lecture. L'arbre déborde souvent : on le balade, on ne le rapetisse pas. */
const ZOOM_DEFAUT = 0.9;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;
const PAS = 0.1;

/**
 * Une trame de points, très pâle, derrière l'arbre : elle dit « ceci est un
 * plan », pas « ceci est un formulaire », et donne au déplacement un repère
 * visuel. Le point emprunte la couleur des filets, donc il suit le thème.
 */
const FOND_CANEVAS: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(color-mix(in oklab, var(--color-line) 60%, transparent) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

export interface ActionsNoeud {
  /** Ouvrir le panneau de détail. */
  onOuvrir: (u: OrgUnitView) => void;
  /** Créer une unité rattachée à celle-ci. */
  onAjouter?: (parent: OrgUnitView) => void;
}

export function Organigramme({
  unites,
  selectionId,
  actions,
}: {
  unites: OrgUnitView[];
  selectionId: string | null;
  actions: ActionsNoeud;
}) {
  const [replies, setReplies] = useState<Set<string>>(new Set());

  const parEnfant = useMemo(() => {
    const m = new Map<string | null, OrgUnitView[]>();
    for (const u of unites) {
      const l = m.get(u.parentId) ?? [];
      l.push(u);
      m.set(u.parentId, l);
    }
    // Les directions d'abord, puis l'alphabet : l'ordre d'un organigramme ne
    // doit pas dépendre de l'ordre de saisie.
    for (const l of m.values()) {
      l.sort((a, b) => {
        const rang = (u: OrgUnitView) =>
          u.unitType === 'direction' ? 0 : u.unitType === 'department' ? 1 : 2;
        return rang(a) - rang(b) || orgUnitLabel(a).localeCompare(orgUnitLabel(b), 'fr');
      });
    }
    return m;
  }, [unites]);

  const basculer = (id: string) =>
    setReplies((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const racines = parEnfant.get(null) ?? [];
  const { cadre, arbre, taille, zoom, anime, deborde, ajustement, zoomer, poser, glisser } =
    useCanevas();

  return (
    <div className="relative">
      {/* L'arbre se déplace dans SON cadre — jamais dans la page : le reste de
          l'écran ne doit pas bouger quand on le balade. */}
      <div
        ref={cadre}
        style={FOND_CANEVAS}
        // Le bandeau du bas est RÉSERVÉ à la commande d'échelle : posée en
        // flottant sur un arbre qui descend jusqu'au bord, elle masquerait le
        // dernier bloc.
        className={cn(
          'overflow-x-auto overflow-y-hidden px-4 pt-6 pb-14',
          deborde && 'cursor-grab active:cursor-grabbing',
        )}
        {...glisser}
      >
        {/* Une cale aux dimensions de l'arbre UNE FOIS MIS À L'ÉCHELLE : une
            transformation ne change pas la boîte de mise en page, donc sans
            elle le cadre garderait la hauteur et la largeur de l'arbre à
            taille réelle — d'où un grand vide en bas et un défilement pour
            rien. `mx-auto` centre la cale quand l'arbre tient. */}
        <div
          className="relative mx-auto"
          style={
            taille
              ? { width: Math.ceil(taille.w * zoom), height: Math.ceil(taille.h * zoom) }
              : undefined
          }
        >
          <div
            ref={arbre}
            className={cn(
              'absolute top-0 left-0 flex w-max items-start gap-10 transition-opacity duration-200 ease-out',
              anime && 'transition-[transform,opacity] duration-300',
            )}
            style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', opacity: taille ? 1 : 0 }}
          >
            {racines.map((u) => (
              <Branche
                key={u.id}
                unite={u}
                parEnfant={parEnfant}
                selectionId={selectionId}
                replies={replies}
                onBasculer={basculer}
                actions={actions}
                premier
              />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-full border border-card-line bg-surface p-1 shadow-sm">
        <BoutonEchelle
          icone="remove"
          label="Réduire"
          disabled={zoom <= ZOOM_MIN + 0.001}
          onClick={() => zoomer(-PAS)}
        />
        {/* Le pourcentage est un interrupteur : il montre tout, puis rend la
            taille de lecture. Deux gestes qu'on veut à un clic, et un seul
            endroit où les chercher. */}
        <button
          type="button"
          onClick={() => poser(ajuste(zoom, ajustement) ? ZOOM_DEFAUT : ajustement)}
          title={ajuste(zoom, ajustement) ? 'Revenir à la taille de lecture' : 'Voir tout l’arbre'}
          className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums text-ink-muted transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          {Math.round(zoom * 100)} %
        </button>
        <BoutonEchelle
          icone="add"
          label="Agrandir"
          disabled={zoom >= ZOOM_MAX - 0.001}
          onClick={() => zoomer(PAS)}
        />
      </div>
    </div>
  );
}

/** L'échelle est-elle déjà celle qui montre tout l'arbre ? */
const ajuste = (zoom: number, ajustement: number) => Math.abs(zoom - ajustement) < 0.005;

function BoutonEchelle({
  icone,
  label,
  disabled,
  onClick,
}: {
  icone: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-bg hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon name={icone} size={15} />
    </button>
  );
}

/**
 * Le canevas : mesurer l'arbre, le mettre à l'échelle, le balader.
 *
 * `offsetWidth` ignore les transformations : on lit donc toujours la taille
 * NATURELLE de l'arbre, même déjà réduit — sans quoi chaque mesure mangerait
 * la précédente. L'observateur surveille les deux boîtes : le cadre parce que
 * la fenêtre change, l'arbre parce qu'on replie une branche ou qu'on ajoute
 * une unité.
 */
function useCanevas() {
  const cadre = useRef<HTMLDivElement | null>(null);
  const arbre = useRef<HTMLDivElement | null>(null);
  const [taille, setTaille] = useState<{ w: number; h: number } | null>(null);
  const [dispo, setDispo] = useState(0);
  const [zoom, setZoom] = useState(ZOOM_DEFAUT);
  const [anime, setAnime] = useState(false);

  useEffect(() => {
    const c = cadre.current;
    const a = arbre.current;
    if (!c || !a) return;
    const mesurer = () => {
      const w = a.offsetWidth;
      const h = a.offsetHeight;
      if (w === 0 || h === 0) return;
      setTaille((t) => (t && t.w === w && t.h === h ? t : { w, h }));
      // `clientWidth` comprend le rembourrage du cadre ; l'arbre n'y a pas droit.
      setDispo(c.clientWidth - 32);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(c);
    ro.observe(a);
    return () => ro.disconnect();
  }, []);

  const ajustement = taille ? Math.min(1, Math.max(ZOOM_MIN, dispo / taille.w)) : 1;
  const deborde = taille !== null && taille.w * zoom > dispo + 1;

  // Le cadre s'ouvre sur le MILIEU de l'arbre, là où se tient le sommet. Sans
  // cela il s'ouvrait sur le bord gauche : une colonne de blocs sans racine
  // visible, c'est-à-dire sans hiérarchie lisible. Une seule fois : on ne
  // reprend pas la main sur un déplacement que l'utilisateur a fait sien.
  //
  // Le débordement se CALCULE au lieu de se lire dans `scrollWidth` : l'arbre
  // est posé en absolu, et tant que la mise à l'échelle n'est pas appliquée le
  // navigateur compte encore sa largeur d'origine.
  const centre = useRef(false);
  useEffect(() => {
    const c = cadre.current;
    if (!c || taille === null || centre.current) return;
    centre.current = true;
    const debord = taille.w * zoom + 32 - c.clientWidth;
    if (debord > 0) c.scrollLeft = debord / 2;
    // Les transitions n'entrent en service qu'après ce premier accord : on
    // veut voir l'arbre à sa bonne taille, pas le voir s'y rendre.
    requestAnimationFrame(() => setAnime(true));
  }, [taille, zoom]);

  /**
   * Attraper l'arbre et le tirer, comme une carte.
   *
   * À la souris seulement : au doigt, le défilement natif fait déjà mieux que
   * tout ce qu'on écrirait, et lui voler ses événements le saccaderait. Un
   * glissement de plus de quatre pixels AVALE le clic qui suit — sans quoi
   * déplacer l'arbre ouvrirait le bloc qu'on a pris comme poignée.
   */
  const prise = useRef<{ x: number; scroll: number } | null>(null);
  const glisse = useRef(false);
  const glisser = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !cadre.current) return;
      prise.current = { x: e.clientX, scroll: cadre.current.scrollLeft };
      glisse.current = false;
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const p = prise.current;
      const c = cadre.current;
      if (!p || !c) return;
      const dx = e.clientX - p.x;
      if (!glisse.current) {
        if (Math.abs(dx) < 4) return;
        glisse.current = true;
        c.setPointerCapture(e.pointerId);
      }
      c.scrollLeft = p.scroll - dx;
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (glisse.current) cadre.current?.releasePointerCapture(e.pointerId);
      prise.current = null;
    },
    onPointerCancel: () => {
      prise.current = null;
      glisse.current = false;
    },
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!glisse.current) return;
      glisse.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  return {
    cadre,
    arbre,
    taille,
    zoom,
    anime,
    deborde,
    ajustement,
    glisser,
    poser: (z: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))),
    zoomer: (pas: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + pas))),
  };
}

/**
 * Une branche : le bloc, puis ses enfants sous une barre de liaison.
 *
 * Les traits sont posés par des boîtes vides plutôt que par un SVG : ils
 * suivent alors la mise en page sans qu'on ait à mesurer quoi que ce soit, y
 * compris quand un nom passe sur trois lignes.
 */
function Branche({
  unite,
  parEnfant,
  selectionId,
  replies,
  onBasculer,
  actions,
  premier = false,
}: {
  unite: OrgUnitView;
  parEnfant: Map<string | null, OrgUnitView[]>;
  selectionId: string | null;
  replies: Set<string>;
  onBasculer: (id: string) => void;
  actions: ActionsNoeud;
  premier?: boolean;
}) {
  const enfants = parEnfant.get(unite.id) ?? [];
  const replie = replies.has(unite.id);
  const descendants = compterDescendants(parEnfant, unite.id);

  return (
    <div className="flex flex-col items-center">
      <Bloc
        unite={unite}
        racine={premier}
        selectionne={selectionId === unite.id}
        replie={replie}
        descendants={descendants}
        onBasculer={enfants.length > 0 ? () => onBasculer(unite.id) : undefined}
        actions={actions}
      />

      {enfants.length > 0 && !replie ? (
        <>
          {/* Descente du bloc vers la barre des enfants. */}
          <span aria-hidden className="h-7 w-px bg-line" />
          <div className="flex items-start">
            {enfants.map((e, i) => (
              <div key={e.id} className="relative flex flex-col items-center px-3 pt-7">
                <Connecteur premier={i === 0} dernier={i === enfants.length - 1} />
                <Branche
                  unite={e}
                  parEnfant={parEnfant}
                  selectionId={selectionId}
                  replies={replies}
                  onBasculer={onBasculer}
                  actions={actions}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Le raccord entre la barre du parent et un enfant : demi-barre, coude, chute.
 *
 * Deux boîtes vides posées en ABSOLU sur la colonne, dessinées par leurs
 * bordures. En absolu parce que la barre doit courir jusqu'au bord de la
 * colonne, rembourrage compris, pour rejoindre celle de la voisine — mesurée
 * dans le flux, elle s'arrêtait au bord du CONTENU et laissait un trou de
 * vingt-quatre pixels entre chaque enfant.
 *
 * Par les bordures, et non par des filets d'un pixel, parce qu'une bordure se
 * ceinture : aux deux extrémités de la fratrie, le virage se prend en ARRONDI
 * — c'est la différence entre un schéma et un dessin.
 */
function Connecteur({ premier, dernier }: { premier: boolean; dernier: boolean }) {
  const seul = premier && dernier;
  return (
    <>
      {/* Moitié gauche : la barre qui vient de la sœur précédente, et — pour
          la dernière de la fratrie — le coude qui plonge vers le bloc. Un
          pixel de plus en largeur pour que cette chute tombe exactement dans
          la même colonne de pixels que celle des autres enfants. */}
      {!premier ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-0 left-0 h-7 border-t border-line',
            dernier ? 'w-[calc(50%+1px)] rounded-tr-[12px] border-r' : 'w-1/2',
          )}
        />
      ) : null}
      {/* Moitié droite : la chute vers le bloc, et la barre qui part vers la
          sœur suivante. */}
      {!dernier || seul ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-0 right-0 h-7 w-1/2 border-l border-line',
            !seul && 'border-t',
            premier && !seul && 'rounded-tl-[12px]',
          )}
        />
      ) : null}
    </>
  );
}

/** Le bloc d'une unité : ce qu'on lit, et ce qu'on peut en faire. */
function Bloc({
  unite: u,
  racine,
  selectionne,
  replie,
  descendants,
  onBasculer,
  actions,
}: {
  unite: OrgUnitView;
  racine: boolean;
  selectionne: boolean;
  replie: boolean;
  descendants: number;
  onBasculer?: () => void;
  actions: ActionsNoeud;
}) {
  const direction = u.unitType === 'direction';
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => actions.onOuvrir(u)}
        // Le gabarit coupe les noms à rallonge et les responsables aux
        // prénoms multiples : l'infobulle rend l'un et l'autre en entier, et
        // la fenêtre de détail aussi.
        title={`${u.name}\nResponsable : ${u.managerName ?? 'Non désigné'}`}
        className={cn(
          // Largeur ET hauteur fixes, celles qu'il faut à un nom de deux
          // lignes. Une carte qui s'ajuste à son nom donne une rangée de
          // vignettes dépareillées ; un gabarit unique donne un organigramme.
          // La largeur est MESURÉE, pas devinée : à deux cent trente pixels,
          // « Direction des Passations de Marchés » passe à la ligne après
          // « Passations » — la référence donnée. Les deux ou trois noms qui
          // demanderaient une troisième ligne s'arrêtent à la deuxième ;
          // l'infobulle et la fenêtre de détail les rendent en entier.
          'flex h-[76px] w-[230px] items-center gap-2.5 rounded-[14px] border px-3.5 text-left transition-all duration-200',
          'hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
          // Le sommet se distingue sans crier : un fond teinté suffit à dire
          // « tout part d'ici » là où une couleur pleine écraserait le reste.
          // Un fond OPAQUE, mélangé et non transparent : posé sur la trame de
          // points, un aplat translucide laisserait les points traverser le
          // bloc.
          racine
            ? 'border-primary/25 bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-surface))]'
            : 'bg-surface',
          selectionne
            ? 'border-primary ring-1 ring-primary/25'
            : racine
              ? 'hover:border-primary/45'
              : 'border-card-line hover:border-card-line-hover',
        )}
      >
        {/* Le type se lit à la couleur de la pastille avant de se lire dans
            le nom : sur trente blocs, l'œil trie par étage. Le dire EN PLUS
            en toutes lettres — « Direction », « Département » — répétait ce
            que le nom de l'unité annonce déjà. */}
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
            direction ? 'bg-primary/[0.10] text-primary' : 'bg-bg text-ink-muted',
          )}
        >
          <Icon name={direction ? 'family_history' : 'group'} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {/* Deux lignes au plus : au-delà, le nom complet reste à portée par
              l'infobulle du bloc et par la fenêtre de détail. Mieux vaut une
              rangée droite qu'un nom entier qui déforme sa carte. */}
          <span className="line-clamp-2 text-[12.5px] leading-[1.28] font-bold text-ink-strong">
            {u.name}
          </span>
          <span className="block truncate text-[11.5px] leading-tight text-ink-muted">
            Responsable&nbsp;:{' '}
            {u.managerName ? (
              // Abrégé : « Mouhamadou Moustapha Salih Niang » ne tient pas
              // dans un bloc, et c'est le NOM DE FAMILLE qu'on y perdrait.
              <span className="font-semibold text-ink">{u.managerShortName ?? u.managerName}</span>
            ) : (
              <span className="text-ink-muted/70">Non désigné</span>
            )}
          </span>
        </span>
      </button>

      {/* Les commandes n'apparaissent qu'au survol du bloc : trente croix
          permanentes feraient un écran de boutons, pas un organigramme. */}
      {actions.onAjouter ? (
        <button
          type="button"
          onClick={() => actions.onAjouter?.(u)}
          aria-label={`Rattacher une unité à ${u.name}`}
          title="Rattacher une unité"
          className={cn(
            'absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-card-line bg-surface text-ink-muted shadow-sm transition-all',
            'hover:border-primary/40 hover:bg-primary hover:text-primary-ink',
            'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
          )}
        >
          <Icon name="add" size={14} />
        </button>
      ) : null}

      {/* Replier une branche : le compte prend la place du sous-arbre, pour
          qu'on sache ce qu'on a caché. */}
      {onBasculer ? (
        <button
          type="button"
          onClick={onBasculer}
          aria-expanded={!replie}
          aria-label={replie ? `Déplier ${u.name}` : `Replier ${u.name}`}
          className={cn(
            'absolute -bottom-2.5 left-1/2 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border border-card-line bg-surface px-1.5 text-[10px] font-bold text-ink-muted transition-colors',
            'hover:border-primary/40 hover:text-primary',
            'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
          )}
        >
          <Icon name={replie ? 'add' : 'remove'} size={12} />
          {replie ? descendants : null}
        </button>
      ) : null}
    </div>
  );
}

/** Tout ce qui pend sous une unité, à tous les étages. */
function compterDescendants(parEnfant: Map<string | null, OrgUnitView[]>, id: string): number {
  const enfants = parEnfant.get(id) ?? [];
  return enfants.reduce((n, e) => n + 1 + compterDescendants(parEnfant, e.id), 0);
}
