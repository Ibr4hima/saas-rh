'use client';

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

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
  /** Ce que la pièce EST — « Curriculum Vitæ » —, pas le nom que le fichier porte. */
  titre: string;
  onError?: () => void;
}) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [prete, setPrete] = useState(false);
  const [echouee, setEchouee] = useState(false);

  const zone = useRef<HTMLDivElement>(null);
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
      const vue = p.getViewport({ scale: echelle });
      // Sur écran dense, peindre à la résolution PHYSIQUE : sinon le texte
      // d'un CV sort crénelé, ce qui n'arrive dans aucun vrai lecteur.
      const densite = Math.min(2, window.devicePixelRatio || 1);
      toile.width = Math.floor(vue.width * densite);
      toile.height = Math.floor(vue.height * densite);

      const ctx = toile.getContext('2d');
      if (!ctx) return;
      const tache = p.render({
        canvasContext: ctx,
        viewport: vue,
        transform: densite === 1 ? undefined : [densite, 0, 0, densite, 0, 0],
      });
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
        <p className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-strong">{titre}</p>

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
          <div className="mx-auto flex w-fit flex-col gap-3">
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
                style={{ width: p.width * zoom, height: p.height * zoom }}
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
