'use client';

import { useQuery } from '@tanstack/react-query';
import type { MesObjectifs, ObjectifView } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../lib/api';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { CLE_OBJECTIFS, LigneObjectif } from '../../../../components/objectifs';

/**
 * Mes objectifs : ce que l'agent doit atteindre cette année — les
 * orientations de l'APIX qui lui sont diffusées, les objectifs de sa
 * direction, et les siens, fixés par son n+1.
 */
export default function MesObjectifsPage() {
  const mes = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'moi'],
    queryFn: () => api<MesObjectifs>('/objectifs/moi'),
  });

  if (mes.isLoading || !mes.data) {
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-[16px]" />
        <Skeleton className="h-40 w-full rounded-[16px]" />
      </Page>
    );
  }

  const { apix, direction, individuels, annee } = mes.data;
  const rien = apix.length === 0 && !direction?.objectifs.length && individuels.length === 0;

  return (
    <Page>
      {rien ? (
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="flag" size={22} />}
            title={`Aucun objectif pour ${annee}`}
          />
        </Card>
      ) : null}
      {individuels.length ? (
        <Section titre="Mes objectifs" objectifs={individuels} auteur lienFormation />
      ) : null}
      {direction?.objectifs.length ? (
        <Section titre={direction.nom} objectifs={direction.objectifs} />
      ) : null}
      {apix.length ? (
        <Section titre="Orientations de l’APIX" objectifs={apix} compteur={false} />
      ) : null}
    </Page>
  );
}

function Section({
  titre,
  objectifs,
  auteur,
  lienFormation,
  compteur = true,
}: {
  titre: string;
  objectifs: ObjectifView[];
  auteur?: boolean;
  lienFormation?: boolean;
  /** Combien sont atteints — les orientations de l'APIX ne se comptent pas. */
  compteur?: boolean;
}) {
  const atteints = objectifs.filter((o) => o.atteint).length;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>{titre}</CardTitle>
        {compteur ? (
          <span className="shrink-0 text-[11.5px] text-ink-muted tabular-nums">
            {atteints}/{objectifs.length} atteint{atteints > 1 ? 's' : ''}
          </span>
        ) : null}
      </CardHeader>
      <ul className="flex flex-col px-2 pb-2">
        {objectifs.map((o) => (
          <LigneObjectif key={o.id} objectif={o} auteur={auteur} lienFormation={lienFormation} />
        ))}
      </ul>
    </Card>
  );
}
