'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   La recherche de formations, dans la bande bleue de l'espace Academy.

   Le mot cherché vit dans l'ADRESSE — /academy?q=powerpoint — et le
   catalogue le lit là : un retour arrière le retrouve, un lien le partage.
   Sur le catalogue, chaque frappe réécrit l'adresse sur place (sans aller
   au serveur) ; ailleurs dans l'Academy, la première frappe ramène au
   catalogue, et le champ — qui appartient au bandeau, pas à la page — garde
   le curseur pendant le trajet.

   Sur téléphone, le bandeau n'a pas la place d'un champ : une loupe le
   déplie par-dessus le titre, une croix le replie.
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
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none md:hidden"
      >
        <Icon name="search" size={20} />
      </button>

      {/* Déplié sur téléphone, le champ recouvre le bandeau : il en prend le
          fond, sinon le titre transparaîtrait dessous. Il se cale sur
          l'ÉCRAN — le bandeau est toujours en haut, et le groupe de boutons
          qui le porte est trop étroit pour servir de repère. */}
      <div
        className={cn(
          'items-center gap-2',
          deplie
            ? 'fixed inset-x-0 top-0 z-40 flex h-[58px] bg-[var(--tg-hero)] px-3 md:static md:h-auto md:bg-transparent md:px-0'
            : 'hidden md:flex',
        )}
      >
        <div className="relative w-full md:w-60 lg:w-72">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hero-ink/70"
          />
          <input
            ref={champ}
            type="search"
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
            className="h-9 w-full rounded-full border border-white/30 bg-white/10 pr-3 pl-9 text-[13px] font-medium text-hero-ink transition-colors duration-150 outline-none placeholder:text-hero-ink/65 hover:border-white/50 focus:border-white/70 focus:bg-white/15 [&::-webkit-search-cancel-button]:hidden"
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
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-hero-ink hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none md:hidden"
          >
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </div>
    </>
  );
}
