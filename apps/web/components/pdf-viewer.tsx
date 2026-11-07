'use client';

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/**
 * La finesse de peinture : combien de pixels de toile par pixel d'écran.
 *
 * Jamais moins de 2, même sur un écran ordinaire : la page peinte au double
 * puis réduite par le navigateur donne un texte net et lisse, là où une
 * peinture au pixel près le laisse maigre et crénelé. Jusqu'à 4 sur les écrans
 * très denses. Plafonnée à 16,7 millions de pixels par page, la limite que
 * pdf.js s'impose lui-même : au-delà, une page géante zoomée épuiserait la
 * mémoire du navigateur.
 */
function finesseDe(largeur: number, hauteur: number): number {
  const ecran = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  let f = Math.min(4, Math.max(2, ecran));
  while (f > 1 && largeur * hauteur * f * f > 16_777_216) f -= 0.25;
  return f;
}

/**
 * Ouvre un PDF en mémoire avec pdf.js, servi par nous : rend la tâche de
 * chargement, la seule qui sache interrompre le worker et les requêtes en vol.
 */
async function ouvrir(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  // Le worker est servi par nous : webpack l'émet dans nos assets à la
  // compilation, il n'est jamais chargé depuis un CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  // pdf.js prend la propriété du tampon : on lui en donne une copie,
  // sinon rouvrir le même document une seconde fois trouve un tampon
  // « détaché » et échoue.
  // Un PDF vient parfois du public (un CV) : rien de lui ne s'exécute.
  return pdfjs.getDocument({ data: data.slice(0), isEvalSupported: false, enableXfa: false });
}

/** Les dimensions de chaque page à l'échelle 1, lues une fois à l'ouverture. */
async function taillesDes(pdf: PDFDocumentProxy) {
  const tailles: { width: number; height: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const vue = (await pdf.getPage(i)).getViewport({ scale: 1 });
    tailles.push({ width: vue.width, height: vue.height });
  }
  return tailles;
}

/** La taille d'une page à l'écran, en pixels ENTIERS : voir `Peintre`. */
function tailleAffichee(p: { width: number; height: number }, zoom: number) {
  return { width: Math.round(p.width * zoom), height: Math.round(p.height * zoom) };
}

/** Une page à peindre : sa taille à l'écran, en pixels CSS. */
interface Cible {
  width: number;
  height: number;
}

/**
 * Au-delà de ce nombre de pixels peints (une centaine de mégaoctets), les
 * pages les plus éloignées de l'écran rendent leur toile.
 */
const BUDGET_DE_PIXELS = 24_000_000;

/** Retire la toile d'un cadre et rend sa mémoire tout de suite. */
function viderLeCadre(cadre: HTMLElement) {
  for (const enfant of [...cadre.children]) {
    if (enfant instanceof HTMLCanvasElement) {
      enfant.width = 0;
      enfant.height = 0;
    }
  }
  cadre.replaceChildren();
}

/** La toile posée dans un cadre, s'il y en a une. */
function toileDu(cadre: HTMLElement | null | undefined): HTMLCanvasElement | null {
  const t = cadre?.firstElementChild;
  return t instanceof HTMLCanvasElement ? t : null;
}

/**
 * Le peintre des pages, commun aux deux lecteurs.
 *
 * pdf.js peint sur le fil principal, celui qui fait aussi défiler l'écran.
 * Le peintre ne peint donc qu'une page à la fois, la plus proche de l'écran
 * d'abord : deux pages peintes ensemble se disputaient chaque image du
 * défilement, et le défilement saccadait.
 *
 * Chaque page se peint dans une toile à part, qui ne prend la place de
 * l'ancienne qu'une fois finie : on ne voit jamais une page se dessiner par
 * bandes, ni une page blanche le temps d'un zoom ou d'un nouvel aperçu.
 * L'ancienne image, étirée à la nouvelle taille, tient la place jusque-là.
 *
 * Les cadres appartiennent à React, les toiles au peintre : React rend des
 * cadres vides et n'y touche plus. Une toile porte ce qu'elle montre (le
 * document et la taille) : un cadre que React rattache ne se repeint pas.
 */
class Peintre {
  private pdf: PDFDocumentProxy | null = null;
  /** Change avec le document : une toile d'un autre document est à repeindre. */
  private generation = 0;
  private readonly cadres: (HTMLElement | null)[] = [];
  private cibles: (Cible | null)[] = [];
  private enCours: { index: number; cle: string; tache: RenderTask | null } | null = null;
  /** Les pages que pdf.js n'a pas su peindre, à cette taille : on ne les retente pas. */
  private readonly ratees = new Set<string>();
  private plan = 0;
  private actif = true;

