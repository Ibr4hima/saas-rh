'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { peut, type Capacite, type MembreHabilite } from '@teranga/contracts';
import { Button, Checkbox, cn } from '@teranga/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { Icon } from './icons';
import { Modal } from './modal';
import {
  BandeauDelegation,
  BandeauMessage,
  listePrenoms,
  texteErreur,
  useMembresDCH,
  type Message,
} from './traitement-dch';

/**
 * La gestion du personnel se délègue d'un bloc : tout ce que sa page
 * demande — consulter, gérer, les données sensibles, effacer un dossier, et
 * les soldes de congés, qui se règlent depuis la fiche.
 */
export const CAPACITES_PERSONNEL = [
  'personnel.consulter',
  'personnel.gerer',
  'personnel.sensible',
  'personnel.effacer',
  'conges.soldes',
] as const satisfies readonly Capacite[];

/**
 * Le bandeau d'une page de la DCH qu'un accès ouvre (paramètres des congés,
 * offres d'emploi, organigramme, gestion du personnel…) : au directeur, qui
 * peut — et « Déléguer » ; au membre, ce qui lui est délégué. Rien pour les
 * autres. Plusieurs accès se délèguent ensemble : la gestion du personnel
 * donne tout ce que la page demande.
 */
export function BandeauDeleguer({
  capacite,
  verbe,
  objet,
  delegue,
  retrait,
  titre,
  invitation = 'Vous pouvez déléguer cette tâche à votre équipe.',
  sensible = false,
  fichiers = [],
}: {
  capacite: Capacite | readonly Capacite[];
  /** « gérer » — « Awa peut désormais gérer… ». */
  verbe: string;
  /** « les offres d’emploi ». */
  objet: string;
  /** « la gestion des offres d’emploi » — « La DCH vous a délégué… ». */
  delegue: string;
  /** « Vous gérerez de vous-même les offres d’emploi. » */
  retrait: string;
  titre: string;
  /** Ce que le bandeau dit au directeur tant que personne n'est délégué. */
  invitation?: string;
  /** Des données sensibles : le bandeau le dit, la confirmation aussi. */
  sensible?: boolean;
  fichiers?: readonly string[];
}) {
  const me = useMe();
  const membres = useMembresDCH().data?.membres ?? [];
  const [message, setMessage] = useState<Message>(null);
  const capacites = toutes(capacite);
  const habilites = membres.filter((m) => capacites.every((c) => m.capacites.includes(c)));
  const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);
  const avecPastille = (texte: string) => (
    <>
      {texte}
      {sensible ? <PastilleSensible /> : null}
    </>
  );

  if (me.data?.dirigeLaDCH) {
    return (
      <>
        {message ? <BandeauMessage message={message} /> : null}
        <BandeauDelegation
          icone="arrow_split"
          texte={avecPastille(
            habilites.length > 0
              ? `${listePrenoms(habilites)} ${pluriel(habilites.length, 'peut', 'peuvent')} désormais ${verbe} ${objet}.`
              : invitation,
          )}
          action={
            <DeleguerMembres
              membres={membres}
              capacite={capacite}
              titre={titre}
              confirmation={(retenus) =>
                `${listePrenoms(retenus)} ${pluriel(retenus.length, 'pourra', 'pourront')} ${verbe} désormais ${objet}${sensible ? ', données sensibles comprises' : ''}.`
              }
              retrait={retrait}
              fichiers={fichiers}
              onFait={() => setMessage(null)}
              onErreur={(err) => setMessage({ ton: 'erreur', texte: texteErreur(err) })}
            />
          }
        />
      </>
    );
  }
  if (capacites.every((c) => peut(me.data, c)) && me.data?.role !== 'admin') {
    return (
      <BandeauDelegation
        icone="how_to_reg"
        texte={avecPastille(`La DCH vous a délégué ${delegue}.`)}
      />
    );
  }
  return null;
}

const toutes = (c: Capacite | readonly Capacite[]): readonly Capacite[] =>
  typeof c === 'string' ? [c] : c;

/** « Sensible » — comme sur « Déléguer des tâches ». */
export function PastilleSensible() {
  return (
    <span
      title="Données sensibles : à confier avec soin."
      className="ml-2 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-full bg-surface px-1.5 py-px align-middle text-[10px] font-semibold text-ink-muted ring-1 ring-line-soft ring-inset"
    >
      <Icon name="lock" size={11} />
      Sensible
    </span>
  );
}

/**
 * « Déléguer » une file de la DCH : ses membres, à cocher — ceux qui pourront
 * traiter ces demandes ; le directeur le peut toujours. Décocher retire la
 * délégation. « Valider » demande confirmation, en les nommant, avant de
 * rien changer.
 */
