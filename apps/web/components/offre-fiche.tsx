'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { Icon, type IconName } from './icons';

/**
 * Les pièces communes de la fiche d'une offre.
 *
 * Elles étaient écrites dans la page publique de candidature. La page interne
 * de l'offre montre EXACTEMENT les mêmes faits à la RH qu'au candidat — une
 * seconde écriture, c'était deux rendus de la même description qui finissent
 * par diverger.
 */

/** « 1 octobre 2026 » — une date qu'on lit, pas un ISO qu'on déchiffre. */
export function jourFr(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Jours pleins d'ici la date limite — négatif une fois celle-ci passée. */
export function joursRestants(iso: string): number {
  const jour = 86_400_000;
  const fin = new Date(`${iso}T00:00:00`).getTime();
  const auj = new Date(new Date().toDateString()).getTime();
  return Math.round((fin - auj) / jour);
}

/**
 * L'âge de l'offre, en une durée nue — l'intitulé porte déjà « publiée il y
 * a ». Au-delà d'une semaine on cesse de compter en jours : « il y a 34
 * jours » demande un calcul mental que « il y a 5 semaines » épargne.
 */
export function anciennete(iso: string): string {
  const jours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (jours === 0) return "moins d'un jour";
  if (jours === 1) return '1 jour';
  if (jours < 7) return `${jours} jours`;
  const semaines = Math.floor(jours / 7);
  if (jours < 61) return semaines === 1 ? '1 semaine' : `${semaines} semaines`;
  return `${Math.floor(jours / 30)} mois`;
}

/**
 * La description telle qu'on l'a tapée, rendue telle qu'on l'a pensée.
 *
 * La RH écrit ses missions en tirets, comme dans un traitement de texte. Sortie
 * en `whitespace-pre-wrap`, la liste garde ses tirets mais perd ses retraits :
 * une ligne qui passe à la suivante repart contre la marge et l'on ne sait plus
 * où finit un point ni où commence le suivant. On reconnaît donc les blocs de
 * puces et on les rend comme des puces — sans rien demander de plus à la RH.
 */
export function DescriptionOffre({ texte }: { texte: string }) {
  const blocs = useMemo(
    () =>
      texte
        .split(/\n{2,}/)
        .map((bloc) => bloc.split('\n').filter((l) => l.trim().length > 0))
        .filter((lignes) => lignes.length > 0)
        .map((lignes) => {
          const puces = lignes.every((l) => /^\s*[-–—•*]\s+/.test(l));
          return puces
            ? { type: 'liste' as const, items: lignes.map((l) => l.replace(/^\s*[-–—•*]\s+/, '')) }
            : { type: 'texte' as const, texte: lignes.join('\n') };
        }),
    [texte],
  );

  return (
    <div className="flex flex-col gap-3.5">
      {blocs.map((bloc, i) =>
        bloc.type === 'liste' ? (
          <ul key={i} className="flex flex-col gap-2">
            {bloc.items.map((item, j) => (
              <li key={j} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink">
                <span
                  aria-hidden
                  className="mt-[8px] size-1.5 shrink-0 rounded-full bg-primary/45"
                />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-[13.5px] leading-relaxed whitespace-pre-line text-ink">
            {bloc.texte}
          </p>
        ),
      )}
    </div>
  );
}

/** Un fait de l'offre : une icône, un intitulé, une valeur. */
export function FaitOffre({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon name={icon} size={18} className="mt-px shrink-0 text-primary/70" />
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug font-semibold text-ink-strong">
          {children}
        </p>
      </div>
    </div>
  );
}