  constructor(
    private readonly regles: {
      /** Les pages à peindre maintenant, de la plus urgente à la moins urgente. */
      ordre: (aPeindre: number[]) => number[];
      /** La distance d'une page à l'écran, pour libérer d'abord les plus lointaines. */
      distance?: (index: number) => number;
    },
  ) {}

  /** Monté (de nouveau, en développement) : le peintre reprend. */
  activer() {
    this.actif = true;
    this.planifier();
  }

  detruire() {
    this.actif = false;
    window.clearTimeout(this.plan);
    this.plan = 0;
    this.abandonner();
  }

  /** Un autre document : toutes ses pages sont à peindre. Les toiles restent jusque-là. */
  changerDeDocument(pdf: PDFDocumentProxy | null) {
    this.abandonner();
    this.pdf = pdf;
    this.generation += 1;
    this.planifier();
  }

  poserLeCadre(index: number, cadre: HTMLElement | null) {
    this.cadres[index] = cadre;
    if (cadre) this.planifier();
  }

  viser(cibles: (Cible | null)[]) {
    this.cibles = cibles;
    // La page en cours, visée à une autre taille, ne sert plus.
    const e = this.enCours;
    if (e && this.cleDe(cibles[e.index]) !== e.cle) this.abandonner();
    this.planifier();
  }

  /** Revoir l'ordre de passage : l'écran a bougé. */
  planifier() {
    if (!this.actif || this.plan) return;
    this.plan = window.setTimeout(() => {
      this.plan = 0;
      void this.suivante();
    }, 0);
  }

  /** Retire toutes les toiles : un autre document ne montre pas les pages du précédent. */
  effacer() {
    for (const cadre of this.cadres) if (cadre) viderLeCadre(cadre);
  }

  private cleDe(c: Cible | null | undefined): string {
    return c ? `${this.generation}:${c.width}×${c.height}` : '';
  }

  private abandonner() {
    this.enCours?.tache?.cancel();
    this.enCours = null;
  }

  private async suivante() {
    const pdf = this.pdf;
    if (!pdf || !this.actif) return;
    const aPeindre: number[] = [];
    this.cibles.forEach((c, i) => {
      const cadre = this.cadres[i];
      const cle = this.cleDe(c);
      if (c && c.width > 0 && cadre && toileDu(cadre)?.dataset.cle !== cle) {
        if (!this.ratees.has(`${i}@${cle}`)) aPeindre.push(i);
      }
    });
    const file = this.regles.ordre(aPeindre);
    if (this.enCours) {
      // Encore attendue, elle finit ; éloignée de l'écran, elle cède la place.
      if (file.includes(this.enCours.index)) return;
      this.abandonner();
    }
    const index = file[0];
    const cible = index === undefined ? null : this.cibles[index];
    if (index === undefined || !cible) {
      this.liberer();
      return;
    }
    const jeton: { index: number; cle: string; tache: RenderTask | null } = {
      index,
      cle: this.cleDe(cible),
      tache: null,
    };
    this.enCours = jeton;
    let toile: HTMLCanvasElement | null = null;
    try {
      const page = await pdf.getPage(index + 1);
      if (this.enCours !== jeton) return;
      const base = page.getViewport({ scale: 1 });
      // La toile a EXACTEMENT la taille du cadre, multipliée par la finesse :
      // une toile plus petite d'une fraction de pixel, étirée pour tenir,
      // suffisait à flouter tout le texte de la page.
      const finesse = finesseDe(cible.width, cible.height);
      toile = document.createElement('canvas');
      toile.width = Math.round(cible.width * finesse);
      toile.height = Math.round(cible.height * finesse);
      toile.dataset.cle = jeton.cle;
      toile.style.cssText = 'display:block;width:100%;height:100%';
      // Opaque : une page est une feuille blanche, rien à mélanger dessous.
      const ctx = toile.getContext('2d', { alpha: false });
      if (!ctx) {
        this.ratees.add(`${index}@${jeton.cle}`);
        return;
      }
      jeton.tache = page.render({
        canvasContext: ctx,
        viewport: page.getViewport({ scale: toile.width / base.width }),
      });
      await jeton.tache.promise;
      const cadre = this.cadres[index];
      if (this.enCours !== jeton || this.pdf !== pdf || !cadre) return;
      viderLeCadre(cadre);
      cadre.append(toile);
      toile = null;
    } catch (e) {
      // Abandonnée, ou le document s'est refermé : rien à poser. Une page que
      // pdf.js ne sait pas peindre reste blanche, sans être retentée en boucle.
      const abandon = e instanceof Error && e.name === 'RenderingCancelledException';
      if (this.enCours === jeton && !abandon) this.ratees.add(`${index}@${jeton.cle}`);
    } finally {
      if (toile) {
        toile.width = 0;
        toile.height = 0;
      }
      if (this.enCours === jeton) this.enCours = null;
      this.planifier();
    }
  }

