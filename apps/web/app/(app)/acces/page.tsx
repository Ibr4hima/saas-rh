'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AccesAgent, EtatDesAcces, InviterPlusieursResult } from '@teranga/contracts';
import {
  Badge,
  Button,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { LoadFailure } from '../../../components/load-failure';
import { Onglets } from '../../../components/onglets-bandeau';
import { Pagination, usePagination } from '../../../components/pagination';
import {
  BarreSelection,
  LIGNE_COCHEE,
  SqueletteTableau,
  TdCase,
  ThCases,
  useSelection,
} from '../../../components/tableau';
import { api, ApiError } from '../../../lib/api';
import { compte } from '../../../lib/mots';

/*
   « Gestion des accès » : où en est chaque agent avec le portail.

   Qui est entré, qui a une invitation en attente, qui n'en a jamais reçu,
   qui revient sans mot de passe. On coche, on invite d'un coup ; une
   ligne s'invite aussi seule. Au directeur du Capital Humain.
*/

type Filtre = 'tous' | 'actif' | 'invite' | 'sans' | 'coupe';

const FILTRES: { cle: Filtre; label: string; etats: AccesAgent['etat'][] }[] = [
  { cle: 'tous', label: 'Tous', etats: ['actif', 'invite', 'expire', 'jamais', 'ferme', 'coupe'] },
  { cle: 'actif', label: 'Comptes actifs', etats: ['actif'] },
  { cle: 'invite', label: 'Invitations en attente', etats: ['invite'] },
  { cle: 'sans', label: 'Sans accès', etats: ['jamais', 'expire', 'ferme'] },
  { cle: 'coupe', label: 'Accès coupés', etats: ['coupe'] },
];

/** Le mot et le ton de chaque état ; l'orange pour ce qui attend. */
function badgeDe(a: AccesAgent): { ton: 'teal' | 'orange' | 'rouge' | 'gris'; mot: string } {
  switch (a.etat) {
    case 'actif':
      return { ton: 'teal', mot: 'Compte actif' };
    case 'invite':
      return a.courriel === 'echec'
        ? { ton: 'rouge', mot: 'Échec d’envoi' }
        : {
            ton: 'orange',
            mot: a.courriel === 'en_attente' ? 'Envoi en cours' : 'Invitation envoyée',
          };
    case 'expire':
      return { ton: 'gris', mot: 'Invitation expirée' };
    case 'ferme':
      return { ton: 'gris', mot: 'Compte fermé' };
    case 'coupe':
      return { ton: 'rouge', mot: 'Accès coupé' };
    default:
      return { ton: 'gris', mot: 'Aucune invitation' };
  }
}

/** La recherche ignore les accents et la casse : « Ndeye » trouve « Ndèye ». */
const plat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function GestionDesAccesPage() {
  const queryClient = useQueryClient();
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [recherche, setRecherche] = useState('');
  const [bilan, setBilan] = useState<InviterPlusieursResult | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const acces = useQuery({
    queryKey: ['portail-acces'],
    queryFn: () => api<EtatDesAcces>('/portail/acces'),
  });
  const parCourriel = acces.data?.parCourriel ?? false;
  const agents = useMemo(() => acces.data?.agents ?? [], [acces.data]);

  const onglets = FILTRES.map((f) => ({
    cle: f.cle,
    label: f.label,
    compte: agents.filter((a) => f.etats.includes(a.etat)).length,
  }));
  const lignes = useMemo(() => {
    const etats = FILTRES.find((f) => f.cle === filtre)!.etats;
    const q = plat(recherche.trim());
    return agents
      .filter((a) => etats.includes(a.etat))
      .filter(
        (a) =>
          !q || plat(`${a.nom} ${a.matricule} ${a.adresse ?? ''} ${a.unite ?? ''}`).includes(q),
      )
      .map((a) => ({ ...a, id: a.employeeId }));
  }, [agents, filtre, recherche]);
  const { tranche, barre } = usePagination(lignes, `${filtre}|${recherche}`);

  // Ne se cochent que ceux qu'une invitation peut atteindre : un compte qui
  // n'en a pas besoin, ou sans adresse professionnelle, n'a rien à recevoir.
  const invitable = (a: AccesAgent) =>
    parCourriel && a.adresse !== null && a.etat !== 'actif' && a.etat !== 'coupe';
  // Comme pour le personnel : la sélection porte sur la page affichée.
  const invitables = useMemo(() => tranche.filter(invitable), [tranche, parCourriel]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = useSelection(invitables);

  const inviter = useMutation({
    mutationFn: (ids: string[]) =>
      api<InviterPlusieursResult>('/portail/invitations', { method: 'POST', body: { ids } }),
    onSuccess: async (r) => {
      setBilan(r);
      setErreur(null);
      sel.vider();
      await queryClient.invalidateQueries({ queryKey: ['portail-acces'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  const bouton = (a: AccesAgent) => (
    <Button
      size="sm"
      variant="ghost"
      loading={inviter.isPending && inviter.variables?.[0] === a.employeeId}
      onClick={() => inviter.mutate([a.employeeId])}
    >
      {a.etat === 'invite' ? 'Renvoyer' : 'Inviter'}
    </Button>
  );

  if (acces.isError) {
    return <LoadFailure error={acces.error} onRetry={() => void acces.refetch()} />;
  }

  return (
    <Page>
      <div className="mb-3 overflow-x-auto">
        <Onglets
          courant={filtre}
          onChange={(c) => {
            setFiltre(c as Filtre);
            sel.vider();
          }}
          onglets={onglets}
          label="Filtrer les accès"
          className="w-max"
        />
      </div>

      {bilan || erreur ? (
        <div
          role="status"
          className={cn(
            'mb-3 flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[12.5px] leading-5 ring-1 ring-inset',
            erreur
              ? 'bg-danger-soft/55 text-danger ring-danger/25'
              : 'bg-success-soft/55 text-ink ring-success/25',
          )}
        >
          {/* Icône, première ligne et croix sur une même hauteur de 20 px :
              le texte reste au milieu du cadre. */}
          <span className="flex h-5 shrink-0 items-center">
            <Icon
              name={erreur ? 'error' : 'task_alt'}
              size={17}
              className={erreur ? 'text-danger' : 'text-success'}
            />
          </span>
          <div className="min-w-0 flex-1">
            {erreur ? (
              erreur
            ) : bilan ? (
              <>
                <p className="font-semibold text-ink-strong">
                  {compte(bilan.invites.length, 'invitation envoyée', 'invitations envoyées')}
                </p>
                {bilan.refus.map((r) => (
                  <p key={r.employeeId} className="mt-0.5 text-ink-muted">
                    <span className="font-semibold text-ink">{r.nom}</span> : {r.raison}
                  </p>
                ))}
              </>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => {
              setBilan(null);
              setErreur(null);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}

      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <CardTitle>Accès au portail</CardTitle>
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
              />
              <Input
                placeholder="Nom, matricule ou adresse…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                aria-label="Rechercher un agent"
                className="h-8 w-60 max-w-full rounded-full pl-8 text-[12.5px]"
              />
            </div>
          </div>
          <BarreSelection sel={sel} quoi="agent">
            <Button
              size="sm"
              loading={inviter.isPending}
              onClick={() => inviter.mutate(sel.choisis.map((a) => a.employeeId))}
            >
              <Icon name="mail" size={15} />
              Inviter
            </Button>
          </BarreSelection>
        </CardHeader>

        {acces.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : lignes.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState icon={<Icon name="how_to_reg" size={22} />} title="Aucun agent ici" />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                {parCourriel ? <ThCases sel={sel} /> : null}
                <Th>Agent</Th>
                <Th className="hidden md:table-cell">Direction</Th>
                <Th className="hidden lg:table-cell">Adresse professionnelle</Th>
                <Th>État</Th>
                <Th className="hidden w-0 md:table-cell" />
              </tr>
            </THead>
            <TBody>
              {tranche.map((a) => {
                const b = badgeDe(a);
                const peutInviter = invitable(a);
                return (
                  <Tr key={a.id} className={cn(sel.coche(a.id) && LIGNE_COCHEE)}>
                    {parCourriel ? (
                      peutInviter ? (
                        <TdCase sel={sel} id={a.id} quoi={a.nom} />
                      ) : (
                        <Td className="pr-0" />
                      )
                    ) : null}
                    <Td>
                      <Link
                        href={`/employees/${a.employeeId}`}
                        className="font-bold text-ink-strong hover:underline"
                      >
                        {a.nom}
                      </Link>
                      <span className="block font-mono text-[11px] text-ink-muted">
                        {a.matricule}
                      </span>
                    </Td>
                    <Td className="hidden whitespace-nowrap text-ink-muted md:table-cell">
                      {a.unite ?? ''}
                    </Td>
                    <Td className="hidden text-[12.5px] lg:table-cell">
                      {a.adresse ?? <span className="text-ink-muted">Sans adresse pro</span>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={b.ton}>{b.mot}</Badge>
                      {/* Sur téléphone, le geste passe sous l'état : la
                          dernière colonne sortirait de l'écran. */}
                      {peutInviter ? <div className="mt-1.5 md:hidden">{bouton(a)}</div> : null}
                    </Td>
                    <Td className="hidden text-right whitespace-nowrap md:table-cell">
                      {peutInviter ? bouton(a) : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </CartePleine>
      <Pagination
        {...barre}
        onPage={(p) => {
          sel.vider();
          barre.onPage(p);
        }}
      />
    </Page>
  );
}
