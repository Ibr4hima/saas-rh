'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { CertificateSummary } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { RetourDeLEcran } from '../../../../components/entete';
import { ListeCertificats } from '../../../../components/academy-certificat';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { api } from '../../../../lib/api';
import { useMe } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Mes certificats » : ce qu'on vient chercher quand on vous demande une
   preuve de formation. Ouverte depuis le menu du compte, où qu'on soit.

   Chaque certificat se lit et se télécharge ; il se vérifie par le QR code
   imprimé dessus.
   ———————————————————————————————————————————————————————————————— */

export default function MesCertificatsPage() {
  // Plus en activité : il garde ses certificats, pas le reste de l'Academy.
  const restreint = Boolean(useMe().data?.finDAcces);
  const certificats = useQuery({
    queryKey: ['academy', 'certificats'],
    queryFn: () => api<CertificateSummary[]>('/academy/certificats'),
  });

  return (
    <Page>
      {restreint ? null : <RetourDeLEcran href="/academy" libelle="APIX Academy" />}
      <div className="flex items-baseline gap-3">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Mes certificats
        </h2>
        {certificats.data && certificats.data.length > 0 ? (
          <span className="text-[12px] font-semibold text-ink-muted">
            {compte(certificats.data.length, 'certificat')}
          </span>
        ) : null}
      </div>

      {certificats.isPending ? (
        <Skeleton className="h-[120px] w-full rounded-bloc" />
      ) : certificats.isError ? (
        <LoadFailure error={certificats.error} onRetry={() => void certificats.refetch()} />
      ) : certificats.data.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="workspace_premium" size={22} />}
            title={restreint ? 'Aucun certificat' : 'Pas encore de certificat'}
            description={
              restreint
                ? undefined
                : 'Suivez une formation APIX Academy jusqu’au bout, évaluation comprise s’il y en a une : son certificat apparaîtra ici.'
            }
            action={
              restreint ? undefined : (
                <Link href="/academy">
                  <Button variant="secondary">Parcourir le catalogue</Button>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <Card className="shrink-0 px-5 py-1">
          <ListeCertificats certificats={certificats.data} />
        </Card>
      )}
    </Page>
  );
}