  /** Les pages les plus éloignées rendent leur toile quand le budget est dépassé. */
  private liberer() {
    const distance = this.regles.distance;
    if (!distance) return;
    const peintes: { i: number; cadre: HTMLElement; pixels: number }[] = [];
    this.cadres.forEach((cadre, i) => {
      const toile = toileDu(cadre);
      if (cadre && toile) peintes.push({ i, cadre, pixels: toile.width * toile.height });
    });
    let total = peintes.reduce((s, p) => s + p.pixels, 0);
    if (total <= BUDGET_DE_PIXELS) return;
    peintes.sort((a, b) => distance(b.i) - distance(a.i));
    for (const p of peintes) {
      // Ce qui est à l'écran, ou tout près, se garde quoi qu'il arrive.
      if (total <= BUDGET_DE_PIXELS || distance(p.i) <= 0) break;
      total -= p.pixels;
      viderLeCadre(p.cadre);
    }
  }
}

/** L'écart entre deux pages, et au-dessus de la première (`gap-3`, `py-3`). */
const ECART = 12;

/**
 * Le lecteur de PDF du produit.
 *
 * Une iframe sur un PDF affiche le lecteur du NAVIGATEUR : une barre noire,
 * des icônes qui ne sont pas les nôtres, et pour titre l'identifiant interne
 * du blob (« 7e5b1110-de38-49e6… ») au lieu du nom du fichier. Le document
 * d'un candidat méritait mieux que ça, et surtout : ce cadre change d'un
 * navigateur à l'autre, on ne peut ni le styler ni le prévoir.
 *
 * On rend donc les pages nous-mêmes, avec pdf.js (le moteur que Firefox
 * utilise pour la même tâche), servi depuis nos propres fichiers : aucune
 * requête vers un tiers à l'exécution, comme pour les polices et les icônes.
 *
 * Le défilement est continu et le rendu PARESSEUX : seules les pages à moins
 * d'un écran de la partie visible se peignent, les autres n'occupent qu'un
 * cadre à leurs dimensions. Un mémoire de 200 pages s'ouvre donc aussi vite
 * qu'un CV d'une page.
 *
 * Pendant le défilement, le lecteur ne mesure rien et ne déplace rien : le
 * numéro de page se calcule à partir de la position, et le calage au pixel
 * attend que le défilement s'arrête.
 */
