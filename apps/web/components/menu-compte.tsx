'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon, type IconName } from './icons';
import { usePreferences } from './preferences';

/* ————————————————————————————————————————————————————————————————
   Le menu du compte.

   La colonne portait une porte de sortie et rien d'autre : une flèche de
   déconnexion, à côté d'un nom. C'était une action isolée là où il en
   faudrait plusieurs — et le thème n'avait nulle part où vivre.

   Une silhouette ouvre donc un menu : ce qui appartient à la PERSONNE plutôt
   qu'à un écran — ses certificats APIX Academy, le thème — et la sortie.
   (La densité des tableaux y figurait ; elle a été retirée, les tableaux
   sont confortables pour tous.) La déconnexion se range en bas,
   derrière un filet, en rouge au survol : c'est le geste qu'on ne veut pas
   faire par erreur en visant celui d'au-dessus.

   Il s'ouvre comme le panneau des notifications, et pour la même raison : la
   page RECULE derrière un voile flouté. Un menu posé sur un tableau de bord
   chargé se confond avec les cartes qu'il recouvre ; le flou le décolle sans
   éteindre l'écran, et l'on voit qu'on est toujours chez soi. Le panneau vit
   donc dans un portail, en position fixe — sorti du flux, il ne peut plus
   être rogné par la colonne ni par le bandeau qui le portent.
   ———————————————————————————————————————————————————————————————— */

export function MenuCompte({ variante }: { variante: 'colonne' | 'bandeau' }) {
  const router = useRouter();
  const { theme, basculer } = usePreferences();
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  // Le panneau vit dans un portail : il n'est plus DANS le bouton, et le
  // garde « clic à l'extérieur » doit le connaître, sinon choisir « Mode
  // sombre » refermerait le menu avant que le clic n'atteigne la rangée.
  const panneau = useRef<HTMLDivElement>(null);

  // Fermer au clic ailleurs et à Échap : un menu qui reste ouvert quand on
  // travaille autour se transforme en obstacle.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (bouton.current?.contains(cible) || panneau.current?.contains(cible)) return;
      setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener('pointerdown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  const seDeconnecter = async () => {
    setOuvert(false);
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  const nuit = theme === 'sombre';
  const dansLeBandeau = variante === 'bandeau';

  return (
    <div className="shrink-0">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label="Mon compte"
        title="Mon compte"
        className={cn(
          'flex items-center justify-center transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2',
          dansLeBandeau
            ? 'size-9 rounded-full border border-white/30 bg-white/10 text-hero-ink hover:border-white/55 hover:bg-white/20 focus-visible:outline-white/60'
            : cn(
                'size-8 rounded-[9px] focus-visible:outline-primary/40',
                ouvert
                  ? 'bg-primary/[0.09] text-primary'
                  : 'text-ink-muted hover:bg-hover hover:text-ink',
              ),
        )}
      >
        <Icon name="person" size={dansLeBandeau ? 19 : 18} fill={ouvert} />
      </button>

      {ouvert ? (
        <Panneau
          ancre={bouton}
          panneau={panneau}
          dansLeBandeau={dansLeBandeau}
          onFermer={() => setOuvert(false)}
        >
          {/* Ses certificats, où qu'on soit : c'est ce qu'on vient chercher
              quand on vous demande une preuve de formation. */}
          <Rangee
            icone="workspace_premium"
            libelle="Mes certificats"
            onClick={() => {
              setOuvert(false);
              router.push('/academy/certificats');
            }}
          />
          <Rangee
            icone={nuit ? 'light_mode' : 'dark_mode'}
            libelle={nuit ? 'Mode clair' : 'Mode sombre'}
            onClick={() => {
              basculer();
              setOuvert(false);
            }}
          />
          <div className="my-1 h-px bg-line-soft" />
          <Rangee
            icone="logout"
            libelle="Se déconnecter"
            danger
            onClick={() => void seDeconnecter()}
          />
        </Panneau>
      ) : null}
    </div>
  );
}

/**
 * Le panneau, posé sur la page.
 *
 * Il se cale sur le bouton APRÈS peinture — c'est la seule façon de connaître
 * sa position réelle — et repart du bon côté selon l'ancre : vers le bas sous
 * le bandeau, vers le haut depuis la colonne, dont la carte touche le bas de
 * l'écran. Dans le bandeau, le voile commence SOUS la barre bleue : flouter
 * l'en-tête reviendrait à flouter le bouton qu'on vient de viser.
 */
function Panneau({
  ancre,
  panneau,
  dansLeBandeau,
  onFermer,
  children,
}: {
  ancre: React.RefObject<HTMLButtonElement | null>;
  panneau: React.RefObject<HTMLDivElement | null>;
  dansLeBandeau: boolean;
  onFermer: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    right?: number;
    left?: number;
    voile: number;
  } | null>(null);

  const placer = useCallback(() => {
    const r = ancre.current?.getBoundingClientRect();
    if (!r) return;
    const droite = Math.max(12, window.innerWidth - r.right);
    if (dansLeBandeau) {
      // Sous la BARRE, pas sous le bouton : centré dans les 58 px du bandeau,
      // un décalage depuis son bas ferait mordre le panneau sur le bleu.
      const barre = ancre.current?.closest('header')?.getBoundingClientRect();
      const haut = (barre?.bottom ?? r.bottom) + 8;
      setPos({ top: haut, right: droite, voile: haut - 8 });
      return;
    }
    // Colonne repliée en rail : le bouton est trop près du bord gauche pour
    // que le panneau s'aligne sur sa droite — il partirait hors de l'écran.
    // Il s'aligne alors sur sa gauche.
    if (r.right < 240) {
      setPos({ bottom: window.innerHeight - r.top + 8, left: Math.max(12, r.left), voile: 0 });
      return;
    }
    setPos({ bottom: window.innerHeight - r.top + 8, right: droite, voile: 0 });
  }, [ancre, dansLeBandeau]);

  // Avant peinture : sans cela le panneau apparaît un instant en haut à gauche.
  useLayoutEffect(placer, [placer]);
  useEffect(() => {
    window.addEventListener('resize', placer);
    return () => window.removeEventListener('resize', placer);
  }, [placer]);

  if (typeof document === 'undefined' || !pos) return null;

  return createPortal(
    <>
      {/* Le voile ferme aussi au clic — le gestionnaire global le ferait, mais
          un voile qui ne répond pas au clic passe pour un écran figé. */}
      <div
        aria-hidden
        onClick={onFermer}
        className="tg-voile fixed inset-0 z-[55]"
        style={{ top: pos.voile }}
      />
      <div
        ref={panneau}
        role="menu"
        style={{ top: pos.top, bottom: pos.bottom, right: pos.right, left: pos.left }}
        className="tg-menu fixed z-[60] min-w-[13.5rem] rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function Rangee({
  icone,
  libelle,
  danger,
  onClick,
}: {
  icone: IconName;
  libelle: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors duration-150',
        danger
          ? 'text-ink hover:bg-danger-soft hover:text-danger'
          : 'text-ink hover:bg-hover hover:text-ink-strong',
      )}
    >
      {/* L'icône suit le mot au survol : sur la déconnexion, une flèche
          restée grise à côté d'un libellé rouge se lit comme une erreur. */}
      <Icon name={icone} size={17} className="shrink-0 text-ink-muted group-hover:text-current" />
      {libelle}
    </button>
  );
}
