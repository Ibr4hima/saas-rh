'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { fermerSession } from '../lib/session';
import { COMMANDE, COMMANDE_ACTIVE } from './entete';
import { LIBELLES_ESPACE, type Espace } from './espace';
import { Icon, type IconName } from './icons';
import { usePreferences } from './preferences';

/* ————————————————————————————————————————————————————————————————
   Le menu du compte.

   La colonne portait une porte de sortie et rien d'autre : une flèche de
   déconnexion, à côté d'un nom. C'était une action isolée là où il en
   faudrait plusieurs — et le thème n'avait nulle part où vivre.

   La personne ouvre donc un menu : tout le bloc de son nom, en bas du menu
   (ADR-0115), ou sa silhouette dans l'en-tête du téléphone. Il porte ce qui
   appartient à la PERSONNE plutôt qu'à un écran : l'espace où l'on
   travaille (« Mon espace » ou « Gestion RH », pour qui a les deux), ses
   certificats APIX Academy (dans Mon espace), ses notifications, le thème,
   et la sortie. L'autre espace s'y choisit comme le thème : la rangée dit où
   l'on va, et un point sur le bouton dit que quelque chose y attend.
   (La densité des tableaux y figurait ; elle a été retirée, les tableaux
   sont confortables pour tous.) La déconnexion se range en bas, derrière un
   filet, en rouge au survol : c'est le geste qu'on ne veut pas faire par
   erreur en visant celui d'au-dessus.

   Il s'ouvre comme le panneau des notifications, et pour la même raison : la
   page RECULE derrière un voile flouté. Un menu posé sur un tableau de bord
   chargé se confond avec les cartes qu'il recouvre ; le flou le décolle sans
   éteindre l'écran, et l'on voit qu'on est toujours chez soi. Le panneau vit
   donc dans un portail, en position fixe — sorti du flux, il ne peut plus
   être rogné par la colonne ni par l'en-tête qui le portent.
   ———————————————————————————————————————————————————————————————— */

/** L'autre espace, pour qui en a deux : où la rangée mène, et ce qui y attend. */
export interface BasculeDEspace {
  vers: Espace;
  alerte: number;
  onBasculer: () => void;
}

/** Qui est connecté, tel que le bas du menu le présente. */
export interface Identite {
  initiales: string;
  /** Le nom court (« Mouhamadou M. Ba ») ; le nom entier au survol. */
  nom: string;
  nomComplet: string;
  /** L'espace où l'on travaille ; pour le compte d'administration, sa fonction. */
  qualite: string;
}

