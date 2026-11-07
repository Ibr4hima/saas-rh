'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { DocumentRequestView } from '@teranga/contracts';
import { depuisLeDossier } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { RetourDeLEcran } from '../../../../../components/entete';
import { Page } from '../../../../../components/gabarit';
import { GenererDesDocuments } from '../../../../../components/generer-des-documents';
import { Icon } from '../../../../../components/icons';
import { LoadFailure } from '../../../../../components/load-failure';
import { api } from '../../../../../lib/api';

/*
   Le document d'une demande de mise en disponibilité, de renouvellement ou
   de domiciliation, généré par qui la traite (ADR-0189) : la page de
   « Générer des documents », pour ce seul document et l'agent qui l'a
   demandé, la fiche préremplie de son dossier et de la date de la demande.
*/

const RETOUR = { href: '/documents', libelle: 'Demandes de documents' };

export default function GenererLeDocumentDeLaDemandePage() {
  const { id } = useParams<{ id: string }>();
  const demande = useQuery({
    queryKey: ['document-requests', 'une', id],
    queryFn: () => api<DocumentRequestView>(`/document-requests/${id}`),
  });

  if (demande.isPending) {
    return (
      <Page>
        <RetourDeLEcran {...RETOUR} />
        <Skeleton className="h-[76px] w-full rounded-bloc" />
        <Skeleton className="h-[420px] w-full rounded-bloc" />
      </Page>
    );
  }
  if (demande.isError) {
    return (
      <Page>
        <RetourDeLEcran {...RETOUR} />
        <LoadFailure error={demande.error} onRetry={() => void demande.refetch()} />
      </Page>
    );
  }

  const d = demande.data;
  const doc = d.docTypes[0];
  // Le lien ne s'offre que pour une demande ouverte, confiée, d'un de ces
  // trois documents ; une adresse tapée à la main tombe ici.
  const refus =
    doc === undefined || !depuisLeDossier(doc)
      ? 'Ce document ne se génère pas au titre d’une demande'
      : !['received', 'processing'].includes(d.status)
        ? 'Cette demande est déjà traitée'
        : !d.canAdvance
          ? 'Cette demande ne vous est pas confiée'
          : null;
  if (refus) {
    return (
      <Page>
        <RetourDeLEcran {...RETOUR} />
        <Card className="mx-auto w-full max-w-xl">
          <EmptyState
            icon={<Icon name="description" size={22} />}
            title={refus}
            action={
              <Link href="/documents">
                <Button size="sm" variant="secondary">
                  Demandes de documents
                </Button>
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <>
      <RetourDeLEcran {...RETOUR} />
      <GenererDesDocuments demande={d} />
    </>
  );
}
