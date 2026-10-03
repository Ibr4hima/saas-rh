'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObjectifsAPIX, ObjectifView } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../lib/api';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import {
  BoutonIcone,
  CLE_OBJECTIFS,
  FenetreEvaluation,
  FenetreObjectif,
  GestesObjectif,
  LigneObjectif,
  type CibleObjectif,
} from '../../../../components/objectifs';
import { FenetreSuppression } from '../../../../components/reglages-absences';

/**
 * Objectifs de l'APIX — l'écran du directeur général : les orientations de
 * l'agence, diffusées à tous les agents ou aux directeurs seulement, et les
 * objectifs de chaque direction.
 */
export default function ObjectifsAPIXPage() {
  const queryClient = useQueryClient();
  const [creation, setCreation] = useState<CibleObjectif | null>(null);
  const [edition, setEdition] = useState<{ cible: CibleObjectif; objectif: ObjectifView } | null>(
    null,
  );
  const [evaluation, setEvaluation] = useState<ObjectifView | null>(null);
  const [suppression, setSuppression] = useState<ObjectifView | null>(null);

  const vue = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'apix'],
    queryFn: () => api<ObjectifsAPIX>('/objectifs/apix'),
  });

  if (vue.isLoading || !vue.data) {
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-[16px]" />
        <Skeleton className="h-40 w-full rounded-[16px]" />
      </Page>
    );
  }

  const { orientations, directions } = vue.data;
  const apix: CibleObjectif = { niveau: 'apix' };

  return (
    <Page>
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Orientations de l’APIX</CardTitle>
          <BoutonIcone icone="add" label="Nouvelle orientation" onClick={() => setCreation(apix)} />
        </CardHeader>
        {orientations.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={<Icon name="trending_up" size={22} />}
            title="Aucune orientation"
          />
        ) : (
          <ul className="flex flex-col px-2 pb-2">
            {orientations.map((o) => (
              <LigneObjectif
                key={o.id}
                objectif={o}
                gestes={
                  <GestesObjectif
                    objectif={o}
                    onModifier={() => setEdition({ cible: apix, objectif: o })}
                    onSupprimer={() => setSuppression(o)}
                  />
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {directions.map((d) => {
        const cible: CibleObjectif = { niveau: 'direction', directionId: d.id, nom: d.nom };
        const atteints = d.objectifs.filter((o) => o.atteint).length;
        return (
          <Card key={d.id}>
            <CardHeader className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{d.nom}</CardTitle>
                <p className="mt-1 text-[12px] text-ink-muted">
                  {d.directeur ?? 'Sans directeur'}
                  {d.objectifs.length
                    ? ` · ${atteints}/${d.objectifs.length} atteint${atteints > 1 ? 's' : ''}`
                    : ''}
                </p>
              </div>
              <BoutonIcone
                icone="add"
                label={`Nouvel objectif : ${d.nom}`}
                onClick={() => setCreation(cible)}
              />
            </CardHeader>
            {d.objectifs.length ? (
              <ul className="flex flex-col px-2 pb-2">
                {d.objectifs.map((o) => (
                  <LigneObjectif
                    key={o.id}
                    objectif={o}
                    gestes={
                      <GestesObjectif
                        objectif={o}
                        onEvaluer={() => setEvaluation(o)}
                        onModifier={() => setEdition({ cible, objectif: o })}
                        onSupprimer={() => setSuppression(o)}
                      />
                    }
                  />
                ))}
              </ul>
            ) : null}
          </Card>
        );
      })}

      {creation ? <FenetreObjectif cible={creation} onClose={() => setCreation(null)} /> : null}
      {edition ? (
        <FenetreObjectif
          cible={edition.cible}
          objectif={edition.objectif}
          onClose={() => setEdition(null)}
        />
      ) : null}
      {evaluation ? (
        <FenetreEvaluation objectif={evaluation} onClose={() => setEvaluation(null)} />
      ) : null}
      {suppression ? (
        <FenetreSuppression
          titre={suppression.niveau === 'apix' ? 'Supprimer l’orientation' : 'Supprimer l’objectif'}
          nom={suppression.titre}
          bouton="Supprimer"
          chemin={`/objectifs/${suppression.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            setSuppression(null);
            void queryClient.invalidateQueries({ queryKey: CLE_OBJECTIFS });
          }}
        >
          <p className="text-[13px] text-ink-muted">
            {suppression.niveau === 'apix'
              ? 'Elle disparaît des objectifs des agents à qui elle était diffusée.'
              : 'Il disparaît des objectifs des agents de la direction.'}
          </p>
        </FenetreSuppression>
      ) : null}
    </Page>
  );
}
