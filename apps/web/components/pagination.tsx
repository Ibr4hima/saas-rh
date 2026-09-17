'use client';

import { useEffect, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   La pagination.

   Un « Charger plus » n'est pas une pagination : il empile, et l'on ne sait
   jamais où l'on en est. Quinze lignes par page et des NUMÉROS disent deux
   choses qu'une pile ne dit pas — combien il y en a en tout, et où l'on se
   trouve. Sur une liste d'effectif que la RH parcourt chaque semaine, c'est
   la différence entre chercher et revenir.

   ——— Ce qu'on affiche, et ce qu'on cache

   Sept fenêtres sur huit pages, ce serait huit boutons ; sur deux cents
   pages, deux cents. On garde donc TOUJOURS la première et la dernière — ce
   sont les deux repères d'une liste triée — et une fenêtre autour de la page
   courante ; les trous portent une ellipse. Jamais plus de sept cases, donc
   jamais de barre qui s'allonge.

   ——— Le champ « Aller à la page »

   Au-delà de quelques pages, cliquer « Suivant » onze fois n'est pas une
   navigation. Le champ est le seul moyen d'atteindre la page 40 d'un coup, et
   il vit sous la barre plutôt que dedans : c'est un raccourci, pas le geste
   courant.
   ———————————————————————————————————————————————————————————————— */

/** Le nombre de cases de la fenêtre — première et dernière comprises. */
const CASES_LARGE = 7;
/** Sur un téléphone, la barre perd ses mots et sa fenêtre se resserre. */
const CASES_ETROIT = 5;

type Case = number | 'ellipse';

/**
 * Les cases à afficher, de la première à la dernière.
 *
 * Trois situations, et c'est la POSITION de la fenêtre qui change, jamais sa
 * taille : au début elle colle à gauche (1 2 3 4 … 8), à la fin elle colle à
 * droite (1 … 5 6 7 8), au milieu elle entoure la page courante
 * (1 … 4 5 6 … 8). Une barre dont la largeur varierait au fil des clics
 * ferait bouger « Suivant » sous le doigt.
 */
export function fenetre(courante: number, pages: number, cases = CASES_LARGE): Case[] {
  if (pages <= cases) return Array.from({ length: pages }, (_, i) => i + 1);

  // Les cases restantes une fois la première, la dernière et une ellipse
  // posées. C'est ce reste qui décide si l'on peut coller au bord.
  const bord = cases - 2;
  if (courante <= bord - 1) {
    return [...Array.from({ length: bord }, (_, i) => i + 1), 'ellipse', pages];
  }
  if (courante >= pages - bord + 2) {
    return [1, 'ellipse', ...Array.from({ length: bord }, (_, i) => pages - bord + 1 + i)];
  }
  const autour = cases - 4; // deux bords, deux ellipses
  const debut = courante - Math.floor((autour - 1) / 2);
  return [1, 'ellipse', ...Array.from({ length: autour }, (_, i) => debut + i), 'ellipse', pages];
}

/**
 * Vrai sous 640 px — la barre y perd ses mots.
 *
 * Mesuré par `matchMedia` et non par une classe : le nombre de cases est une
 * décision, pas une mise en forme, et deux jeux de boutons dont l'un serait
 * masqué en CSS mettraient deux fois la page courante dans le document. Le
 * rendu part du cas large et se corrige au premier effet ; cet écran est
 * entièrement rendu par le navigateur, la correction ne se voit pas.
 */
function useEtroit(): boolean {
  const [etroit, setEtroit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const maj = () => setEtroit(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return etroit;
}

export function Pagination({
  page,
  pages,
  onPage,
  className,
}: {
  /** La page courante, de 1 à `pages`. */
  page: number;
  pages: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const etroit = useEtroit();
  // Le champ garde SA valeur pendant qu'on la tape — « 1 » puis « 12 » —, et
  // se réaligne sur la page dès qu'elle change par un autre chemin.
  const [saisie, setSaisie] = useState(String(page));
  useEffect(() => setSaisie(String(page)), [page]);

  // Une seule page ne se pagine pas : la barre disparaît plutôt que de
  // montrer un unique bouton entouré de deux flèches mortes.
  if (pages <= 1) return null;

  const aller = (n: number) => {
    const cible = Math.min(pages, Math.max(1, n));
    if (cible !== page) onPage(cible);
    return cible;
  };

  const valider = () => {
    const n = Number.parseInt(saisie, 10);
    // Une saisie illisible — vide, « abc », 0 — ne déplace rien et le champ
    // redit la page où l'on est : un champ qui se vide en silence laisse
    // croire que le clavier n'a pas été entendu.
    setSaisie(String(Number.isNaN(n) ? page : aller(n)));
  };

  return (
    <div className={cn('flex shrink-0 flex-col items-center gap-2.5', className)}>
      <nav
        aria-label="Pagination"
        className="inline-flex items-center gap-1 rounded-full border border-card-line bg-surface p-1.5 shadow-sm"
      >
        <Fleche
          sens="precedent"
          mot={!etroit}
          disabled={page === 1}
          onClick={() => aller(page - 1)}
        />
        <Filet />
        <ul className="flex items-center gap-0.5">
          {fenetre(page, pages, etroit ? CASES_ETROIT : CASES_LARGE).map((c, i) =>
            c === 'ellipse' ? (
              <li
                key={`e${i}`}
                aria-hidden
                className="grid size-8 place-items-center text-[12.5px] font-semibold text-ink-muted/70 select-none"
              >
                …
              </li>
            ) : (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => aller(c)}
                  aria-current={c === page ? 'page' : undefined}
                  aria-label={`Page ${c}${c === page ? ' (page actuelle)' : ''}`}
                  className={cn(
                    'grid size-8 place-items-center rounded-full text-[12.5px] font-bold tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                    c === page
                      ? 'bg-primary text-primary-ink shadow-[0_2px_8px_rgb(0_79_145/0.30)]'
                      : 'text-ink hover:bg-hover hover:text-primary',
                  )}
                >
                  {c}
                </button>
              </li>
            ),
          )}
        </ul>
        <Filet />
        <Fleche
          sens="suivant"
          mot={!etroit}
          disabled={page === pages}
          onClick={() => aller(page + 1)}
        />
      </nav>

      <p className="flex items-center gap-2 text-[12px] text-ink-muted">
        <label htmlFor="aller-page">Aller à la page</label>
        <input
          id="aller-page"
          inputMode="numeric"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
          onBlur={valider}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              valider();
              e.currentTarget.blur();
            }
          }}
          aria-label={`Aller à la page, sur ${pages}`}
          className="h-8 w-14 rounded-full border border-line bg-surface text-center text-[12.5px] font-semibold text-ink-strong tabular-nums transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
        />
        <span>sur {pages}</span>
      </p>
    </div>
  );
}

/** Le filet vertical qui sépare les flèches des numéros. */
function Filet() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-soft" />;
}

/**
 * Précédent et Suivant.
 *
 * Désactivés aux extrémités plutôt que masqués : la barre garde sa largeur,
 * et les numéros ne glissent pas sous le doigt quand on atteint la fin.
 */
function Fleche({
  sens,
  mot,
  disabled,
  onClick,
}: {
  sens: 'precedent' | 'suivant';
  /** Le mot s'écrit sur un écran large ; sur un téléphone, la flèche suffit. */
  mot: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const avant = sens === 'precedent';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={avant ? 'Page précédente' : 'Page suivante'}
      className={cn(
        'flex h-8 items-center gap-1 rounded-full text-[12.5px] font-bold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
        mot ? 'px-3' : 'w-8 justify-center',
        disabled
          ? 'cursor-not-allowed text-ink-muted/45'
          : 'text-ink-strong hover:bg-hover hover:text-primary',
      )}
    >
      {avant ? <Icon name="chevron_left" size={16} /> : null}
      {mot ? (avant ? 'Précédent' : 'Suivant') : null}
      {avant ? null : <Icon name="chevron_right" size={16} />}
    </button>
  );
}
