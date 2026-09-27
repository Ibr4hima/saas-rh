'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { CertificateSummary, FormationAnimee } from '@teranga/contracts';
import { Badge, Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../components/academy-carte';
import { ListeCertificats } from '../../../../components/academy-certificat';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { api } from '../../../../lib/api';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Mes certificats » : ce qu'on vient chercher quand on vous demande une
   preuve de formation. Ouverte depuis le menu du compte, où qu'on soit.

   Chaque certificat se lit et se télécharge ; il se vérifie par le QR code
   imprimé dessus. Les formations qu'on a faites soi-même n'en donnent pas :
   elles se lisent à part — on en est le formateur.
   ———————————————————————————————————————————————————————————————— */

export default function MesCertificatsPage() {
  const certificats = useQuery({
    queryKey: ['academy', 'certificats'],
    queryFn: () => api<CertificateSummary[]>('/academy/certificats'),
  });
  const animees = useQuery({
    queryKey: ['academy', 'formations-animees'],
    queryFn: () => api<FormationAnimee[]>('/academy/formations-animees'),
  });

  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />
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
        <Skeleton className="h-[120px] w-full rounded-[16px]" />
      ) : certificats.isError ? (
        <LoadFailure error={certificats.error} onRetry={() => void certificats.refetch()} />
      ) : certificats.data.length === 0 ? (
        // Formateur d'une formation : sa section suit — le vide ne la repousse pas en bas.
        <Card
          className={cn(
            'flex items-center justify-center',
            animees.data && animees.data.length > 0 ? 'shrink-0 py-2' : 'flex-1',
          )}
        >
          <EmptyState
            icon={<Icon name="workspace_premium" size={22} />}
            title="Pas encore de certificat"
            description="Réussissez l’évaluation finale d’une formation APIX Academy : son certificat apparaîtra ici."
            action={
              <Link href="/academy">
                <Button variant="secondary">Parcourir le catalogue</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="shrink-0 px-5 py-1">
          <ListeCertificats certificats={certificats.data} />
        </Card>
      )}

      {animees.data && animees.data.length > 0 ? (
        <>
          <h2 className="mt-2 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Vous en êtes le formateur
          </h2>
          <Card className="shrink-0 px-5 py-1">
            <ul className="flex flex-col">
              {animees.data.map((a) => (
                <li
                  key={a.courseId}
                  className="flex items-center gap-3 border-b border-line-soft py-3 last:border-b-0"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary">
                    <Icon name="school" size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {a.published ? (
                      <Link
                        href={`/academy/${a.courseId}`}
                        className="block truncate text-[13px] font-bold text-ink-strong hover:text-primary"
                      >
                        {a.title}
                      </Link>
                    ) : (
                      <span className="block truncate text-[13px] font-bold text-ink-strong">
                        {a.title}
                      </span>
                    )}
                    <span className="block text-[11.5px] text-ink-muted">
                      Pas de certificat : votre dossier indique que vous l’avez animée.
                    </span>
                  </span>
                  {!a.published ? <Badge tone="neutral">Pas encore publiée</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </Page>
  );
}
