'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmployeeListItem, OrgUnitView } from '@teranga/contracts';
import { orgUnitLabel } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon, type IconName } from './icons';

/**
 * La palette : tout le produit à portée d'un raccourci.
 *
 * Un tableau de bord répond à « qu'est-ce qui m'attend ? » ; la palette
 * répond à « où est… ? » — un agent, une unité, un écran — sans passer par le
 * menu. Elle s'ouvre par ⌘K partout, et par le champ du bandeau. Les
 * résultats se parcourent au clavier : c'est un outil de main, pas de souris.
 *
 * Trois sources, trois vitesses. Les ÉCRANS sont là, sans requête. Les UNITÉS
 * sont peu nombreuses : on les charge une fois et on filtre sur place. Les
 * AGENTS peuvent être des milliers : on demande au serveur, après une pause
 * dans la frappe, et jamais en deçà de deux caractères.
 */

export interface EcranPalette {
  href: string;
  label: string;
  icon: IconName;
  /** « Absences & Congés › Gestion des demandes » — le chemin qu'on aurait suivi. */
  chemin?: string;
}

type Resultat =
  | {
      type: 'ecran';
      cle: string;
      href: string;
      titre: string;
      detail: string | null;
      icon: IconName;
    }
  | {
      type: 'agent';
      cle: string;
      href: string;
      titre: string;
      detail: string | null;
      initiales: string;
    }
  | {
      type: 'unite';
      cle: string;
      href: string;
      titre: string;
      detail: string | null;
      icon: IconName;
    };

const normaliser = (s: string) =>
  s
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/**
 * Le raccourci tel qu'on l'écrit sur la touche : « ⌘K » sur Mac, « Ctrl K »
 * ailleurs. Décidé après le montage — le serveur ne connaît pas le clavier.
 */
export function useNomDuRaccourci(): string {
  const [mac, setMac] = useState(true);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return mac ? '⌘K' : 'Ctrl K';
}

/** Le raccourci, où que l'on soit : ⌘K sur Mac, Ctrl+K ailleurs. */
export function useRaccourciPalette(ouvrir: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ouvrir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ouvrir]);
}

