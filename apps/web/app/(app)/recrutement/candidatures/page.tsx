'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { JobPostingView } from '@teranga/contracts';
import {
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api } from '../../../../lib/api';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { CONTRACT_LABELS } from '../../../../lib/recruitment';
import { CartePleine, CorpsDefilant, Page, PiedCarte } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';
import { SqueletteTableau, ThTri, useTriLocal } from '../../../../components/tableau';
import { formatDate } from '../../../../lib/hooks';

/** Le nombre de dossiers reçus, toutes étapes confondues — refus compris. */
function postulants(offre: JobPostingView): number {
  return Object.values(offre.applicationCounts).reduce((n, v) => n + v, 0);
}

/**
 * Les dossiers de candidature, rangés par offre.
 *
 * Une candidature ne se lit pas seule : « Mariama Ba » ne dit rien tant qu'on
 * ignore à quoi elle postule. L'entrée se fait donc par la campagne, et la
 * ligne mène au pipeline où les dossiers vivent.
 */
export default function CandidaturesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });

  const filtrees = useMemo(() => {
    const terme = q.trim().toLowerCase();
    const tout = jobs.data ?? [];
    if (!terme) return tout;
    return tout.filter((o) => `${o.reference} ${o.title}`.toLowerCase().includes(terme));
  }, [jobs.data, q]);

  /**
   * L'ordre des campagnes : les plus FOURNIES d'abord, parce que c'est là
   * qu'il y a du travail. Une offre sans dossier n'appelle rien.
   */
  const tri = useTriLocal(
    filtrees,
    {
      reference: (o) => o.reference,
      // On trie sur l'horodatage COMPLET, pas sur la date affichée : deux
      // offres publiées le même jour gardent leur ordre réel.
      createdAt: (o) => o.createdAt,
      title: (o) => o.title,
      contractType: (o) => CONTRACT_LABELS[o.contractType] ?? o.contractType,
      postulants: (o) => postulants(o),
    },
    { colonne: 'postulants', sens: 'desc' },
    {
      postulants: 'desc',
      // La plus récente d'abord : c'est la campagne qu'on vient d'ouvrir.
      createdAt: 'desc',
      reference: 'asc',
      title: 'asc',
      contractType: 'asc',
    },
  );
  const lignes = tri.lignes;

  if (jobs.isError) {
    return <LoadFailure error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  const total = lignes.reduce((n, o) => n + postulants(o), 0);

  return (
    <Page>
      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <CardTitle>Dossiers de candidature</CardTitle>
          <Input
            placeholder="Rechercher une offre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-52"
            aria-label="Rechercher une offre"
          />
        </CardHeader>
        {jobs.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : lignes.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="person_add" size={22} />}
              title={(jobs.data ?? []).length === 0 ? 'Aucune offre' : 'Aucune offre ne correspond'}
              description={
                (jobs.data ?? []).length === 0
                  ? 'Publiez une offre et partagez son lien : les dossiers déposés se rangeront ici, campagne par campagne.'
                  : 'Changez de recherche pour voir les autres offres.'
              }
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThTri
                  label="Référence"
                  colonne="reference"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Date publication"
                  colonne="createdAt"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Poste"
                  colonne="title"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Type contrat"
                  colonne="contractType"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Postulants"
                  colonne="postulants"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                  droite
                />
                <Th className="w-8" />
              </tr>
            </THead>
            <TBody>
              {lignes.map((o) => {
                const n = postulants(o);
                return (
                  // La ligne entière ouvre le pipeline : c'est le seul geste
                  // de cet écran, il n'a pas à se chercher dans une cellule.
                  <Tr
                    key={o.id}
                    onClick={() => router.push(`/recrutement/${o.id}`)}
                    tabIndex={0}
                    role="link"
                    aria-label={`Voir les dossiers de ${o.title}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/recrutement/${o.id}`);
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  >
                    <Td className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted">
                      {o.reference}
                    </Td>
                    {/* La DATE, et non l'âge : cet écran se lit à côté d'un
                        dossier papier daté, où « il y a 21 jours » ne se
                        recoupe avec rien. Le tableau des offres, lui, garde
                        son ancienneté — on y cherche ce qu'il faut relancer. */}
                    <Td className="whitespace-nowrap text-ink-muted">
                      {formatDate(o.createdAt.slice(0, 10))}
                    </Td>
                    <Td className="font-bold text-ink-strong">{o.title}</Td>
                    <Td className="whitespace-nowrap">
                      {CONTRACT_LABELS[o.contractType] ?? o.contractType}
                    </Td>
                    <Td
                      className={cn(
                        'text-right font-bold',
                        n === 0 ? 'text-ink-muted' : 'text-primary',
                      )}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {n}
                    </Td>
                    <Td className="pl-0 text-right">
                      <Icon name="chevron_right" size={15} className="text-ink-muted/60" />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        {lignes.length > 0 ? (
          <PiedCarte
            droite={
              <span className="text-[11.5px] text-ink-muted">
                {compte(total, 'dossier')} au total
              </span>
            }
          >
            {compte(lignes.length, 'offre')}
          </PiedCarte>
        ) : null}
      </CartePleine>
    </Page>
  );
}
