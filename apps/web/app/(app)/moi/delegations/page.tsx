'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Capacite, MembreHabilite } from '@teranga/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Skeleton,
} from '@teranga/ui';
import {
  TYPES_DOCUMENTS,
  TYPES_PIECES,
  type TypeDelegable,
} from '../../../../components/deleguer-documents';
import { CAPACITES_PERSONNEL } from '../../../../components/deleguer-membres';
import { Page } from '../../../../components/gabarit';
import { Icon, type IconName } from '../../../../components/icons';
import {
  BandeauDelegation,
  BandeauMessage,
  texteErreur,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { api } from '../../../../lib/api';

/* ————————————————————————————————————————————————————————————————
   « Déléguer des tâches » — tout ce que la DCH délègue, sur une page.

   Une ligne par page de Gestion RH, et sa liste des agents de la DCH : en
   cocher un, c'est l'autoriser ; le directeur garde toujours la main. Le
   « i » dit ce que la délégation permettra de faire.
   Les documents se délèguent type par type. On coche, on décoche, puis on
   enregistre — d'un coup.

   Chaque page porte aussi son propre « Déléguer » : ici, on voit tout.
   ———————————————————————————————————————————————————————————————— */

/** Une page, et ce que la déléguer donne — ou ses types, un par un. */
type Ligne = {
  cle: string;
  libelle: string;
  /** Ce que la délégation permettra de faire — derrière le « i ». */
  description: string;
  icone: IconName;
  sensible?: boolean;
} & ({ capacites: readonly Capacite[] } | { types: readonly TypeDelegable[] });

const SECTIONS: { titre: string; lignes: Ligne[] }[] = [
  {
    titre: 'Personnel',
    lignes: [
      {
        cle: 'personnel',
        description:
          'Le délégué pourra consulter et gérer les dossiers du personnel : créer, modifier, muter ou désactiver un agent, importer des dossiers, accéder aux données sensibles et ajuster les soldes de congés.',
        libelle: 'Gestion du personnel',
        icone: 'group',
        sensible: true,
        capacites: CAPACITES_PERSONNEL,
      },
      {
        cle: 'contrats',
        description:
          'Le délégué suivra les CDD et les stages qui arrivent à leur terme et recevra les alertes d’échéance, pour préparer à temps un renouvellement ou une fin de contrat.',
        libelle: 'Échéances de contrat',
        icone: 'schedule',
        capacites: ['contrats.echeances'],
      },
      {
        cle: 'organigramme',
        description:
          'Le délégué pourra créer, modifier et réorganiser les directions et les départements de l’organigramme, et en désigner les responsables.',
        libelle: 'Gestion de l’organigramme',
        icone: 'family_history',
        capacites: ['organigramme'],
      },
    ],
  },
  {
    titre: 'Demandes',
    lignes: [
      {
        cle: 'conges',
        description:
          'Le délégué sera chargé de valider ou non l’ensemble des demandes d’absence ou de congé des agents, conformément au circuit de validation.',
        libelle: 'Absences & Congés',
        icone: 'free_cancellation',
        capacites: ['demandes.conges'],
      },
      {
        cle: 'documents',
        description:
          'Le délégué traitera les demandes de documents des agents pour les types qui lui sont confiés : préparer le document, puis indiquer à l’agent où le retirer.',
        libelle: 'Demandes de documents',
        icone: 'folder_managed',
        types: TYPES_DOCUMENTS,
      },
      {
        cle: 'informations',
        description:
          'Le délégué examinera les changements d’informations signalés par les agents (adresse, téléphone, situation familiale…) : il les applique au dossier, ou les refuse avec un motif.',
        libelle: 'Mise à jour d’infos',
        icone: 'badge',
        capacites: ['demandes.informations'],
      },
      {
        cle: 'pieces',
        description:
          'Le délégué vérifiera les documents officiels déposés par les agents pour les types qui lui sont confiés : il les ajoute au dossier, ou les refuse avec un motif.',
        libelle: 'Vérification des documents',
        icone: 'verified_user',
        sensible: true,
        types: TYPES_PIECES,
      },
    ],
  },
  {
    titre: 'Congés',
    lignes: [
      {
        cle: 'parametres',
        description:
          'Le délégué pourra créer et modifier les types d’absence : jours autorisés, fréquence, décompte du solde et justificatif demandé.',
        libelle: 'Paramètres des congés',
        icone: 'settings',
        capacites: ['conges.parametres'],
      },
      {
        cle: 'feries',
        description:
          'Le délégué tiendra le calendrier des jours fériés : dater les fêtes mobiles, ajouter ou retirer un jour férié.',
        libelle: 'Gestion des jours fériés',
        icone: 'event',
        capacites: ['feries'],
      },
    ],
  },
  {
    titre: 'Recrutement',
    lignes: [
      {
        cle: 'offres',
        description:
          'Le délégué pourra rédiger, publier et clôturer les offres d’emploi de l’APIX.',
        libelle: 'Offres d’emploi',
        icone: 'business_center',
        capacites: ['recrutement.offres'],
      },
      {
        cle: 'candidatures',
        description:
          'Le délégué consultera les dossiers de candidature reçus — CV et pièces jointes — et les fera avancer dans le recrutement.',
        libelle: 'Dossiers de candidature',
        icone: 'person_add',
        sensible: true,
        capacites: ['recrutement.candidatures'],
      },
    ],
  },
];

/** Ce qui se coche d'un geste : une page, ou un type de document. */
const UNITES: (readonly Capacite[])[] = SECTIONS.flatMap((s) =>
  s.lignes.flatMap((l) => ('types' in l ? l.types.map((t) => [t.capacite]) : [l.capacites])),
);

const cle = (capacite: Capacite, employeeId: string) => `${capacite}:${employeeId}`;

export default function DelegationsPage() {
  const queryClient = useQueryClient();
  const etat = useMembresDCH();
  const d = etat.data;
  const membres = useMemo(() => d?.membres ?? [], [d?.membres]);
  const modifiable = Boolean(d?.estDirecteur);
  const [message, setMessage] = useState<Message>(null);

  // Ce qui est délégué aujourd'hui, et ce que la page en fait — tant qu'on
  // n'a rien touché, c'est la même chose.
  const actuel = useMemo(
    () => new Set(membres.flatMap((m) => m.capacites.map((c) => cle(c, m.employeeId)))),
    [membres],
  );
  const [brouillon, setBrouillon] = useState<Set<string> | null>(null);
  const choix = brouillon ?? actuel;

  const coche = (capacites: readonly Capacite[], m: MembreHabilite, dans = choix) =>
    capacites.every((c) => dans.has(cle(c, m.employeeId)));

  /**
   * Cocher donne tout ce que la ligne demande ; décocher le retire — sauf à
   * qui n'en avait qu'une partie : il la retrouve telle qu'elle était.
   */
  const basculer = (capacites: readonly Capacite[], m: MembreHabilite) => {
    setMessage(null);
    const n = new Set(choix);
    const etaitPlein = coche(capacites, m, actuel);
    const allume = !coche(capacites, m);
    for (const c of capacites) {
      const k = cle(c, m.employeeId);
      if (allume || (!etaitPlein && actuel.has(k))) n.add(k);
      else n.delete(k);
    }
    setBrouillon(n);
  };

  const changements = useMemo(() => {
    const liste: { capacite: Capacite; employeeId: string; accordee: boolean }[] = [];
    for (const m of membres) {
      for (const c of new Set(UNITES.flat())) {
        const k = cle(c, m.employeeId);
        if (actuel.has(k) !== choix.has(k)) {
          liste.push({ capacite: c, employeeId: m.employeeId, accordee: choix.has(k) });
        }
      }
    }
    return liste;
  }, [membres, actuel, choix]);
  // Ce que la personne a changé, compté comme elle l'a fait : une pastille.
  const nbChangees = membres.reduce(
    (n, m) => n + UNITES.filter((u) => coche(u, m, actuel) !== coche(u, m)).length,
    0,
  );

  const enregistrer = useMutation({
    mutationFn: async () => {
      // Un changement à la fois : chacun l'apprend par sa propre notification.
      for (const ch of changements) {
        await api('/habilitations', { method: 'PUT', body: ch });
      }
    },
    onSuccess: () => setMessage({ ton: 'ok', texte: 'Délégations enregistrées.' }),
    onError: (err) => setMessage({ ton: 'erreur', texte: texteErreur(err) }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['habilitations'] });
      await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
      setBrouillon(null);
    },
  });

  if (etat.isLoading) {
    return (
      <Page>
        <Card className="shrink-0 p-5">
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      </Page>
    );
  }

  if (!d?.direction) {
    return (
      <Page>
        <Card className="shrink-0">
          <EmptyState
            className="py-12"
            icon={<Icon name="family_history" size={22} />}
            title="Aucune Direction du Capital Humain désignée"
            action={
              <Link
                href="/organisation"
                className="text-[12.5px] font-semibold text-primary hover:underline"
              >
                Désigner la DCH dans l’organigramme
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}
      {!modifiable ? (
        <BandeauDelegation
          icone="lock"
          texte="Seule la personne qui dirige la DCH modifie les délégations."
        />
      ) : null}

      {membres.length === 0 ? (
        <Card className="shrink-0">
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title="Aucun autre agent dans votre direction"
          />
        </Card>
      ) : (
        SECTIONS.map((section) => (
          <Card key={section.titre} className="shrink-0">
            <CardHeader>
              <CardTitle>{section.titre}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col divide-y divide-line-soft px-5 pb-1">
              {section.lignes.map((l) => (
                <li key={l.cle} className="py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                    <EnTete ligne={l} />
                    {'capacites' in l ? (
                      <ChoixDelegues
                        libelle={l.libelle}
                        membres={membres}
                        coche={(m) => coche(l.capacites, m)}
                        onBasculer={(m) => basculer(l.capacites, m)}
                        modifiable={modifiable}
                      />
                    ) : null}
                  </div>
                  {'types' in l ? (
                    <ul className="mt-3 flex flex-col gap-2 md:ml-[46px]">
                      {l.types.map((t) => (
                        <li
                          key={t.capacite}
                          className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-6"
                        >
                          <span className="min-w-0 flex-1 text-[12.5px] text-ink">{t.libelle}</span>
                          <ChoixDelegues
                            libelle={t.libelle}
                            membres={membres}
                            coche={(m) => coche([t.capacite], m)}
                            onBasculer={(m) => basculer([t.capacite], m)}
                            modifiable={modifiable}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      {/* Enregistrer d'un coup ce qu'on a coché : la barre ne paraît qu'à
          la première modification. */}
      {modifiable && nbChangees > 0 ? (
        <div className="sticky bottom-24 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border border-card-line bg-surface py-1.5 pr-1.5 pl-4 shadow-lg md:bottom-5">
          <span
            className="text-[12.5px] whitespace-nowrap text-ink"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {nbChangees} modification{nbChangees > 1 ? 's' : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={enregistrer.isPending}
            onClick={() => setBrouillon(null)}
          >
            Annuler
          </Button>
          <Button size="sm" loading={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
            Enregistrer
          </Button>
        </div>
      ) : null}
    </Page>
  );
}

/** Le nom de la page, son icône — et « Sensible » quand il le faut. */
function EnTete({ ligne: l }: { ligne: Ligne }) {
  return (
    // Au téléphone, l'infobulle s'ouvre sur toute la largeur de l'en-tête.
    <span className="relative flex min-w-0 flex-1 items-center gap-3">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-primary/[0.07] text-primary">
        <Icon name={l.icone} size={17} />
      </span>
      <span className="min-w-0 text-[13px] font-semibold text-ink-strong">
        {l.libelle}
        <span className="ml-2">
          <Info libelle={l.libelle} texte={l.description} />
        </span>
        {l.sensible ? (
          <span
            title="Données sensibles : à confier avec soin."
            className="ml-2 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-full bg-surface px-1.5 py-px align-middle text-[10px] font-semibold text-ink-muted ring-1 ring-line-soft ring-inset"
          >
            <Icon name="lock" size={11} />
            Sensible
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Qui est délégué : une liste déroulante des agents de la DCH, à cocher. Le
 * bouton dit qui l'est déjà ; « Enregistrer », en bas, applique le tout.
 */
function ChoixDelegues({
  libelle,
  membres,
  coche,
  onBasculer,
  modifiable,
}: {
  libelle: string;
  membres: MembreHabilite[];
  coche: (m: MembreHabilite) => boolean;
  onBasculer: (m: MembreHabilite) => void;
  modifiable: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
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

  const retenus = membres.filter(coche);
  const resume =
    retenus.length === 0
      ? null
      : retenus.length <= 2
        ? retenus.map((m) => m.nom).join(', ')
        : `${retenus
            .slice(0, 2)
            .map((m) => m.prenom)
            .join(', ')} +${retenus.length - 2}`;

  return (
    <div ref={racine} className="relative w-full shrink-0 md:w-72">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-label={`Délégués : ${libelle}`}
        disabled={!modifiable}
        onClick={() => setOuvert((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-[10px] border bg-surface pr-2 pl-3 text-left text-[12.5px] transition-colors duration-150',
          'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
          'disabled:cursor-default disabled:opacity-70',
          ouvert ? 'border-primary' : 'border-line enabled:hover:border-ink-muted/40',
        )}
      >
        {resume ? (
          <>
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-primary/[0.1] text-[10px] font-bold text-primary">
              {retenus.length}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">{resume}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink-muted">Personne</span>
        )}
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            'shrink-0 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </button>
      {ouvert ? (
        <div className="tg-menu absolute top-full right-0 left-0 z-30 mt-1.5 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg">
          <ul role="group" aria-label={`Qui : ${libelle}`} className="max-h-72 overflow-y-auto">
            {membres.map((m) => {
              const oui = coche(m);
              return (
                <li key={m.employeeId}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-150',
                      oui ? 'bg-primary/[0.06] hover:bg-primary/[0.09]' : 'hover:bg-hover',
                    )}
                  >
                    <Checkbox
                      checked={oui}
                      onChange={() => onBasculer(m)}
                      className="size-[18px] [&>span]:rounded-[6px]"
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[13px]',
                        oui ? 'font-semibold text-ink-strong' : 'text-ink',
                      )}
                    >
                      {m.nom}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Le « i » d'une tâche : ce que la déléguer permettra de faire. */
function Info({ libelle, texte }: { libelle: string; texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span
      className="inline-flex align-middle md:relative"
      onMouseEnter={() => setOuvert(true)}
      onMouseLeave={() => setOuvert(false)}
    >
      <button
        type="button"
        aria-label={`À propos : ${libelle}`}
        aria-expanded={ouvert}
        // Au doigt, le survol n'existe pas : toucher ouvre, toucher ailleurs ferme.
        onClick={() => setOuvert(true)}
        onBlur={() => setOuvert(false)}
        className="grid size-[18px] place-items-center rounded-full text-ink-muted ring-1 ring-line ring-inset transition-colors duration-150 hover:bg-primary/[0.07] hover:text-primary hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      >
        <Icon name="info_i" size={13} weight={500} />
      </button>
      {ouvert ? (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 z-40 mt-2 w-72 -translate-x-1/2 rounded-[12px] border border-card-line bg-surface px-3.5 py-3 text-[12px] leading-relaxed font-normal text-ink shadow-lg max-md:right-0 max-md:left-0 max-md:w-auto max-md:translate-x-0"
        >
          {texte}
        </span>
      ) : null}
    </span>
  );
}