export function Palette({
  ouverte,
  onFermer,
  ecrans,
  peutChercherLesAgents,
}: {
  ouverte: boolean;
  onFermer: () => void;
  ecrans: EcranPalette[];
  /** Les agents ne se cherchent que depuis un rôle qui a droit à leur liste. */
  peutChercherLesAgents: boolean;
}) {
  const router = useRouter();
  const raccourci = useNomDuRaccourci();
  const [saisie, setSaisie] = useState('');
  const [selection, setSelection] = useState(0);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLUListElement>(null);

  // Une ouverture repart toujours vide et focalisée : on vient chercher
  // quelque chose de nouveau, pas relire la dernière requête.
  useEffect(() => {
    if (!ouverte) return;
    setSaisie('');
    setSelection(0);
    const t = setTimeout(() => champ.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [ouverte]);

  const q = normaliser(saisie.trim());
  const [requete, setRequete] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setRequete(saisie.trim()), 180);
    return () => clearTimeout(t);
  }, [saisie]);

  const agents = useQuery({
    queryKey: ['palette-agents', requete],
    queryFn: () =>
      api<{ items: EmployeeListItem[] }>(`/employees?q=${encodeURIComponent(requete)}&limit=6`),
    enabled: ouverte && peutChercherLesAgents && requete.length >= 2,
    staleTime: 30_000,
  });
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
    enabled: ouverte,
    staleTime: 60_000,
  });

  const resultats = useMemo<Resultat[]>(() => {
    const contient = (texte: string) => q === '' || normaliser(texte).includes(q);
    const ecransTrouves: Resultat[] = ecrans
      .filter((e) => contient(e.label) || (e.chemin ? contient(e.chemin) : false))
      .slice(0, q === '' ? 6 : 5)
      .map((e) => ({
        type: 'ecran',
        cle: `e:${e.href}`,
        href: e.href,
        titre: e.label,
        detail: e.chemin ?? null,
        icon: e.icon,
      }));
    const agentsTrouves: Resultat[] =
      q.length >= 2 && agents.data
        ? agents.data.items.map((a) => ({
            type: 'agent',
            cle: `a:${a.id}`,
            href: `/employees/${a.id}`,
            titre: `${a.givenName} ${a.familyName}`,
            detail: [a.employeeNumber, a.positionTitle, a.directionShortName]
              .filter(Boolean)
              .join(' · '),
            initiales: `${a.givenName[0] ?? ''}${a.familyName[0] ?? ''}`.toUpperCase(),
          }))
        : [];
    const unitesTrouvees: Resultat[] =
      q === ''
        ? []
        : (unites.data ?? [])
            .filter((u) => contient(u.name) || (u.shortName ? contient(u.shortName) : false))
            .slice(0, 5)
            .map((u) => ({
              type: 'unite',
              cle: `u:${u.id}`,
              href: `/organisation?unite=${u.id}`,
              titre: orgUnitLabel(u),
              detail: u.managerName ? `Responsable : ${u.managerName}` : 'Unité de l’organigramme',
              icon: u.unitType === 'direction' ? 'family_history' : 'group',
            }));
    // Les agents d'abord dès qu'on tape un nom : c'est ce qu'on cherche le
    // plus souvent. À vide, les écrans — la palette sert alors de menu rapide.
    return q === '' ? ecransTrouves : [...agentsTrouves, ...unitesTrouvees, ...ecransTrouves];
  }, [q, ecrans, agents.data, unites.data]);

  // La sélection suit la liste : quand elle raccourcit, on ne pointe pas dans
  // le vide.
  useEffect(() => {
    setSelection((s) => Math.min(s, Math.max(0, resultats.length - 1)));
  }, [resultats.length]);

  const ouvrir = useCallback(
    (r: Resultat | undefined) => {
      if (!r) return;
      onFermer();
      router.push(r.href);
    },
    [onFermer, router],
  );

  // L'élément sélectionné reste visible quand on descend au clavier.
  useEffect(() => {
    const el = liste.current?.querySelector<HTMLElement>(`[data-rang="${selection}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  if (!ouverte) return null;

  const enAttente = peutChercherLesAgents && q.length >= 2 && agents.isFetching;
  const groupes: Array<{ type: Resultat['type']; titre: string }> = [
    { type: 'agent', titre: 'Agents' },
    { type: 'unite', titre: 'Unités' },
    { type: 'ecran', titre: 'Écrans' },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--tg-overlay)] px-4 pt-[12vh] backdrop-blur-[6px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher dans l’application"
        className="flex w-full max-w-[600px] flex-col overflow-hidden rounded-[18px] border border-line-soft bg-surface shadow-lg"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            // La palette peut s'ouvrir par-dessus une fenêtre : Échap ne ferme
            // que la couche du dessus. Les fenêtres écoutent Échap sur le
            // document, au même niveau que React : seule l'arrêt IMMÉDIAT de
            // la propagation les empêche de l'entendre.
            e.nativeEvent.stopImmediatePropagation();
            onFermer();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelection((s) => Math.min(s + 1, resultats.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelection((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            ouvrir(resultats[selection]);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4">
          <Icon name="search" size={19} className="shrink-0 text-ink-muted" />
          <input
            ref={champ}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={
              peutChercherLesAgents ? 'Un agent, une unité, un écran…' : 'Une unité, un écran…'
            }
            aria-label="Rechercher"
            // Le champ prend le focus dès qu'il existe : les premières lettres
            // tapées juste après ⌘K lui reviennent, pas à l'écran de dessous.
            autoFocus
            aria-controls="palette-resultats"
            aria-activedescendant={resultats[selection] ? `palette-${selection}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-[52px] min-w-0 flex-1 bg-transparent text-[15px] text-ink-strong placeholder:text-ink-muted/70 focus:outline-none"
          />
          {enAttente ? (
            <span
              aria-hidden
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-primary"
            />
          ) : (
            <kbd className="shrink-0 rounded-[6px] border border-line bg-bg px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-ink-muted">
              esc
            </kbd>
          )}
        </div>

        <ul
          id="palette-resultats"
          ref={liste}
          role="listbox"
          className="max-h-[52vh] overflow-y-auto py-2"
        >
          {resultats.length === 0 ? (
            <li className="px-4 py-8 text-center text-[13px] text-ink-muted">
              {enAttente ? 'Recherche…' : `Rien pour « ${saisie.trim()} ».`}
            </li>
          ) : (
            groupes.map((g) => {
              const lignes = resultats
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.type === g.type);
              if (lignes.length === 0) return null;
              return (
                <li key={g.type} className="px-2 pt-1 pb-1.5">
                  <p className="px-2.5 pb-1 text-[9.5px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
                    {g.titre}
                  </p>
                  <ul role="presentation">
                    {lignes.map(({ r, i }) => {
                      const choisi = i === selection;
                      return (
                        <li
                          key={r.cle}
                          id={`palette-${i}`}
                          role="option"
                          aria-selected={choisi}
                          data-rang={i}
                          onMouseEnter={() => setSelection(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => ouvrir(r)}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors',
                            choisi ? 'bg-primary/[0.08]' : 'hover:bg-hover',
                          )}
                        >
                          {r.type === 'agent' ? (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                              {r.initiales}
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                                choisi ? 'bg-primary/[0.12] text-primary' : 'bg-bg text-ink-muted',
                              )}
                            >
                              <Icon name={r.icon} size={16} />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-ink-strong">
                              {r.titre}
                            </span>
                            {r.detail ? (
                              <span className="block truncate text-[11.5px] text-ink-muted">
                                {r.detail}
                              </span>
                            ) : null}
                          </span>
                          <kbd
                            aria-hidden
                            className={cn(
                              'shrink-0 rounded-[5px] border border-line px-1.5 text-[10.5px] text-ink-muted transition-opacity',
                              choisi ? 'opacity-100' : 'opacity-0',
                            )}
                          >
                            ↵
                          </kbd>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center gap-4 border-t border-line-soft bg-bg px-4 py-2 text-[10.5px] text-ink-muted">
          <span>
            <kbd className="font-sans font-semibold">↑↓</kbd> parcourir
          </span>
          <span>
            <kbd className="font-sans font-semibold">↵</kbd> ouvrir
          </span>
          <span className="ml-auto">
            <kbd className="font-sans font-semibold">{raccourci}</kbd> depuis n’importe où
          </span>
        </div>
      </div>
    </div>
  );
}