export function MenuCompte({
  variante,
  bascule,
  certificats,
  identite,
}: {
  /**
   * `colonne` : en bas du menu, la personne en toutes lettres, et tout son
   * bloc ouvre le menu. `entete` : sa silhouette dans l'en-tête du
   * téléphone, où la colonne n'existe pas.
   */
  variante: 'colonne' | 'entete';
  bascule?: BasculeDEspace;
  /** « Mes certificats » : dans Mon espace seulement. */
  certificats: boolean;
  /** Le bloc du bas du menu : ses initiales, son nom, son espace. */
  identite?: Identite;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, basculer } = usePreferences();
  // L'icône du compte suit le sexe au dossier : person, ou person_2.
  const soi: IconName = useMe().data?.gender === 'female' ? 'person_2' : 'person';
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
    // Ce qui a été lu (candidatures, dossiers) ne reste pas dans l'onglet,
    // ni dans les autres onglets ouverts sur la même session.
    fermerSession(queryClient);
    router.replace('/login');
  };

  const nuit = theme === 'sombre';
  const dansLEntete = variante === 'entete';
  // Ce qui attend dans l'autre espace : un point, tant que le menu est fermé.
  const alerte = Boolean(bascule && bascule.alerte > 0 && !ouvert);

  return (
    <div className={dansLEntete ? 'shrink-0' : 'w-full'}>
      {dansLEntete || !identite ? (
        <button
          ref={bouton}
          type="button"
          onClick={() => setOuvert((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={ouvert}
          aria-label="Mon compte"
          title="Mon compte"
          className={cn(COMMANDE, ouvert && COMMANDE_ACTIVE)}
        >
          <span className="relative flex">
            <Icon name={soi} size={19} fill={ouvert} />
            {alerte ? (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-1 size-2 rounded-full bg-alert ring-2 ring-surface"
              />
            ) : null}
          </span>
        </button>
      ) : (
        // Tout le bloc ouvre le menu : le nom est la plus grande cible du bas
        // de la colonne, et c'est lui qu'on vise pour parler de soi.
        <button
          ref={bouton}
          type="button"
          onClick={() => setOuvert((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={ouvert}
          aria-label={`Mon compte · ${identite.nomComplet}`}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-controle py-2 pr-2.5 pl-2 text-left transition-colors duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            ouvert ? 'bg-menu-survol' : 'hover:bg-menu-survol',
          )}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.09] text-[11px] font-bold text-primary">
            {identite.initiales}
            {alerte ? (
              <span
                aria-hidden
                className="absolute -top-px -right-px size-2.5 rounded-full bg-alert ring-2 ring-bg"
              />
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span
              title={identite.nomComplet}
              className="block truncate text-[12.5px] leading-tight font-semibold text-ink-strong"
            >
              {identite.nom}
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-tight text-ink-muted">
              {identite.qualite}
            </span>
          </span>
          {/* Le menu s'ouvre au-dessus du bloc : le chevron le dit, et se
              retourne quand il est ouvert. */}
          <Icon
            name="chevron_right"
            size={16}
            className={cn(
              'shrink-0 text-ink-muted transition-transform duration-200 group-hover:text-ink',
              ouvert ? 'rotate-90' : '-rotate-90',
            )}
          />
        </button>
      )}

      {ouvert ? (
        <Panneau
          ancre={bouton}
          panneau={panneau}
          dansLEntete={dansLEntete}
          onFermer={() => setOuvert(false)}
        >
          {bascule ? (
            <Rangee
              icone={bascule.vers === 'gestion' ? 'business_center' : soi}
              libelle={LIBELLES_ESPACE[bascule.vers]}
              badge={bascule.alerte}
              onClick={() => {
                setOuvert(false);
                bascule.onBasculer();
              }}
            />
          ) : null}
          {/* Ses certificats, depuis Mon espace : c'est ce qu'on vient
              chercher quand on vous demande une preuve de formation. */}
          {certificats ? (
            <Rangee
              icone="workspace_premium"
              libelle="Mes certificats"
              onClick={() => {
                setOuvert(false);
                router.push('/academy/certificats');
              }}
            />
          ) : null}
          <Rangee
            icone="notifications"
            libelle="Notifications"
            onClick={() => {
              setOuvert(false);
              router.push('/notifications');
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
 * l'en-tête du téléphone, vers le haut depuis le bas du menu, à l'aplomb du
 * bloc de la personne et au moins aussi large. Sous l'en-tête, le voile
 * commence à son bord : flouter l'en-tête reviendrait à flouter le bouton
 * qu'on vient de viser.
 */
function Panneau({
  ancre,
  panneau,
  dansLEntete,
  onFermer,
  children,
}: {
  ancre: React.RefObject<HTMLButtonElement | null>;
  panneau: React.RefObject<HTMLDivElement | null>;
  dansLEntete: boolean;
  onFermer: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    right?: number;
    left?: number;
    largeur?: number;
    voile: number;
  } | null>(null);

  const placer = useCallback(() => {
    const r = ancre.current?.getBoundingClientRect();
    if (!r) return;
    if (dansLEntete) {
      // Sous l'EN-TÊTE, pas sous le bouton : il y est centré, un décalage
      // depuis son bas ferait mordre le panneau sur l'en-tête.
      const entete = ancre.current?.closest('header')?.getBoundingClientRect();
      const haut = (entete?.bottom ?? r.bottom) + 8;
      setPos({ top: haut, right: Math.max(12, window.innerWidth - r.right), voile: haut - 8 });
      return;
    }
    setPos({
      bottom: window.innerHeight - r.top + 6,
      left: Math.max(12, r.left),
      largeur: r.width,
      voile: 0,
    });
  }, [ancre, dansLEntete]);

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
        style={{
          top: pos.top,
          bottom: pos.bottom,
          right: pos.right,
          left: pos.left,
          minWidth: pos.largeur,
        }}
        className="tg-menu fixed z-[60] min-w-[13.5rem] rounded-bloc border border-card-line bg-surface p-1.5 shadow-lg"
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
  badge,
  onClick,
}: {
  icone: IconName;
  libelle: string;
  danger?: boolean;
  /** Ce qui attend derrière la rangée (l'autre espace). */
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-controle-sm px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors duration-150',
        danger
          ? 'text-ink hover:bg-danger-soft hover:text-danger'
          : 'text-ink hover:bg-hover hover:text-ink-strong',
      )}
    >
      {/* L'icône suit le mot au survol : sur la déconnexion, une flèche
          restée grise à côté d'un libellé rouge se lit comme une erreur. */}
      <Icon name={icone} size={17} className="shrink-0 text-ink-muted group-hover:text-current" />
      <span className="flex-1">{libelle}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-alert-soft px-[6px] py-px text-[10px] font-extrabold text-alert-text">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
