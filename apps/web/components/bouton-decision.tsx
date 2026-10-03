'use client';

import { cn } from '@teranga/ui';
import { Icon } from './icons';

/**
 * Un geste de décision : viser, ou refuser.
 *
 * Deux icônes plutôt que deux mots. « Approuver » et « Refuser » côte à côte
 * pesaient cent-soixante pixels sur chaque ligne d'un tableau qu'on parcourt,
 * et leurs deux aplats pleins tiraient l'œil avant les données. La coche et la
 * croix se reconnaissent sans se lire ; la couleur dit le sens, et le nom de
 * l'employé est repris dans l'intitulé accessible (« Approuver le congé de
 * Hawa Ba ») pour que la colonne reste utilisable sans la voir.
 *
 * Au repos, le bouton est dessiné comme un badge : fond blanc, liseré clair,
 * icône dans la couleur du statut qu'il donnera (le teal d'« Approuvée », le
 * rouge de « Refusée »), et une ombre d'un pixel qui le pose. Au survol il se
 * remplit de sa couleur, l'icône passe dans l'encre de l'aplat, et il se
 * soulève d'un pixel sur une ombre de sa teinte : le geste est armé.
 */
const STYLES = {
  approuver: cn(
    'border-badge-teal-line text-badge-teal-ink',
    'hover:border-decision-oui hover:bg-decision-oui hover:text-decision-oui-ink',
    'hover:shadow-[0_4px_12px_-2px_color-mix(in_oklab,var(--tg-decision-oui)_45%,transparent)]',
    'focus-visible:ring-decision-oui/35',
  ),
  refuser: cn(
    'border-badge-rouge-line text-badge-rouge-ink',
    'hover:border-decision-non hover:bg-decision-non hover:text-decision-non-ink',
    'hover:shadow-[0_4px_12px_-2px_color-mix(in_oklab,var(--tg-decision-non)_45%,transparent)]',
    'focus-visible:ring-decision-non/35',
  ),
} as const;

export function BoutonDecision({
  geste,
  employe,
  objet = 'le congé',
  enCours,
  bloque,
  onClick,
}: {
  geste: 'approuver' | 'refuser';
  employe: string;
  /** Ce qu'on tranche : « le congé », « le changement ». */
  objet?: string;
  /** C'est CE bouton qui attend le serveur. */
  enCours: boolean;
  /** Une décision est en cours, quelle qu'elle soit : on ne clique plus. */
  bloque: boolean;
  onClick: () => void;
}) {
  const approuve = geste === 'approuver';
  const intitule = `${approuve ? 'Valider' : 'Refuser'} ${objet} de ${employe}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={bloque}
      title={intitule}
      aria-label={intitule}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface',
        'shadow-[0_1px_2px_rgb(20_23_42/0.06)]',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
        'hover:-translate-y-px active:translate-y-0 active:scale-95',
        'focus-visible:ring-4 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        STYLES[geste],
      )}
    >
      {enCours ? (
        <span
          aria-hidden
          className="size-[15px] animate-spin rounded-full border-2 border-current/25 border-t-current"
        />
      ) : (
        // La coche est un glyphe plus maigre que la croix : un cran de plus
        // les fait peser pareil côte à côte.
        <Icon name={approuve ? 'check' : 'close'} size={approuve ? 19 : 17} weight={600} />
      )}
    </button>
  );
}