export function PdfViewer({
  data,
  titre,
  onError,
  zoomPlafond = 2,
}: {
  /** Le PDF déjà en mémoire : c'est l'appelant qui l'a récupéré avec la session. */
  data: ArrayBuffer;
  /**
   * Ce que la pièce EST, « Curriculum Vitæ », pas le nom que le fichier
   * porte. Omis quand la coquille qui entoure le lecteur la nomme déjà : la
   * barre n'est alors plus qu'un poste de pilotage.
   */
  titre?: string;
  onError?: () => void;
  /**
   * Le zoom de départ suit la largeur du lecteur, sans dépasser ce plafond :
   * dans un lecteur très large, une A4 ajustée à la largeur ne laissait voir
   * que son en-tête.
   */
  zoomPlafond?: number;
}) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [prete, setPrete] = useState(false);
  const [echouee, setEchouee] = useState(false);

  const zone = useRef<HTMLDivElement>(null);
  const feuillet = useRef<HTMLDivElement>(null);
  /** Largeur d'une page à l'échelle 1 : sert à ajuster le zoom à la fenêtre. */
  const largeurBase = useRef(1);

  // Où commence chaque page dans la zone qui défile, et sa hauteur : tout se
  // calcule d'ici, sans lire la position des pages à l'écran.
  const cibles = useMemo(() => pages.map((p) => tailleAffichee(p, zoom)), [pages, zoom]);
  const debuts = useMemo(() => {
    const d: number[] = [];
    let y = ECART;
    for (const c of cibles) {
      d.push(y);
      y += c.height + ECART;
    }
    return d;
  }, [cibles]);
  const geometrie = useRef({ debuts, cibles });
  useLayoutEffect(() => {
    geometrie.current = { debuts, cibles };
  }, [debuts, cibles]);

  const [peintre] = useState(
    () =>
      new Peintre({
        // Les pages à moins d'un écran de ce qu'on voit, la plus proche du
        // milieu d'abord.
        ordre: (aPeindre) => {
          const z = zone.current;
          if (!z) return [];
          const { debuts: d, cibles: c } = geometrie.current;
          const haut = z.scrollTop;
          const bas = haut + z.clientHeight;
          const milieu = (haut + bas) / 2;
          const centre = (i: number) => (d[i] ?? 0) + (c[i]?.height ?? 0) / 2;
          return aPeindre
            .filter((i) => {
              const debut = d[i] ?? 0;
              const fin = debut + (c[i]?.height ?? 0);
              return fin >= haut - z.clientHeight && debut <= bas + z.clientHeight;
            })
            .sort((a, b) => Math.abs(centre(a) - milieu) - Math.abs(centre(b) - milieu));
        },
        // Hors de l'écran et de ses abords, en pixels : 0 pour ce qu'on garde.
        distance: (i) => {
          const z = zone.current;
          if (!z) return 0;
          const { debuts: d, cibles: c } = geometrie.current;
          const haut = z.scrollTop - z.clientHeight;
          const bas = z.scrollTop + 2 * z.clientHeight;
          const debut = d[i] ?? 0;
          const fin = debut + (c[i]?.height ?? 0);
          return Math.max(0, haut - fin, debut - bas);
        },
      }),
  );

  useEffect(() => {
    peintre.activer();
    return () => peintre.detruire();
  }, [peintre]);

  // ---- Chargement du document -------------------------------------------
  useEffect(() => {
    let annule = false;
    // C'est la TÂCHE DE CHARGEMENT qui se défait, pas le document : elle seule
    // sait interrompre le worker et les requêtes en vol.
    let tache: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        const chargement = await ouvrir(data);
        tache = chargement;
        const pdf = await chargement.promise;
        if (annule) return;
        const tailles = await taillesDes(pdf);
        if (annule) return;
        largeurBase.current = tailles[0]?.width ?? 1;
        peintre.changerDeDocument(pdf);
        setPages(tailles);
        setPrete(true);
      } catch {
        if (!annule) {
          setEchouee(true);
          onError?.();
        }
      }
    })();

    return () => {
      annule = true;
      peintre.changerDeDocument(null);
      peintre.effacer();
      void tache?.destroy();
    };
    // `onError` est une closure de l'appelant : la suivre relancerait le
    // chargement à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, peintre]);

  // ---- Zoom initial : la page tient dans la largeur ----------------------
  useEffect(() => {
    if (!prete || !zone.current) return;
    const dispo = zone.current.clientWidth - 32;
    if (dispo > 0 && largeurBase.current > 0) {
      setZoom(Math.min(zoomPlafond, Math.max(0.4, dispo / largeurBase.current)));
    }
  }, [prete, zoomPlafond]);

  // ---- Ce qu'il faut peindre, à quelle taille ----------------------------
  // Au zoom, les pages gardent leur image, étirée, jusqu'à la nouvelle.
  useEffect(() => {
    peintre.viser(cibles);
  }, [peintre, cibles]);

  // ---- Le défilement : le numéro de page, et les pages qui approchent ----
  useEffect(() => {
    const el = zone.current;
    if (!el || !prete) return;
    let brut = 0;
    const suivre = () => {
      peintre.planifier();
      if (brut) return;
      brut = requestAnimationFrame(() => {
        brut = 0;
        // La page courante : la première dont le bas passe sous le haut de
        // la zone, à 80 pixels près.
        const { debuts: d, cibles: c } = geometrie.current;
        const haut = el.scrollTop + 80;
        let i = 0;
        while (i < d.length - 1 && (d[i] ?? 0) + (c[i]?.height ?? 0) <= haut) i += 1;
        setPage(i + 1);
      });
    };
    el.addEventListener('scroll', suivre, { passive: true });
    window.addEventListener('resize', suivre);
    return () => {
      cancelAnimationFrame(brut);
      el.removeEventListener('scroll', suivre);
      window.removeEventListener('resize', suivre);
    };
  }, [prete, peintre]);

  // ---- Les pages calées sur les pixels de l'écran -------------------------
  //
  // Une fenêtre centrée tombe volontiers à un demi-pixel près (y = 188,625) :
  // le navigateur rééchantillonne alors les pages pour les poser entre deux
  // pixels, et le texte perd sa netteté. On décale les pages de la fraction
  // qui dépasse : jamais plus d'un pixel, invisible à l'œil, décisif pour le
  // trait. Recalé après l'animation d'ouverture, au redimensionnement, et une
  // fois le défilement arrêté, jamais pendant : un calage à chaque image
  // arrivait en retard sur le défilement et faisait trembler le texte.
  useLayoutEffect(() => {
    const el = feuillet.current;
    const z = zone.current;
    if (!prete || !el || !z) return;
    let dx = 0;
    let dy = 0;
    const caler = () => {
      const r = el.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      // La position sans le décalage déjà posé.
      const fx = ((((r.left - dx) * d) % 1) + 1) % 1;
      const fy = ((((r.top - dy) * d) % 1) + 1) % 1;
      const nx = fx > 0.001 ? -fx / d : 0;
      const ny = fy > 0.001 ? -fy / d : 0;
      if (Math.abs(nx - dx) < 0.0001 && Math.abs(ny - dy) < 0.0001) return;
      dx = nx;
      dy = ny;
      el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
    };
    let arret = 0;
    const plusTard = () => {
      window.clearTimeout(arret);
      arret = window.setTimeout(caler, 150);
    };
    el.style.transform = '';
    caler();
    const apresOuverture = window.setTimeout(caler, 320);
    window.addEventListener('resize', plusTard);
    z.addEventListener('scroll', plusTard, { passive: true });
    return () => {
      window.clearTimeout(apresOuverture);
      window.clearTimeout(arret);
      window.removeEventListener('resize', plusTard);
      z.removeEventListener('scroll', plusTard);
    };
  }, [prete, zoom]);

  const allerA = (n: number) => {
    const debut = debuts[n - 1];
    if (debut !== undefined && zone.current) {
      zone.current.scrollTo({ top: debut - ECART, behavior: 'smooth' });
    }
  };

  if (echouee) {
    return (
      <div className="flex h-full items-center justify-center bg-bg px-6 text-center">
        <p className="text-[13px] text-danger">Impossible d&apos;afficher ce document.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft bg-surface px-3 py-2">
        {titre ? (
          <p className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-strong">{titre}</p>
        ) : (
          <span className="flex-1" />
        )}

        <div className="flex items-center gap-0.5">
          <Commande
            label="Page précédente"
            icon="chevron_left"
            disabled={page <= 1}
            onClick={() => allerA(page - 1)}
          />
          <span
            className="min-w-[54px] text-center text-[11.5px] font-semibold text-ink-muted"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {prete ? `${page} / ${pages.length}` : '·'}
          </span>
          <Commande
            label="Page suivante"
            icon="chevron_right"
            disabled={page >= pages.length}
            onClick={() => allerA(page + 1)}
          />
        </div>

        <span className="mx-1 h-4 w-px bg-line-soft" />

        <div className="flex items-center gap-0.5">
          <Commande
            label="Réduire"
            icon="remove"
            disabled={zoom <= 0.4}
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100))}
          />
          <span
            className="min-w-[46px] text-center text-[11.5px] font-semibold text-ink-muted"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(zoom * 100)} %
          </span>
          <Commande
            label="Agrandir"
            icon="add"
            disabled={zoom >= 3}
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.15) * 100) / 100))}
          />
        </div>
      </div>

      {/* Un fond opaque : le navigateur peut alors faire défiler la zone à
          part, sans repasser par la page, même sur un écran ordinaire. */}
      <div ref={zone} className="flex-1 overflow-auto overscroll-contain bg-bg px-4 py-3">
        {!prete ? (
          <div className="flex h-full items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        ) : (
          <div ref={feuillet} className="mx-auto flex w-fit flex-col gap-3">
            {cibles.map((c, i) => (
              <div
                key={i}
                data-page={i}
                ref={(el) => peintre.poserLeCadre(i, el)}
                // Le cadre porte les dimensions AVANT peinture : sans cela, la
                // hauteur du document changerait à chaque page peinte et le
                // défilement sauterait sous le doigt. Chaque page est isolée :
                // poser sa toile ne remet pas le reste en page.
                style={{ width: c.width, height: c.height, contain: 'strict' }}
                className="overflow-hidden rounded-[6px] bg-white shadow-[0_1px_3px_rgb(16_24_40/0.12),0_1px_2px_rgb(16_24_40/0.08)]"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Commande({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'chevron_left' | 'chevron_right' | 'add' | 'remove';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors',
        'hover:bg-primary/[0.08] hover:text-primary',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/**
 * Le PDF à la largeur de son conteneur, page après page, sans barre ni zoom :
 * le document se lit comme une page de l'application, à la manière du
 * procès-verbal d'apix-e-voting. Chaque page est une feuille blanche aux coins
 * d'une carte ; la page défile avec l'écran, pas dans un cadre.
 *
 * Un nouvel aperçu (une saisie validée) ou une nouvelle largeur ne blanchit
 * rien : chaque page garde son image jusqu'à ce que la nouvelle soit prête.
 */
export function PdfEnLargeur({ data, titre }: { data: ArrayBuffer; titre: string }) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [echouee, setEchouee] = useState(false);
  const [largeur, setLargeur] = useState(0);
  const conteneur = useRef<HTMLDivElement>(null);
  const cadres = useRef<(HTMLDivElement | null)[]>([]);

  const [peintre] = useState(
    () =>
      new Peintre({
        // Toutes les pages, la plus proche de l'écran d'abord.
        ordre: (aPeindre) => {
          const milieu = window.innerHeight / 2;
          const ecart = (i: number) => {
            const r = cadres.current[i]?.getBoundingClientRect();
            return r ? Math.abs(r.top + r.height / 2 - milieu) : Infinity;
          };
          return aPeindre
            .map((i) => ({ i, e: ecart(i) }))
            .sort((a, b) => a.e - b.e)
            .map((x) => x.i);
        },
      }),
  );

  useEffect(() => {
    peintre.activer();
    return () => peintre.detruire();
  }, [peintre]);

  useEffect(() => {
    let annule = false;
    let tache: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const chargement = await ouvrir(data);
        tache = chargement;
        const pdf = await chargement.promise;
        if (annule) return;
        const tailles = await taillesDes(pdf);
        if (annule) return;
        peintre.changerDeDocument(pdf);
        setPages(tailles);
      } catch {
        if (!annule) setEchouee(true);
      }
    })();
    return () => {
      annule = true;
      // Les pages du précédent aperçu restent affichées jusqu'aux nouvelles.
      peintre.changerDeDocument(null);
      void tache?.destroy();
    };
  }, [data, peintre]);

  // La largeur suit celle de l'écran. La première tout de suite ; ensuite,
  // une fois le redimensionnement posé : repeindre à chaque pixel occupait
  // le fil principal pour des images aussitôt jetées.
  useLayoutEffect(() => {
    const el = conteneur.current;
    if (!el) return;
    let attente = 0;
    let connue = 0;
    const obs = new ResizeObserver(([e]) => {
      if (!e) return;
      const l = Math.round(e.contentRect.width);
      window.clearTimeout(attente);
      if (connue === 0) {
        connue = l;
        setLargeur(l);
        return;
      }
      attente = window.setTimeout(() => {
        connue = l;
        setLargeur(l);
      }, 150);
    });
    obs.observe(el);
    return () => {
      window.clearTimeout(attente);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    if (largeur === 0) return;
    peintre.viser(pages.map((p) => ({ width: largeur, height: (largeur * p.height) / p.width })));
  }, [peintre, pages, largeur]);

  if (echouee) {
    return (
      <div className="rounded-bloc bg-surface px-6 py-16 text-center shadow-xs ring-1 ring-card-line">
        <p className="text-[13px] text-danger">Impossible d&apos;afficher ce document.</p>
      </div>
    );
  }

  return (
    <div ref={conteneur} role="img" aria-label={titre} className="flex flex-col gap-4">
      {/* Avant que pdf.js ne connaisse les pages, une feuille A4 blanche tient
          la place : rien ne saute quand le document arrive. */}
      {(pages.length > 0 ? pages : [{ width: 595.28, height: 841.89 }]).map((p, i) => (
        <div
          key={i}
          ref={(el) => {
            cadres.current[i] = el;
            if (pages.length > 0) peintre.poserLeCadre(i, el);
          }}
          style={{ aspectRatio: `${p.width} / ${p.height}`, contain: 'layout paint' }}
          className="overflow-hidden rounded-bloc bg-white shadow-xs ring-1 ring-card-line"
        />
      ))}
    </div>
  );
}
