'use client';

import { useMutation } from '@tanstack/react-query';
import { Button } from '@teranga/ui';
import { enregistrerFichier, lireFichier } from '../../lib/fichiers';
import { messageDe } from '../grille-evaluation';
import { Icon } from '../icons';
import { BOUTON_DU_BANDEAU } from './fiche';

/**
 * Le PDF d'une fiche, enregistré sur le poste depuis le bandeau d'une page :
 * le bouton blanc des gestes du bandeau, l'erreur en clair sur le bleu. La
 * fiche complète chez la DCH (ADR-0221), la version de l'agent chez l'agent
 * (ADR-0268).
 */
export function TelechargerLaFiche({
  chemin,
  nom,
  libelle,
}: {
  /** Le PDF, servi par l'API. */
  chemin: string;
  /** Le nom du fichier enregistré. */
  nom: string;
  libelle: string;
}) {
  const pdf = useMutation({
    mutationFn: () => lireFichier(chemin),
    onSuccess: (contenu) =>
      enregistrerFichier(new Blob([contenu], { type: 'application/pdf' }), nom),
  });
  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <Button className={BOUTON_DU_BANDEAU} loading={pdf.isPending} onClick={() => pdf.mutate()}>
        <Icon name="download" size={17} />
        {libelle}
      </Button>
      {pdf.error ? (
        <p role="alert" className="text-[12px] font-semibold text-[#ffd0c9]">
          {messageDe(pdf.error)}
        </p>
      ) : null}
    </div>
  );
}
