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
 * l'employé est repris dans l'intitulé accessible — « Approuver le congé de
 * Hawa Ba » — pour que la colonne reste utilisable sans la voir.
 *
 * Au repos une teinte pâle cerclée d'un filet ; au survol la teinte se remplit.
 * Pas d'aplat vif qui s'inverse en thème sombre : on n'a pas d'encre garantie
 * sur le vert ni sur le rouge, et un blanc posé dessus tomberait sous le seuil
 * de lisibilité la nuit.
 */
export function BoutonDecision({
  geste,
  employe,
  enCours,
  bloque,
  onClick,
}: {
  geste: 'approuver' | 'refuser';
  employe: string;
  /** C'est CE bouton qui attend le serveur. */
  enCours: boolean;
  /** Une décision est en cours, quelle qu'elle soit : on ne clique plus. */
  bloque: boolean;
  onClick: () => void;
}) {
  const approuve = geste === 'approuver';
  const intitule = `${approuve ? 'Valider' : 'Refuser'} le congé de ${employe}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={bloque}
      title={intitule}
      aria-label={intitule}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
        'transition-all duration-150 ease-out active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        approuve
          ? 'bg-success-soft/55 text-success ring-success/30 hover:bg-success-soft hover:ring-success/60 focus-visible:outline-success'
          : 'bg-danger-soft/55 text-danger ring-danger/30 hover:bg-danger-soft hover:ring-danger/60 focus-visible:outline-danger',
      )}
    >
      {enCours ? (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      ) : (
        <Icon name={approuve ? 'check' : 'close'} size={18} />
      )}
    </button>
  );
}
