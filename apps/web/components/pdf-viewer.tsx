'use client';

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/**
 * La finesse de peinture : combien de pixels de toile par pixel d'écran.
 *
 * Jamais moins de 2, même sur un écran ordinaire : la page peinte au double
 * puis réduite par le navigateur donne un texte net et lisse, là où une
 * peinture au pixel près le laisse maigre et crénelé. Jusqu'à 4 sur les écrans
 * très denses. Plafonnée à 16,7 millions de pixels par page — la limite que
 * pdf.js s'impose lui-même —, au-delà de laquelle une page géante zoomée
 * épuiserait la mémoire du navigateur.
 */
function finesseDe(largeur: number, hauteur: number): number {
  const ecran = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  let f = Math.min(4, Math.max(2, ecran));
  while (f > 1 && largeur * hauteur * f * f > 16_777_216) f -= 0.25;
  return f;
}

/** La taille d'une page à l'écran, en pixels ENTIERS — voir `peindre`. */
function tailleAffichee(p: { width: number; height: number }, zoom: number) {
  return { width: Math.round(p.width * zoom), height: Math.round(p.height * zoom) };
}

/**
 * Le lecteur de PDF du produit.
 *
 * Une iframe sur un PDF affiche le lecteur du NAVIGATEUR : une barre noire,
 * des icônes qui ne sont pas les nôtres, et pour titre l'identifiant interne
 * du blob — « 7e5b1110-de38-49e6… » au lieu du nom du fichier. Le document
 * d'un candidat méritait mieux que ça, et surtout : ce cadre change d'un
 * navigateur à l'autre, on ne peut ni le styler ni le prévoir.
 *
 * On rend donc les pages nous-mêmes, avec pdf.js — le moteur que Firefox
 * utilise pour la même tâche —, servi depuis nos propres fichiers : aucune
 * requête vers un tiers à l'exécution, comme pour les polices et les icônes.
 *
 * Le défilement est continu et le rendu PARESSEUX : seules les pages proches
 * de l'écran sont peintes (400 px de marge de part et d'autre), les autres
 * n'occupent qu'un cadre à leurs dimensions. Un mémoire de 200 pages s'ouvre
 * donc aussi vite qu'un CV d'une page.
 */
