'use client';

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { Button, Card, EmptyState } from '@teranga/ui';
import { lireFichier } from '../../lib/fichiers';
import { messageDe } from '../grille-evaluation';
import { Icon } from '../icons';
import { PdfEnLargeur } from '../pdf-viewer';

/**
 * Une fiche en PDF, telle que « Valider » la montre, à la largeur de la
 * page, comme un document généré : la partie de l'agent, avant de la
 * transmettre au N+1 (ADR-0241), ou la fiche que remplit le N+1, avant de
 * la transmettre à l'agent (ADR-0260). Le PDF suit ce que montre la saisie,
 * enregistré ou non : `corps` part en POST à `chemin`, et rien ne
 * s'enregistre.
 */
export function ApercuEnPdf({
  chemin,
  corps,
  cle,
  titre,
}: {
  chemin: string;
  corps: unknown;
  /** Où ranger le PDF dans le cache ; la saisie s'y ajoute. */
  cle: QueryKey;
  titre: string;
}) {
  const pdf = useQuery({
    queryKey: [...cle, 'apercu', corps],
    queryFn: ({ signal }) => lireFichier(chemin, { signal, corps }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (pdf.isError) {
    return (
      <Card>
        <EmptyState
          className="py-12"
          icon={<Icon name="error" size={22} />}
          title={messageDe(pdf.error, 'Impossible d’afficher la fiche')}
          action={
            <Button size="sm" variant="secondary" onClick={() => void pdf.refetch()}>
              Réessayer
            </Button>
          }
        />
      </Card>
    );
  }
  if (pdf.data) return <PdfEnLargeur data={pdf.data} titre={titre} />;
  // Une feuille blanche, le temps que le PDF arrive : rien ne saute à son arrivée.
  return (
    <div className="grid aspect-[595/842] place-items-center rounded-bloc bg-white shadow-xs ring-1 ring-card-line">
      <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}