export function DeleguerMembres({
  membres,
  capacite,
  titre,
  confirmation,
  retrait,
  fichiers,
  onFait,
  onErreur,
}: {
  membres: MembreHabilite[];
  /** Plusieurs : délégués ensemble, retirés ensemble. */
  capacite: Capacite | readonly Capacite[];
  /** Le titre de la confirmation — « Déléguer les absences et congés ». */
  titre: string;
  /** Ce que la confirmation dit des membres retenus. */
  confirmation: (retenus: MembreHabilite[]) => string;
  /** Ce qu'elle dit quand plus personne n'est retenu. */
  retrait: string;
  /** Les requêtes de la file, à relire une fois la délégation changée. */
  fichiers: readonly string[];
  /** Le bandeau dit déjà qui peut traiter : pas de message en plus. */
  onFait: () => void;
  onErreur: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const capacites = toutes(capacite);
  // Délégué : il a TOUT ce que la page demande. En partie seulement, il
  // reste à cocher — cocher complète, décocher retire tout.
  const actuels = membres.filter((m) => capacites.every((c) => m.capacites.includes(c)));
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<string[]>([]);
  const [confirmer, setConfirmer] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  // Ouvert, le menu part de l'état réel ; Échap et un clic ailleurs le referment.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('pointerdown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  const avant = new Set(actuels.map((m) => m.employeeId));
  const apres = new Set(choix);
  const change = membres.some((m) => avant.has(m.employeeId) !== apres.has(m.employeeId));
  const retenus = membres.filter((m) => apres.has(m.employeeId));

  const appliquer = useMutation({
    mutationFn: async () => {
      // Un membre à la fois, habilitation par habilitation.
      for (const m of membres) {
        const accordee = apres.has(m.employeeId);
        if (accordee === avant.has(m.employeeId)) continue;
        for (const c of capacites) {
          if (m.capacites.includes(c) === accordee) continue;
          await api('/habilitations', {
            method: 'PUT',
            body: { employeeId: m.employeeId, capacite: c, accordee },
          });
        }
      }
    },
    onSuccess: async () => {
      setConfirmer(false);
      setOuvert(false);
      onFait();
      for (const cle of ['habilitations', ...fichiers, 'validations-compteurs']) {
        await queryClient.invalidateQueries({ queryKey: [cle] });
      }
    },
    onError: (err) => {
      setConfirmer(false);
      onErreur(err);
    },
  });

  return (
    <div ref={racine} className="relative shrink-0">
      <Button
        size="sm"
        variant="secondary"
        aria-haspopup="true"
        aria-expanded={ouvert}
        onClick={() => {
          if (!ouvert) setChoix(actuels.map((m) => m.employeeId));
          setOuvert((o) => !o);
        }}
      >
        Déléguer
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            '-mr-1 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </Button>
      {ouvert ? (
        <div className="tg-menu absolute top-full right-0 z-30 mt-1.5 w-64 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg">
          {membres.length === 0 ? (
            <p className="px-2.5 py-3 text-[12px] text-ink-muted">
              Aucun autre membre dans votre direction.
            </p>
          ) : (
            <ul role="group" aria-label="Membres de la DCH" className="max-h-72 overflow-y-auto">
              {membres.map((m) => {
                const coche = apres.has(m.employeeId);
                return (
                  <li key={m.employeeId}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2.5 transition-colors duration-150',
                        coche ? 'bg-primary/[0.06] hover:bg-primary/[0.09]' : 'hover:bg-hover',
                      )}
                    >
                      <Checkbox
                        checked={coche}
                        onChange={() =>
                          setChoix((c) =>
                            coche ? c.filter((x) => x !== m.employeeId) : [...c, m.employeeId],
                          )
                        }
                        className="size-[18px] [&>span]:rounded-[6px]"
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[13px] transition-colors duration-150',
                          coche ? 'font-semibold text-ink-strong' : 'text-ink',
                        )}
                      >
                        {m.nom}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-1 flex justify-end border-t border-line-soft px-1 pt-1.5">
            <Button
              size="sm"
              disabled={!change}
              onClick={() => {
                setOuvert(false);
                setConfirmer(true);
              }}
            >
              Valider
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmer}
        onClose={() => setConfirmer(false)}
        title={titre}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmer(false)}>
              Annuler
            </Button>
            <Button loading={appliquer.isPending} onClick={() => appliquer.mutate()}>
              Confirmer
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          {retenus.length > 0 ? confirmation(retenus) : retrait}
        </p>
      </Modal>
    </div>
  );
}
