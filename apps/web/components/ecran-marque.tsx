'use client';

import * as React from 'react';
import { passwordRulesFor } from '@teranga/contracts';
import { cn, Input } from '@teranga/ui';
import { Icon, type IconName } from './icons';
import { SceneDeLaCharte } from './scene-de-la-charte';

/**
 * Les écrans qui précèdent le compte : connexion, création, activation d'une
 * invitation, mot de passe oublié ou à refaire.
 *
 * Sur la scène de la charte (ADR-0187) : la carte au milieu, son titre
 * souligné d'un filet orange, la mention d'accès dessous. Toujours en clair,
 * quel que soit le thème choisi dans l'application : on le retrouve après la
 * connexion.
 *
 * Elle vit ici et non dans chaque page : cinq écrans qui recopient le même
 * décor finissent par en avoir cinq versions, et c'est le premier écran du
 * produit qui se met à loucher.
 */
export function EcranMarque({
  titre,
  sousTitre,
  pied,
  children,
}: {
  titre: React.ReactNode;
  sousTitre?: React.ReactNode;
  /** Bande de bas de carte : le lien vers l'écran voisin, s'il y en a un. */
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SceneDeLaCharte
      signature="Système de Gestion des Ressources Humaines"
      droite="Plateforme à usage interne"
    >
      <div
        className="login-monte relative mt-8 w-full max-w-[27rem] court:mt-5"
        style={{ '--retard': '0.08s' } as React.CSSProperties}
      >
        {/* Le rayon est celui des cartes de l'application : ces écrans n'ont
            pas de raison d'avoir leur propre rondeur. */}
        <div className="relative overflow-hidden rounded-bloc border border-card-line bg-surface shadow-[0_1px_2px_rgb(0_40_90/0.05),0_2px_6px_-2px_rgb(0_40_90/0.06),0_24px_56px_-24px_rgb(0_40_90/0.28)]">
          <div className="px-7 pt-9 pb-7 sm:px-9 court:pt-7 court:pb-6">
            <h1 className="text-center text-[25px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-ink-strong">
              {titre}
            </h1>
            {/* Le filet orange de la charte sous le titre, comme sur le
                certificat et les courriels. */}
            <span aria-hidden className="mx-auto mt-3 block h-[3px] w-10 rounded-full bg-accent" />
            {sousTitre ? (
              <p className="mt-3.5 text-center text-[13.5px] leading-relaxed text-pretty text-ink-muted">
                {sousTitre}
              </p>
            ) : null}
            {children}
          </div>

          {pied ? (
            <div className="border-t border-line-soft bg-surface-raised px-7 py-4 text-center text-[13px] text-ink-muted sm:px-9 court:py-3">
              {pied}
            </div>
          ) : null}
        </div>
      </div>

      <p
        className="login-monte mt-6 flex max-w-[27rem] items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted court:mt-4"
        style={{ '--retard': '0.2s' } as React.CSSProperties}
      >
        <Icon name="lock" size={13} className="mt-px shrink-0" />
        Accès réservé aux agents de l&apos;APIX disposant d&apos;un compte professionnel
      </p>
    </SceneDeLaCharte>
  );
}

/**
 * Un champ de ces écrans : micro-libellé en capitales, icône de tête qui prend
 * la couleur de marque au focus, message sous le champ.
 *
 * Écrit ici plutôt que repris de `Field` : ces écrans portent la typographie
 * de la marque et non celle des formulaires de l'application. Le câblage
 * d'accessibilité que `Field` apporte est refait, pas abandonné.
 */
export function ChampMarque({
  id,
  label,
  icone,
  erreur,
  indication,
  ton = 'muet',
  children,
}: {
  id: string;
  label: string;
  icone: IconName;
  erreur?: string;
  indication?: React.ReactNode;
  /** L'indication avertit-elle, ou se contente-t-elle d'informer ? */
  ton?: 'muet' | 'alerte';
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[10.5px] font-extrabold tracking-[0.1em] text-primary uppercase"
      >
        {label}
      </label>
      <div className="group relative">
        <Icon
          name={icone}
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted transition-colors duration-150 group-focus-within:text-primary"
        />
        {children}
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} className="mt-1.5 text-xs text-danger">
          {erreur}
        </p>
      ) : indication ? (
        <p
          id={`${id}-indication`}
          className={cn('mt-1.5 text-xs', ton === 'alerte' ? 'text-warning' : 'text-ink-muted')}
        >
          {indication}
        </p>
      ) : null}
    </div>
  );
}

/** Le champ de saisie de ces écrans — haut, à icône, coins doux. */
export function SaisieMarque({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  return (
    <Input
      className={cn(
        'h-12 rounded-lg border-[1.5px] bg-surface-raised pr-3 pl-10 text-[14.5px] court:h-11',
        className,
      )}
      {...props}
    />
  );
}

/** L'œil qui dévoile un mot de passe, posé au bout du champ. */
export function BoutonOeil({
  visible,
  onToggle,
  disabled,
}: {
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={visible ? 'visibility_off' : 'visibility'} size={17} />
    </button>
  );
}

/**
 * Un mot de passe se tape : il ne se copie, ne se coupe, ne se colle ni ne se
 * dépose. La confirmation sert à prouver qu'on le connaît ; recopiée par un
 * copier-coller, elle reproduirait la faute de frappe au lieu de la révéler.
 * Le remplissage d'un gestionnaire de mots de passe n'est pas un collage : il
 * passe toujours.
 */
export const SANS_COPIER_COLLER = {
  onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
  onCut: (e: React.ClipboardEvent) => e.preventDefault(),
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
  onDrop: (e: React.DragEvent) => e.preventDefault(),
};

/**
 * Toutes les règles affichées sous le champ sont remplies. Tant qu'elles ne le
 * sont pas, la confirmation reste fermée : on ne confirme pas un mot de passe
 * que le serveur refusera.
 */
export function motDePasseConforme(password: string, email: string): boolean {
  return passwordRulesFor(email).every((regle) => regle.ok(password));
}

/**
 * La politique de mot de passe, cochée en direct.
 *
 * Les règles viennent des contrats — les mêmes que le serveur revalide. Une
 * liste recopiée dans l'écran finirait par promettre ce que l'API refuse.
 *
 * Elle ne paraît qu'une fois la saisie commencée : six lignes de contraintes
 * sur un champ vide accueillent mal, et elles n'apprennent rien tant qu'il n'y
 * a rien à vérifier.
 */
export function ReglesMotDePasse({ password, email }: { password: string; email: string }) {
  if (password.length === 0) return null;
  return (
    <ul
      aria-label="Exigences du mot de passe"
      className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2"
    >
      {passwordRulesFor(email).map((regle) => {
        const ok = regle.ok(password);
        return (
          <li
            key={regle.libelle}
            className={cn(
              'flex items-center gap-1.5 text-[11px] font-semibold transition-colors duration-150',
              ok ? 'text-success' : 'text-ink-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full',
                ok ? 'bg-success/15' : 'bg-line-soft',
              )}
            >
              {ok ? <Icon name="check" size={10} /> : null}
            </span>
            {/* Le lecteur d'écran a besoin de l'état, que la couleur seule ne
                lui donne pas. */}
            <span className="sr-only">{ok ? 'Rempli :' : 'Manquant :'}</span>
            {regle.libelle}
          </li>
        );
      })}
    </ul>
  );
}
