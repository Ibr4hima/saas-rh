'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Capacite, MembreHabilite } from '@teranga/contracts';
import { Button, Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import {
  ChoixMembre,
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

   Une ligne par page de Gestion RH, les agents de la DCH en pastilles : la
   cocher, c'est autoriser l'agent ; le directeur garde toujours la main.
   Les documents se délèguent type par type. On coche, on décoche, puis on
   enregistre — d'un coup.

   Chaque page porte aussi son propre « Déléguer » : ici, on voit tout.
   ———————————————————————————————————————————————————————————————— */

/** Une page, et ce que la déléguer donne — ou ses types, un par un. */
type Ligne = {
  cle: string;
  libelle: string;
  icone: IconName;
  sensible?: boolean;
} & ({ capacites: readonly Capacite[] } | { types: readonly TypeDelegable[] });

const SECTIONS: { titre: string; lignes: Ligne[] }[] = [
  {
    titre: 'Personnel',
    lignes: [
      {
        cle: 'personnel',
        libelle: 'Gestion du personnel',
        icone: 'group',
        sensible: true,
        capacites: CAPACITES_PERSONNEL,
      },
      {
        cle: 'contrats',
        libelle: 'Échéances de contrat',
        icone: 'schedule',
        capacites: ['contrats.echeances'],
      },
      {
        cle: 'organigramme',
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
        libelle: 'Absences & Congés',
        icone: 'free_cancellation',
        capacites: ['demandes.conges'],
      },
      {
        cle: 'documents',
        libelle: 'Demandes de documents',
        icone: 'folder_managed',
        types: TYPES_DOCUMENTS,
      },
      {
        cle: 'informations',
        libelle: 'Mise à jour d’infos',
        icone: 'badge',
        capacites: ['demandes.informations'],
      },
      {
        cle: 'pieces',
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
        libelle: 'Paramètres des congés',
        icone: 'settings',
        capacites: ['conges.parametres'],
      },
      {
        cle: 'feries',
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
        libelle: 'Offres d’emploi',
        icone: 'business_center',
        capacites: ['recrutement.offres'],
      },
      {
        cle: 'candidatures',
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
                      <Pastilles
                        libelle={l.libelle}
                        membres={membres}
                        coche={(m) => coche(l.capacites, m)}
                        onBasculer={(m) => basculer(l.capacites, m)}
                        modifiable={modifiable}
                      />
                    ) : null}
                  </div>
                  {'types' in l ? (
                    <ul className="mt-3 flex flex-col gap-2.5 md:ml-[46px]">
                      {l.types.map((t) => (
                        <li
                          key={t.capacite}
                          className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6"
                        >
                          <span className="text-[12.5px] text-ink md:w-[calc(20rem-46px)] md:shrink-0">
                            {t.libelle}
                          </span>
                          <Pastilles
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
    <span className="flex min-w-0 items-center gap-3 md:w-80 md:shrink-0">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-primary/[0.07] text-primary">
        <Icon name={l.icone} size={17} />
      </span>
      <span className="min-w-0 text-[13px] font-semibold text-ink-strong">
        {l.libelle}
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

function Pastilles({
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
  return (
    <div
      role="group"
      aria-label={`Qui : ${libelle}`}
      className="flex min-w-0 flex-1 flex-wrap gap-2"
    >
      {membres.map((m) => (
        <ChoixMembre
          key={m.employeeId}
          nom={m.nom}
          choisi={coche(m)}
          onBasculer={() => onBasculer(m)}
          desactive={!modifiable}
        />
      ))}
    </div>
  );
}
