'use client';

import * as React from 'react';
import { Checkbox, cn, Skeleton, Td, Th } from '@teranga/ui';
import { accorde, compte } from '../lib/mots';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le socle des tableaux.

   Quatorze tableaux dans neuf écrans, et ce qui leur était COMMUN était
   recopié : la colonne de cases à cocher (le même bloc de vingt lignes,
   trois fois), la logique de sélection (bascule, tout basculer, l'état
   indéterminé — trois fois), la barre d'action qui annonce « N
   sélectionnés » (trois fois, avec deux accords différents). Le tri, lui,
   n'existait qu'à un seul endroit : le personnel. Une colonne qui se trie
   ici et pas là n'est pas une économie, c'est une règle qu'on ne peut plus
   apprendre.

   Ce n'est pas un moteur de tableau. Les cellules de ce produit portent des
   liens, des badges, des délais colorés, des infobulles : une API de
   colonnes aurait enfermé ce JSX dans des objets, et l'écran serait devenu
   illisible pour économiser des balises. Ce sont donc des PIÈCES — la
   colonne de cases, l'en-tête qui trie, la barre de sélection, l'export —
   que les écrans assemblent en gardant leur JSX explicite.
   ———————————————————————————————————————————————————————————————— */

/* ——————————————————————— La sélection ——————————————————————— */

export interface Selection<T> {
  /** Les lignes cochées ET encore présentes — voir la note ci-dessous. */
  choisis: T[];
  coche: (id: string) => boolean;
  bascule: (id: string) => void;
  toutBasculer: () => void;
  vider: () => void;
  /** Toutes les lignes visibles sont cochées (et il y en a au moins une). */
  tout: boolean;
  /** Une partie seulement : la case d'en-tête est alors indéterminée. */
  partiel: boolean;
}

/**
 * Cocher des lignes, et savoir lesquelles.
 *
 * `choisis` se RECALCULE à partir des lignes affichées au lieu de se
 * mémoriser : après une action groupée, la liste se recharge sans les
 * dossiers traités, et une sélection gardée en mémoire désignerait des
 * lignes qui n'existent plus — d'où des barres d'action qui comptent des
 * fantômes. On garde les identifiants, on croise à chaque rendu.
 */
export function useSelection<T extends { id: string }>(lignes: T[]): Selection<T> {
  const [ids, setIds] = React.useState<string[]>([]);
  const choisis = React.useMemo(() => lignes.filter((l) => ids.includes(l.id)), [lignes, ids]);
  return {
    choisis,
    coche: (id) => ids.includes(id),
    bascule: (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    toutBasculer: () =>
      setIds((s) =>
        lignes.length > 0 && choisis.length === lignes.length ? [] : lignes.map((l) => l.id),
      ),
    vider: () => setIds([]),
    tout: lignes.length > 0 && choisis.length === lignes.length,
    partiel: choisis.length > 0 && choisis.length < lignes.length,
  };
}

/** La case d'en-tête : tout cocher, tout relâcher. */
export function ThCases<T>({ sel }: { sel: Selection<T> }) {
  return (
    <Th className="w-9 pr-0">
      <Checkbox
        aria-label="Tout sélectionner"
        checked={sel.tout}
        indeterminate={sel.partiel}
        onChange={sel.toutBasculer}
      />
    </Th>
  );
}

/**
 * La case d'une ligne.
 *
 * `quoi` complète « Sélectionner … » pour les lecteurs d'écran : sans lui,
 * trente cases annoncent trente fois la même chose.
 */
export function TdCase<T>({ sel, id, quoi }: { sel: Selection<T>; id: string; quoi: string }) {
  return (
    // Le clic ne REMONTE pas : sur les listes dont la ligne entière ouvre une
    // fiche, cocher une case emmenait sur la fiche, et l'on perdait la
    // sélection qu'on était en train de faire. La garde appartient au socle,
    // pas à chaque écran qui s'en souviendra ou non.
    <Td className="pr-0" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        aria-label={`Sélectionner ${quoi}`}
        checked={sel.coche(id)}
        onChange={() => sel.bascule(id)}
      />
    </Td>
  );
}

/**
 * La gouttière de la colonne de cases, sans la case.
 *
 * Deux tableaux empilés dans le même écran — la file à traiter, puis
 * l'historique — dont un seul se sélectionne : sans cale, leurs premières
 * colonnes démarraient à trente-deux pixels d'écart, et deux tableaux
 * identiques par ailleurs se lisaient de travers.
 */
export function ThGouttiere() {
  return <Th className="w-9 pr-0" />;
}

export function TdGouttiere() {
  return <Td className="pr-0" />;
}

/** La teinte d'une ligne cochée — pour que le regard retrouve ce qu'il a pris. */
export const LIGNE_COCHEE = 'bg-primary/[0.04]';

/**
 * La barre d'action d'une sélection.
 *
 * Elle n'existe QUE pendant la sélection : au repos, des boutons désactivés
 * en permanence ne feraient que du bruit. Et elle porte un bouton de
 * relâche — sans lui, on décoche à la main ce qu'on a coché d'un geste.
 */
export function BarreSelection<T>({
  sel,
  quoi,
  pluriel,
  feminin,
  children,
}: {
  sel: Selection<T>;
  quoi: string;
  pluriel?: string;
  /** « 2 offres sélectionnées » : le genre ne se devine pas d'un nom commun. */
  feminin?: boolean;
  children?: React.ReactNode;
}) {
  const n = sel.choisis.length;
  if (n === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11.5px] font-semibold text-ink-muted">
        {compte(n, quoi, pluriel)} {accorde(n, 'sélectionné', feminin)}
      </span>
      {children}
      <button
        type="button"
        onClick={sel.vider}
        className="rounded-full px-2 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        Relâcher
      </button>
    </div>
  );
}