export function PdfViewer({
  data,
  titre,
  onError,
}: {
  /** Le PDF déjà en mémoire — c'est l'appelant qui l'a récupéré avec la session. */
  data: ArrayBuffer;
  /**
   * Ce que la pièce EST — « Curriculum Vitæ » —, pas le nom que le fichier
   * porte. Omis quand la coquille qui entoure le lecteur la nomme déjà : la
   * barre n'est alors plus qu'un poste de pilotage.
   */
  titre?: string;
  onError?: () => void;
}) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [prete, setPrete] = useState(false);
  const [echouee, setEchouee] = useState(false);

  const zone = useRef<HTMLDivElement>(null);
  const feuillet = useRef<HTMLDivElement>(null);
  const cadres = useRef<(HTMLDivElement | null)[]>([]);
  const toiles = useRef<(HTMLCanvasElement | null)[]>([]);
  const doc = useRef<PDFDocumentProxy | null>(null);
  /** Clé « page@échelle » des pages déjà peintes, pour ne pas les repeindre. */
  const peintes = useRef(new Set<string>());
  const enCours = useRef(new Map<number, RenderTask>());
  /** Largeur d'une page à l'échelle 1 : sert à ajuster le zoom à la fenêtre. */
  const largeurBase = useRef(1);

  // ---- Chargement du document -------------------------------------------
  useEffect(() => {
    let annule = false;
    // C'est la TÂCHE DE CHARGEMENT qui se défait, pas le document : elle seule
    // sait interrompre le worker et les requêtes en vol.
    let tache: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
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
        const chargement = pdfjs.getDocument({ data: data.slice(0) });
        tache = chargement;
        const pdf = await chargement.promise;
        if (annule) return;
        doc.current = pdf;

        const tailles: { width: number; height: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const p = await pdf.getPage(i);
          const vue = p.getViewport({ scale: 1 });
          tailles.push({ width: vue.width, height: vue.height });
        }
        if (annule) return;
        largeurBase.current = tailles[0]?.width ?? 1;
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
      for (const t of enCours.current.values()) t.cancel();
      enCours.current.clear();
      peintes.current.clear();
      doc.current = null;
      void tache?.destroy();
    };
    // `onError` est une closure de l'appelant : la suivre relancerait le
    // chargement à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ---- Zoom initial : la page tient dans la largeur ----------------------
  useEffect(() => {
    if (!prete || !zone.current) return;
    const dispo = zone.current.clientWidth - 32;
    if (dispo > 0 && largeurBase.current > 0) {
      setZoom(Math.min(2, Math.max(0.4, dispo / largeurBase.current)));
    }
  }, [prete]);

  // ---- Peinture d'une page ----------------------------------------------
  const peindre = useCallback(async (index: number, echelle: number) => {
    const cle = `${index}@${echelle.toFixed(3)}`;
    if (peintes.current.has(cle) || enCours.current.has(index)) return;
    const pdf = doc.current;
    const toile = toiles.current[index];
    if (!pdf || !toile) return;

    try {
      const p = await pdf.getPage(index + 1);
      const base = p.getViewport({ scale: 1 });
      // La toile a EXACTEMENT la taille du cadre, multipliée par la finesse.
      // Avant, sa largeur était arrondie à part (1142 pixels de toile pour un
      // cadre qui en demandait 1142,6) : le navigateur l'étirait d'une
      // fraction de pixel pour la faire tenir, et cet étirement suffisait à
      // flouter tout le texte de la page.
      const cadre = tailleAffichee(base, echelle);
      const finesse = finesseDe(cadre.width, cadre.height);
      toile.width = Math.round(cadre.width * finesse);
      toile.height = Math.round(cadre.height * finesse);
      // pdf.js peint directement à la taille de la toile : aucune
      // transformation à ajouter, donc aucun arrondi de plus.
      const vue = p.getViewport({ scale: toile.width / base.width });

      const ctx = toile.getContext('2d');
      if (!ctx) return;
      const tache = p.render({ canvasContext: ctx, viewport: vue });
      enCours.current.set(index, tache);
      await tache.promise;
      enCours.current.delete(index);
      peintes.current.add(cle);
    } catch {
      enCours.current.delete(index);
    }
  }, []);

  // ---- Rendu paresseux : ce qui approche de l'écran ----------------------
  useEffect(() => {
    if (!prete || !zone.current) return;
    peintes.current.clear();
    for (const t of enCours.current.values()) t.cancel();
    enCours.current.clear();

    const obs = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.page);
          void peindre(i, zoom);
        }
      },
      { root: zone.current, rootMargin: '400px 0px' },
    );
    for (const c of cadres.current) if (c) obs.observe(c);
    return () => obs.disconnect();
  }, [prete, zoom, pages.length, peindre]);

  // ---- Les pages calées sur les pixels de l'écran -------------------------
  //
  // Une fenêtre centrée tombe volontiers à un demi-pixel près (y = 188,625) :
  // le navigateur rééchantillonne alors la toile pour la poser entre deux
  // pixels, et le texte perd sa netteté. On décale les pages de la fraction
  // qui dépasse — jamais plus d'un pixel, invisible à l'œil, décisif pour le
  // trait. Recalé après l'animation d'ouverture, au redimensionnement et au
  // défilement, qui peut lui aussi s'arrêter entre deux pixels.
  useLayoutEffect(() => {
    const el = feuillet.current;
    const z = zone.current;
    if (!prete || !el || !z) return;
    let brut = 0;
    const caler = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      const fx = (((r.left * d) % 1) + 1) % 1;
      const fy = (((r.top * d) % 1) + 1) % 1;
      if (fx > 0.001 || fy > 0.001) {
        el.style.transform = `translate(${-fx / d}px, ${-fy / d}px)`;
      }
    };
    const plusTard = () => {
      cancelAnimationFrame(brut);
      brut = requestAnimationFrame(caler);
    };
    caler();
    const apresOuverture = window.setTimeout(caler, 320);
    window.addEventListener('resize', plusTard);
    z.addEventListener('scroll', plusTard, { passive: true });
    return () => {
      window.clearTimeout(apresOuverture);
      cancelAnimationFrame(brut);
      window.removeEventListener('resize', plusTard);
      z.removeEventListener('scroll', plusTard);
    };
  }, [prete, zoom]);

  // ---- Le numéro de page suit le défilement ------------------------------
  useEffect(() => {
    const el = zone.current;
    if (!el || !prete) return;
    let brut = 0;
    const maj = () => {
      cancelAnimationFrame(brut);
      brut = requestAnimationFrame(() => {
        const haut = el.getBoundingClientRect().top + 80;
        const courante = cadres.current.findIndex(
          (c) => c && c.getBoundingClientRect().bottom > haut,
        );
        if (courante >= 0) setPage(courante + 1);
      });
    };
    el.addEventListener('scroll', maj, { passive: true });
    return () => {
      cancelAnimationFrame(brut);
      el.removeEventListener('scroll', maj);
    };
  }, [prete]);

  const allerA = (n: number) => {
    const cible = cadres.current[n - 1];
    if (cible && zone.current) {
      zone.current.scrollTo({ top: cible.offsetTop - 12, behavior: 'smooth' });
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
            {prete ? `${page} / ${pages.length}` : '—'}
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

      <div ref={zone} className="flex-1 overflow-auto overscroll-contain px-4 py-3">
        {!prete ? (
          <div className="flex h-full items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        ) : (
          <div ref={feuillet} className="mx-auto flex w-fit flex-col gap-3">
            {pages.map((p, i) => (
              <div
                key={i}
                data-page={i}
                ref={(el) => {
                  cadres.current[i] = el;
                }}
                // Le cadre porte les dimensions AVANT peinture : sans cela, la
                // hauteur du document changerait à chaque page rendue et le
                // défilement sauterait sous le doigt.
                style={tailleAffichee(p, zoom)}
                className="overflow-hidden rounded-[6px] bg-white shadow-[0_1px_3px_rgb(16_24_40/0.12),0_1px_2px_rgb(16_24_40/0.08)]"
              >
                {/* La toile appartient à React et vit DANS le document :
                    pdf.js peint dedans, il n'a ni à la créer ni à l'attacher. */}
                <canvas
                  ref={(el) => {
                    toiles.current[i] = el;
                  }}
                  className="block h-full w-full"
                />
              </div>
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
