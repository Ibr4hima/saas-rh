'use client';

import * as React from 'react';
import { passwordRulesFor } from '@teranga/contracts';
import { cn, Input } from '@teranga/ui';
import { BrandMark } from './brand-mark';
import { Icon, type IconName } from './icons';

/**
 * La scène des écrans qui précèdent le compte : connexion, création,
 * activation d'une invitation.
 *
 * Elle est reprise de la plateforme de gestion des investissements — le dôme
 * de marque, la carte posée dans sa dissolution, la signature en bas. Deux
 * produits de la même maison doivent s'ouvrir de la même façon.
 *
 * Elle vit ici et non dans chaque page : trois écrans qui recopient le même
 * décor finissent par en avoir trois versions, et c'est le premier écran du
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
  /** Bande de bas de carte — le lien vers l'écran voisin, s'il y en a un. */
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="login-dome flex min-h-dvh flex-col">
      <div aria-hidden className="login-decor" />

      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10">
        <div className="login-monte flex flex-col items-center">
          {/* Le logo se pose en blanc pur : sur le bleu du dôme, ses encres
              d'origine — foncées — disparaîtraient. */}
          <BrandMark variant="connexion" />
          <div className="mt-4 flex items-center gap-3.5">
            <span className="hidden h-px w-11 bg-linear-to-r from-transparent to-white/40 sm:block" />
            <p className="text-center text-[10.5px] font-bold tracking-[0.16em] text-white/[0.78] uppercase">
              Système de Gestion des Ressources Humaines
            </p>
            <span className="hidden h-px w-11 bg-linear-to-r from-white/40 to-transparent sm:block" />
          </div>
        </div>

        <div
          className="login-monte relative mt-7 w-full max-w-[26rem]"
          style={{ '--retard': '0.08s' } as React.CSSProperties}
        >
          {/* Halo doux : il détache la carte du dôme sans lui poser d'ombre
              dure, qui trancherait sur un fond dégradé. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-8 left-1/2 h-64 w-[min(34rem,92vw)] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(255_255_255/0.13),transparent)]"
          />

          {/* Le rayon est celui des cartes de l'application : ces écrans n'ont
              pas de raison d'avoir leur propre rondeur. */}
          <div className="relative overflow-hidden rounded-[14px] border border-card-line bg-surface shadow-[0_30px_70px_rgb(0_0_0/0.28),0_4px_14px_rgb(0_0_0/0.10)]">
            <div className="px-7 pt-8 pb-6 sm:px-8">
              <h1 className="text-center text-2xl font-extrabold tracking-[-0.02em] text-ink-strong">
                {titre}
              </h1>
              {sousTitre ? (
                <p className="mt-1.5 text-center text-[13px] leading-relaxed text-ink-muted">
                  {sousTitre}
                </p>
              ) : null}
              {children}
            </div>

            {pied ? (
              <div className="border-t border-line-soft bg-surface-raised px-7 py-3.5 text-center text-[13px] text-ink-muted sm:px-8">
                {pied}
              </div>
            ) : null}
          </div>
        </div>

        <p
          className="login-monte mt-5 flex max-w-[26rem] items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted"
          style={{ '--retard': '0.2s' } as React.CSSProperties}
        >
          <Icon name="lock" size={13} className="mt-px shrink-0" />
          Accès réservé aux agents de l&apos;APIX disposant d&apos;un compte professionnel
        </p>
      </div>

      <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-6 py-4 text-[11.5px] text-ink-muted sm:px-10">
        <span>© {new Date().getFullYear()} APIX S.A — DCH. Tous droits réservés.</span>
        <span>Plateforme à usage interne</span>
      </footer>
    </main>
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
        'h-11 rounded-lg border-[1.5px] bg-surface-raised pr-3 pl-10 text-[14px]',
        className,
      )}
      {...props}
    />
  );
}

/** L'œil qui dévoile un mot de passe, posé au bout du champ. */
export function BoutonOeil({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      <Icon name={visible ? 'visibility_off' : 'visibility'} size={17} />
    </button>
  );
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
