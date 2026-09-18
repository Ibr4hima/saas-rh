'use client';

import Link from 'next/link';
import { Button, Card, cn, EmptyState } from '@teranga/ui';
import { ApiError } from '../lib/api';
import { Icon } from './icons';

/**
 * Échec de chargement — partagé par tous les écrans qui ouvrent une ressource.
 *
 * Une phrase rouge posée seule sur le fond dit « panne » sans dire quoi faire,
 * et ne se distingue pas d'un écran vide. Le même cartouche que les états vides
 * remet l'échec dans le vocabulaire de l'application : ce qui manque, pourquoi,
 * et le geste suivant.
 *
 * Un cas n'est PAS une panne et se reconnaît au code renvoyé par l'API : un
 * compte d'administration n'a pas de dossier employé, donc les écrans de
 * l'espace personnel ne le concernent pas. Ni rouge, ni « Réessayer » — un
 * chemin de retour.
 */
export function LoadFailure({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  /** Relance la requête ; omis quand rien ne peut être retenté utilement. */
  onRetry?: () => void;
  className?: string;
}) {
  const problem = error instanceof ApiError ? error.problem : null;

  if (problem?.code === 'me.no_employee_record') {
    return (
      <Card className={cn('mx-auto max-w-xl', className)}>
        <EmptyState
          icon={<Icon name="badge" size={22} />}
          title="Aucun dossier employé relié à ce compte"
          description="Ce compte gère l'organisation sans y être lui-même employé : cet écran de l'espace personnel ne le concerne pas."
          action={
            <Link href="/dashboard">
              <Button size="sm" variant="secondary">
                Retour au tableau de bord
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <Card className={cn('mx-auto max-w-xl', className)}>
      <EmptyState
        icon={<Icon name="error" size={22} />}
        title={problem?.title ?? 'Chargement impossible'}
        description={
          problem?.detail ??
          "Le contenu n'a pas pu être chargé. Vérifiez votre connexion, puis réessayez."
        }
        action={
          onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Réessayer
            </Button>
          ) : null
        }
      />
    </Card>
  );
}
