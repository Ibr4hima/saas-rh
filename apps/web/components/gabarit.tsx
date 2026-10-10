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

   La même enveloppe partout, donc. Elle a longtemps occupé aussi toute la
   HAUTEUR : la carte d'un tableau s'étirait jusqu'en bas de l'écran, et trois
   lignes y laissaient six cents pixels de blanc. Décision APIX : une carte
   suit son contenu. Le vide redevient le fond de la page, et un long tableau
   fait défiler la page comme avant — l'étirement ne l'avait jamais fait
   défiler dans sa carte.

   La carte a longtemps porté un PIED, qui comptait ses lignes. Il est parti
   avec les décomptes : l'onglet les dit déjà, et la pagination du personnel
   vit sous la carte — elle navigue entre les pages, elle n'appartient pas au
   tableau qu'elle feuillette.
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
 * La carte d'un tableau, d'une liste : elle suit son contenu.
 *
 * Son contenu se range en étages — en-tête, corps, pied. `etiree` la fait
 * prendre toute la hauteur qui reste, pour les rares écrans qui ne sont pas
 * des listes : l'organigramme, un plan qu'on parcourt ; un module à venir,
 * centré dans la page.
 */
export function CartePleine({
  etiree,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { etiree?: boolean }) {
  return (
    <Card
      className={cn('flex min-h-0 flex-col overflow-hidden', etiree && 'flex-1', className)}
      {...props}
    >
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
