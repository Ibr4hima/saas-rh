import * as React from 'react';
import { cn } from './cn';

/**
 * Bloc libellé — la façon dont la plateforme APIX affiche une donnée en
 * lecture, et le remplaçant des listes `terme / définition`.
 *
 * Une liste dt/dd donne deux lignes de texte gris et noir qui se ressemblent :
 * l'œil doit relire pour savoir où finit un champ et où commence le suivant.
 * Le bloc, lui, est BORNÉ — un fond de marque à 4 %, un filet à 10 % — et son
 * intitulé est écrit assez petit pour ne jamais concurrencer la valeur. On
 * balaie une fiche de trente champs sans jamais la lire.
 */
export function DataBlock({
  label,
  children,
  full,
  className,
}: {
  label: string;
  children?: React.ReactNode;
  /** Occupe toute la largeur de la grille (adresse, texte long…). */
  full?: boolean;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-primary/10 bg-primary/[0.04] px-3 py-2.5',
        full && 'col-span-full',
        className,
      )}
    >
      <p className="text-[9px] font-extrabold tracking-[0.1em] text-primary uppercase">{label}</p>
      <div
        className={cn(
          'mt-1 text-[12.5px] leading-snug font-semibold break-words',
          empty ? 'text-ink-muted' : 'text-ink-strong',
        )}
      >
        {empty ? '—' : children}
      </div>
    </div>
  );
}

/**
 * Grille de blocs libellés.
 *
 * Le nombre de colonnes suit la largeur du CONTENEUR, jamais celle de l'écran :
 * la même grille sert une carte pleine largeur et un rail latéral de 300 px, et
 * un seuil en `lg:` ferait quatre colonnes dans le rail sur un grand écran —
 * des mots coupés en deux et des intitulés qui se chevauchent. Les requêtes de
 * conteneur (`@container`) posent la question à la bonne échelle.
 */
export function DataGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  /** Seuils supplémentaires — en variantes de conteneur (`@[52rem]:…`). */
  className?: string;
}) {
  return (
    <div className="@container">
      <div
        // Seuils mesurés sur les conteneurs réels : rail d'unité 302 px,
        // carte de l'espace personnel 634 px, colonne de la fiche 607→725 px
        // selon l'écran. Ils tombent au milieu de ces paliers, jamais à 2 px.
        className={cn(
          'grid grid-cols-1 gap-2.5 @[17rem]:grid-cols-2 @[42rem]:grid-cols-3',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