/* ——————————————————————— Le tri ——————————————————————— */

export type Sens = 'asc' | 'desc';

/**
 * Un en-tête qui trie.
 *
 * La flèche n'apparaît que sur la colonne active : trois flèches grises en
 * permanence ne diraient plus laquelle commande l'ordre à l'écran. Le bouton
 * remplit toute la cellule — on vise un intitulé de colonne, pas cinq
 * caractères.
 */
export function ThTri<C extends string>({
  label,
  colonne,
  courant,
  sens,
  onTrier,
  className,
  droite,
}: {
  label: string;
  colonne: C;
  courant: C;
  sens: Sens;
  onTrier: (c: C) => void;
  className?: string;
  /** Colonne de nombres : l'intitulé se range à droite, comme les chiffres. */
  droite?: boolean;
}) {
  const actif = courant === colonne;
  return (
    <Th
      className={cn('p-0', className)}
      aria-sort={actif ? (sens === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onTrier(colonne)}
        className={cn(
          'flex w-full items-center gap-1 px-3.5 py-[11px] tracking-[0.12em] uppercase transition-colors',
          'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
          droite ? 'justify-end text-right' : 'text-left',
          actif ? 'text-primary' : 'text-ink-muted hover:text-ink',
        )}
      >
        {droite ? <FlecheTri actif={actif} sens={sens} /> : null}
        {label}
        {droite ? null : <FlecheTri actif={actif} sens={sens} />}
      </button>
    </Th>
  );
}

function FlecheTri({ actif, sens }: { actif: boolean; sens: Sens }) {
  return (
    <Icon
      name="chevron_right"
      size={13}
      aria-hidden
      className={cn(
        'shrink-0 transition-[transform,opacity] duration-150',
        actif ? 'opacity-100' : 'opacity-0',
        sens === 'asc' ? '-rotate-90' : 'rotate-90',
      )}
    />
  );
}

/**
 * Le tri en mémoire, pour les tableaux qui tiennent dans une réponse.
 *
 * Le personnel se trie au SERVEUR — il se pagine, et trier la page affichée
 * trierait un échantillon. Partout ailleurs la liste est entière : on la
 * trie ici, sans aller-retour.
 *
 * Deux règles dans le comparateur, et elles comptent :
 *   — le VIDE va toujours en dernier, dans les deux sens. Une fin de contrat
 *     non renseignée n'est pas « avant 1970 » : elle est absente, et une
 *     absence ne se classe pas, elle se met de côté.
 *   — les textes se comparent en français, accents et casse neutralisés :
 *     sans quoi « Élise » se rangerait après « Zoé ».
 */
export function useTriLocal<T, C extends string>(
  lignes: T[],
  cles: Record<C, (l: T) => string | number | null | undefined>,
  // `NoInfer` : le paramètre de type se déduit des CLÉS du dictionnaire, pas
  // de la colonne de départ. Sans lui, TypeScript l'inférait du littéral
  // `{ colonne: 'createdAt' }` et refusait ensuite toutes les autres
  // colonnes du même tableau.
  depart: { colonne: NoInfer<C>; sens?: Sens },
  /**
   * Le sens NATUREL de chaque colonne au premier clic : un nom se lit de A à
   * Z, une ancienneté de la plus longue à la plus courte, un retard du plus
   * grand au plus petit. Sans cela, cliquer « Temps écoulé » remonterait
   * d'abord les demandes arrivées à l'instant — l'inverse de ce qu'on
   * cherchait en cliquant.
   */
  premierSens?: Partial<Record<NoInfer<C>, Sens>>,
): { lignes: T[]; colonne: C; sens: Sens; trier: (c: C) => void } {
  const [colonne, setColonne] = React.useState<C>(depart.colonne);
  const [sens, setSens] = React.useState<Sens>(depart.sens ?? 'asc');

  const triees = React.useMemo(() => {
    const lire = cles[colonne];
    const signe = sens === 'asc' ? 1 : -1;
    return [...lignes].sort((a, b) => {
      const x = lire(a);
      const y = lire(b);
      const xVide = x === null || x === undefined || x === '';
      const yVide = y === null || y === undefined || y === '';
      if (xVide || yVide) return xVide && yVide ? 0 : xVide ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * signe;
      return String(x).localeCompare(String(y), 'fr', { sensitivity: 'base' }) * signe;
    });
    // `cles` est un objet littéral recréé à chaque rendu de l'appelant : le
    // mettre en dépendance relancerait le tri à chaque frappe ailleurs dans
    // l'écran. La colonne et le sens suffisent à décrire ce qui change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, colonne, sens]);

  return {
    lignes: triees,
    colonne,
    sens,
    // Le même en-tête inverse le sens ; un autre en-tête repart au sens
    // naturel de SA donnée — un nom se lit de A à Z, une date de la plus
    // récente à la plus ancienne. C'est l'appelant qui l'a dit au départ.
    trier: (c: C) => {
      if (c === colonne) return setSens((s) => (s === 'asc' ? 'desc' : 'asc'));
      setColonne(c);
      setSens(premierSens?.[c] ?? 'asc');
    },
  };
}

/* ——————————————————————— Le chargement ——————————————————————— */

/**
 * L'attente d'un tableau, toujours la même.
 *
 * Trois écrans montraient trois attentes différentes — un bloc de 96 px,
 * cinq barres, un rectangle plein. Un produit n'a qu'une façon d'attendre.
 */
export function SqueletteTableau({ lignes = 6 }: { lignes?: number }) {
  return (
    <div className="flex flex-col gap-2.5 px-5 py-4">
      {Array.from({ length: lignes }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full shrink-0" />
      ))}
    </div>
  );
}

/* ——————————————————————— L'export ——————————————————————— */

/**
 * Le tableau à l'écran, dans un fichier.
 *
 * La RH exporte : c'est le geste qui finit une liste — pour la joindre à un
 * dossier, la faire viser, la porter en réunion. Trois détails décident si
 * le fichier s'ouvre correctement à Dakar :
 *   — le SÉPARATEUR est le point-virgule. Excel en configuration française
 *     range une ligne séparée par des virgules dans une seule colonne.
 *   — le BOM UTF-8 en tête, sans quoi « Ndiaye Aïssatou » s'ouvre en
 *     « NdiayeÂ AÃ¯ssatou ».
 *   — les fins de ligne CRLF, que les vieux tableurs attendent encore.
 */
export function exporterCSV(nom: string, entetes: string[], lignes: (string | number | null)[][]) {
  const cellule = (v: string | number | null) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texte =
    '﻿' + [entetes, ...lignes].map((r) => r.map(cellule).join(';')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([texte], { type: 'text/csv;charset=utf-8' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `${nom}-${new Date().toISOString().slice(0, 10)}.csv`;
  lien.click();
  // Révoqué au tour suivant : révoqué tout de suite, le téléchargement part
  // sur une URL déjà morte dans certains navigateurs.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Le bouton qui déclenche l'export, à sa place : le pied du tableau. */
export function BoutonExport({ onClick, quoi }: { onClick: () => void; quoi: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Exporter ${quoi} au format CSV`}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <Icon name="download" size={14} />
      Exporter
    </button>
  );
}
