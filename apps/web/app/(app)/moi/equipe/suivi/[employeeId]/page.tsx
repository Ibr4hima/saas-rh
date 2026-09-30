'use client';

import { use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { FicheSuivi, ObjectifView } from '@teranga/contracts';
import { Button, Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../../lib/api';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import { EnTete, Repere } from '../../../../../../components/fiche';
import { Page } from '../../../../../../components/gabarit';
import { Telephone } from '../../../../../../components/telephone';
import { Icon } from '../../../../../../components/icons';
import {
  CLE_OBJECTIFS,
  FenetreEvaluation,
  FenetreObjectif,
  GestesObjectif,
  LigneObjectif,
} from '../../../../../../components/objectifs';
import { FenetreSuppression } from '../../../../../../components/reglages-absences';

/**
 * La fiche d'un direct : ses objectifs de l'année, que le n+1 fixe — un
 * objectif, ou une formation de l'APIX Academy à suivre —, modifie et évalue.
 */
export default function FicheSuiviPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const router = useRouter();
  const recherche = useSearchParams();
  const queryClient = useQueryClient();
  const [edition, setEdition] = useState<ObjectifView | null>(null);
  const [evaluation, setEvaluation] = useState<ObjectifView | null>(null);
  const [suppression, setSuppression] = useState<ObjectifView | null>(null);

  const fiche = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'equipe', employeeId],
    queryFn: () => api<FicheSuivi>(`/objectifs/equipe/${employeeId}`),
    retry: false,
  });

  // Le « + » du bandeau ouvre la fenêtre : une adresse plutôt qu'un état local.
  const creation = recherche.get('nouveau') === '1';
  const fermerCreation = () => router.replace(`/moi/equipe/suivi/${employeeId}`);

  if (fiche.isLoading) {
    return (
      <Page>
        <Skeleton className="h-20 w-full rounded-[16px]" />
        <Skeleton className="h-48 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (!fiche.data) {
    return (
      <Page>
        <RetourAcademy href="/moi/equipe/suivi" label="Suivi & Évaluation" />
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="groups" size={22} />}
            title="Cet agent ne fait pas partie de votre équipe"
          />
        </Card>
      </Page>
    );
  }

  const { membre: m, objectifs, annee } = fiche.data;
  const nom = `${m.givenName} ${m.familyName}`;
  const cible = { niveau: 'individuel' as const, employeeId, nom };

  return (
    <Page>
      <RetourAcademy href="/moi/equipe/suivi" label="Suivi & Évaluation" />
      {/* La même tête que le dossier du personnel ; à la place du stylo, le
          geste du n+1 — fixer des objectifs. */}
      <EnTete
        titre={nom}
        marque={
          <span role="img" aria-label="Actif" title="Actif" className="inline-flex text-success">
            <Icon name="verified" size={22} />
          </span>
        }
        sousTitre={
          <>
            <span className="font-mono tracking-tight">{m.number}</span>
            {m.positionTitle ? <> · {m.positionTitle}</> : null}
          </>
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.replace(`/moi/equipe/suivi/${employeeId}?nouveau=1`)}
          >
            <Icon name="flag" size={15} />
            Fixer des objectifs
          </Button>
        }
        reperes={
          <>
            <Repere
              label="Direction"
              titre={m.directionName ?? undefined}
              valeur={m.directionShortName ?? m.directionName ?? m.unitName}
            />
            <Repere
              label="Email professionnel"
              titre={m.workEmail ?? undefined}
              valeur={
                m.workEmail ? (
                  <a
                    href={`mailto:${m.workEmail}`}
                    className="break-all transition-colors hover:text-primary hover:underline"
                  >
                    {m.workEmail}
                  </a>
                ) : null
              }
            />
            <Repere
              label="Téléphone professionnel"
              titre={m.workPhone ?? undefined}
              valeur={m.workPhone ? <Telephone valeur={m.workPhone} /> : null}
            />
            <Repere
              label="Téléphone portable"
              titre={m.phone ?? undefined}
              valeur={m.phone ? <Telephone valeur={m.phone} /> : null}
            />
          </>
        }
      />

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Objectifs {annee}</CardTitle>
          {m.total ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted tabular-nums">
              {m.atteints}/{m.total} atteint{m.atteints > 1 ? 's' : ''}
            </span>
          ) : null}
        </CardHeader>
        {objectifs.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<Icon name="flag" size={22} />}
            title="Aucun objectif fixé"
            action={
              <Button
                size="sm"
                onClick={() => router.replace(`/moi/equipe/suivi/${employeeId}?nouveau=1`)}
              >
                <Icon name="add" size={15} />
                Fixer un objectif
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col px-2 pb-2">
            {objectifs.map((o) => (
              <LigneObjectif
                key={o.id}
                objectif={o}
                gestes={
                  <GestesObjectif
                    objectif={o}
                    onEvaluer={() => setEvaluation(o)}
                    onModifier={() => setEdition(o)}
                    onSupprimer={() => setSuppression(o)}
                  />
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {creation ? <FenetreObjectif cible={cible} onClose={fermerCreation} /> : null}
      {edition ? (
        <FenetreObjectif cible={cible} objectif={edition} onClose={() => setEdition(null)} />
      ) : null}
      {evaluation ? (
        <FenetreEvaluation objectif={evaluation} onClose={() => setEvaluation(null)} />
      ) : null}
      {suppression ? (
        <FenetreSuppression
          titre={
            suppression.nature === 'formation' ? 'Retirer la formation' : 'Supprimer l’objectif'
          }
          nom={suppression.titre}
          bouton="Supprimer"
          chemin={`/objectifs/${suppression.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            setSuppression(null);
            void queryClient.invalidateQueries({ queryKey: CLE_OBJECTIFS });
          }}
        >
          <p className="text-[13px] text-ink-muted">Il disparaît des objectifs de {m.givenName}.</p>
        </FenetreSuppression>
      ) : null}
    </Page>
  );
}
