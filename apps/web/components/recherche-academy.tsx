'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { COMMANDE } from './entete';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   La recherche de formations, dans l'en-tête de l'espace Academy.

   Le mot cherché vit dans l'ADRESSE — /academy?q=powerpoint — et le
   catalogue le lit là : un retour arrière le retrouve, un lien le partage.
   Sur le catalogue, chaque frappe réécrit l'adresse sur place (sans aller
   au serveur) ; ailleurs dans l'Academy, la première frappe ramène au
   catalogue, et le champ, qui appartient à l'en-tête et non à la page,
   garde le curseur pendant le trajet.

   Sur téléphone, l'en-tête n'a pas la place d'un champ : une loupe le
   déplie par-dessus, une croix le replie.
   ———————————————————————————————————————————————————————————————— */

export function RechercheAcademy() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const surCatalogue = pathname === '/academy';
  const champ = useRef<HTMLInputElement>(null);
  const [valeur, setValeur] = useState(() => (surCatalogue ? (params.get('q') ?? '') : ''));
  const [deplie, setDeplie] = useState(false);

  // L'adresse a changé sans le champ (retour arrière, « Effacer » dans la
  // page, autre écran) : il la suit. Pas pendant la frappe — sinon une
  // adresse en retard d'une lettre effacerait la dernière tapée.
  useEffect(() => {
    if (document.activeElement === champ.current) return;
    setValeur(surCatalogue ? (params.get('q') ?? '') : '');
  }, [surCatalogue, params]);

  const chercher = (v: string) => {
    setValeur(v);
    const adresse = v.trim() ? `/academy?q=${encodeURIComponent(v)}` : '/academy';
    if (surCatalogue) window.history.replaceState(null, '', adresse);
    else router.push(adresse);
  };

  const replier = () => {
    setDeplie(false);
    champ.current?.blur();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDeplie(true);
          requestAnimationFrame(() => champ.current?.focus());
        }}
        aria-label="Rechercher une formation"
        title="Rechercher une formation"
        className={cn(COMMANDE, 'md:hidden')}
      >
        <Icon name="search" size={20} />
      </button>

      {/* Déplié sur téléphone, le champ recouvre l'en-tête : il en prend le
          fond, sinon le logo transparaîtrait dessous. Il se cale sur
          l'ÉCRAN : l'en-tête est toujours en haut, et le groupe de boutons
          qui le porte est trop étroit pour servir de repère. */}
      <div
        className={cn(
          'items-center gap-2',
          deplie
            ? 'fixed inset-x-0 top-0 z-40 flex h-14 bg-bg px-3 md:static md:h-auto md:bg-transparent md:px-0'
            : 'hidden md:flex',
        )}
      >
        <div className="relative w-full md:w-60 lg:w-72">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref={champ}
            type="search"
            autoComplete="off"
            value={valeur}
            onChange={(e) => chercher(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              if (valeur) chercher('');
              else replier();
            }}
            onBlur={() => {
              if (!valeur) setDeplie(false);
            }}
            placeholder="Rechercher une formation…"
            aria-label="Rechercher une formation"
            enterKeyHint="search"
            className="h-9 w-full rounded-controle border border-line bg-surface pr-3 pl-9 text-[13px] font-medium text-ink shadow-bouton-borde transition-colors duration-150 outline-none placeholder:text-ink-muted/70 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/40 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        {deplie ? (
          <button
            type="button"
            onClick={() => {
              if (valeur) chercher('');
              replier();
            }}
            aria-label="Fermer la recherche"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-menu-survol hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
          >
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </div>
    </>
  );
}
