import * as React from 'react';
import { Card, cn } from '@teranga/ui';

/* ————————————————————————————————————————————————————————————————
   Le gabarit : une largeur, une gouttière, une hauteur.

   ONZE largeurs de contenu cohabitaient — 880 px pour l'espace de l'agent,
   1000 pour ses congés, 1152 pour le personnel, 1240 pour le tableau de bord,
   1400 pour l'organigramme. Rien ne le justifiait : c'était l'ordre dans
   lequel les écrans avaient été écrits. À la navigation, le contenu glissait
   de cent trente pixels d'une page à l'autre, et l'œil le voyait sans pouvoir
   le nommer.

   La même enveloppe partout, donc, et elle occupe la HAUTEUR. Six écrans sur
   treize étaient vides à plus de la moitié — 82 % sur les offres d'emploi, 68
   sur les demandes d'absence — parce qu'une carte épouse ses lignes : trois
   lignes laissaient sept cents pixels de fond nu sous elles. Le vide ne
   disparaît pas (il n'y a que trois offres) ; il rentre DANS la carte, sous
   un en-tête qui tient et au-dessus d'un pied qui compte. C'est la différence
   entre un tableau qui attend ses lignes et un écran qu'on a oublié de finir.
   ———————————————————————————————————————————————————————————————— */

/**
 * L'enveloppe de tout écran d'application.
 *
 * `min-h-full` est la pièce maîtresse : la page fait AU MOINS la hauteur du
 * panneau qui défile. Ce qu'elle en fait dépend de ce qu'elle contient — un
 * bloc marqué `flex-1` s'étire jusqu'en bas, les autres restent à leur
 * taille. Une page sans bloc extensible retombe exactement sur l'ancien
 * comportement : la règle n'impose rien, elle rend l'étirement POSSIBLE.
 */
export function Page({
  canevas,
  className,
  children,
}: {
  /**
   * Écran-canevas : l'organigramme, qui n'est pas une page mais un plan à
   * déplier. Lui seul prend toute la largeur offerte — un arbre plafonné à
   * 1240 px se coupe aux deux bords.
   */
  canevas?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mx-auto flex min-h-full w-full flex-col gap-4',
        canevas ? 'max-w-none' : 'max-w-page',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Une carte qui prend la place qui reste.
 *
 * Elle ne grandit pas toute seule : c'est `Page` qui lui donne la hauteur, et
 * `flex-1` qui la lui fait prendre. Son contenu se range en trois étages —
 * en-tête fixe, corps défilant, pied fixe — parce qu'un tableau de deux cents
 * lignes dans une carte étirée doit défiler SOUS ses intitulés de colonne, et
 * non les emporter hors de vue au troisième tour de molette.
 */
export function CartePleine({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)} {...props}>
      {children}
    </Card>
  );
}

/**
 * L'étage du milieu : le seul qui défile.
 *
 * `min-h-0` n'est pas décoratif — sans lui, un enfant flex refuse de
 * rapetisser en deçà de son contenu et la carte déborde au lieu de faire
 * défiler.
 */
export function CorpsDefilant({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn('min-h-0 flex-1 overflow-auto', className)}>{children}</div>;
}

/**
 * Le pied de carte : ce qui ferme le tableau par le bas.
 *
 * Il porte le DÉCOMPTE, qui quittait le titre en même temps : « Personnel
 * actif 3 » sous un bandeau « Gestion du personnel » et un onglet « Actifs 3 »
 * écrivait le même chiffre trois fois dans un même écran. En haut on nomme,
 * en bas on compte.
 */
export function PiedCarte({
  children,
  droite,
  className,
}: {
  children?: React.ReactNode;
  /** Ce qui se pose à l'opposé du décompte — un lien, un bouton discret. */
  droite?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-surface-raised/50 px-5 py-2.5',
        className,
      )}
    >
      <span className="min-w-0 truncate text-[11.5px] font-semibold text-ink-muted">
        {children}
      </span>
      {droite ? <span className="shrink-0">{droite}</span> : null}
    </div>
  );
}

/** « 3 agents », « 1 offre » — le pluriel sans le dire deux fois. */
export function compte(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}
