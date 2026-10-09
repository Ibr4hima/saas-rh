'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import {
  documentDemande,
  FICHIERS_REMIS_MAX,
  MAX_FICHIER_REMIS_BYTES,
  TYPES_DE_FICHIER_REMIS,
} from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { enregistrer, lireEnBase64, taille } from '../lib/fichiers';
import { Icon } from './icons';

type TypeRemis = (typeof TYPES_DE_FICHIER_REMIS)[number];

/** Le type d'un fichier choisi : celui que le poste annonce, sinon son extension. */
function typeDuFichier(f: File): TypeRemis | null {
  if ((TYPES_DE_FICHIER_REMIS as readonly string[]).includes(f.type)) return f.type as TypeRemis;
  const ext = f.name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  return null;
}

/** Un nom trop long se coupe avant l'extension, qui dit ce qu'est le fichier. */
function nomDuFichier(nom: string): string {
  if (nom.length <= 200) return nom;
  const point = nom.lastIndexOf('.');
  const ext = point > 0 ? nom.slice(point) : '';
  return nom.slice(0, 200 - ext.length) + ext;
}

/**
 * Les documents remis en ligne d'une demande : qui la traite y dépose le
 * document (« Joindre », ou en y glissant le fichier), le télécharge pour
 * vérifier, retire un mauvais fichier. Chaque geste part aussitôt au
 * serveur : rien ne se perd si la fenêtre se ferme.
 *
 * `lot` : une demande parmi d'autres, en carte, avec le nom de l'agent. Sinon,
 * la demande seule : ses fichiers, puis la zone où les déposer.
 * `attendu` : le dépôt est ce qu'attend la demande pour partir ; tant
 * qu'elle n'a aucun document, « Joindre » est orange.
 */
export function DocumentsDeposes({
  demande: r,
  lot = false,
  attendu = false,
  onErreur,
}: {
  demande: DocumentRequestView;
  lot?: boolean;
  attendu?: boolean;
  onErreur: (texte: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [survol, setSurvol] = useState(false);
  const [lecture, setLecture] = useState<string | null>(null);
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['document-requests'] });

  // Une clé commune : la fenêtre qui les contient attend la fin des envois.
  const deposer = useMutation({
    mutationKey: ['documents-deposes'],
    mutationFn: async (fichiers: File[]) => {
      if (r.fichiers.length + fichiers.length > FICHIERS_REMIS_MAX) {
        throw new Error(
          `Au plus ${FICHIERS_REMIS_MAX} fichiers par demande : regroupez les pages dans un seul PDF.`,
        );
      }
      const prets = fichiers.map((f) => {
        const contentType = typeDuFichier(f);
        if (!contentType) throw new Error(`« ${f.name} » : déposez un PDF, un JPEG ou un PNG.`);
        if (f.size === 0 || f.size > MAX_FICHIER_REMIS_BYTES) {
          throw new Error(`« ${f.name} » dépasse ${taille(MAX_FICHIER_REMIS_BYTES)}.`);
        }
        return { f, contentType };
      });
      for (const { f, contentType } of prets) {
        await api(`/document-requests/${r.id}/fichiers`, {
          method: 'POST',
          body: {
            filename: nomDuFichier(f.name),
            contentType,
            contentBase64: await lireEnBase64(f),
          },
        });
      }
    },
    onSuccess: () => onErreur(null),
    onError: (err) => onErreur(err instanceof Error ? err.message : 'Envoi impossible.'),
    // Le geste ne se termine qu'une fois la liste relue : le fichier apparaît
    // au moment où « Envoi… » disparaît.
    onSettled: rafraichir,
  });

  const retirer = useMutation({
    mutationKey: ['documents-deposes'],
    mutationFn: (fichierId: string) =>
      api(`/document-requests/${r.id}/fichiers/${fichierId}`, { method: 'DELETE' }),
    onSuccess: () => onErreur(null),
    onError: (err) => onErreur(err instanceof ApiError ? err.message : 'Retrait impossible.'),
    onSettled: rafraichir,
  });

  const glisser = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setSurvol(true);
    },
    onDragLeave: () => setSurvol(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setSurvol(false);
      choisir(e.dataTransfer.files);
    },
  };
  const choisir = (liste: FileList | null | undefined) => {
    const fichiers = [...(liste ?? [])];
    if (fichiers.length > 0) deposer.mutate(fichiers);
  };
  const champ = (
    <input
      type="file"
      // Dans un lot, chaque « Joindre » dit pour qui il dépose.
      aria-label={lot ? `Joindre un document pour ${r.employeeName}` : undefined}
      multiple
      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
      className="sr-only"
      onChange={(e) => {
        choisir(e.target.files);
        e.currentTarget.value = '';
      }}
    />
  );

  // Prête et sans point de retrait, la demande garde au moins un document :
  // on dépose d'abord le bon, puis on retire le mauvais.
  const dernierGarde = r.status === 'ready' && !r.pickupContact && r.fichiers.length <= 1;

  const liste =
    r.fichiers.length > 0 ? (
      <ul className="flex flex-col gap-1">
        {r.fichiers.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center gap-2.5">
            <Icon
              name={f.contentType === 'application/pdf' ? 'picture_as_pdf' : 'image'}
              size={17}
              className="shrink-0 text-primary"
            />
            <button
              type="button"
              title={f.filename}
              disabled={lecture === f.id}
              onClick={async () => {
                setLecture(f.id);
                const ok = await enregistrer(
                  `/document-requests/${r.id}/fichiers/${f.id}`,
                  f.filename,
                );
                setLecture(null);
                onErreur(ok ? null : 'Téléchargement impossible, réessayez.');
              }}
              className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-ink-strong hover:text-primary hover:underline disabled:opacity-60"
            >
              {f.filename}
            </button>
            <span className="shrink-0 text-[11.5px] text-ink-muted tabular-nums">
              {taille(f.sizeBytes)}
            </span>
            <button
              type="button"
              aria-label={`Retirer ${f.filename}`}
              title={dernierGarde ? 'Déposez d’abord le bon fichier' : undefined}
              disabled={dernierGarde || (retirer.isPending && retirer.variables === f.id)}
              onClick={() => retirer.mutate(f.id)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-danger disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  if (!lot) {
    return (
      <div className="flex flex-col gap-3">
        {liste}
        <label
          {...glisser}
          aria-disabled={deposer.isPending}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed px-6 py-6 text-center transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/40',
            survol
              ? 'border-primary bg-primary/[0.05]'
              : 'border-line bg-surface-raised hover:border-primary/45 hover:bg-primary/[0.03]',
            deposer.isPending && 'pointer-events-none opacity-60',
          )}
        >
          {champ}
          <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name="upload_file" size={20} />
          </span>
          <span className="text-[12.5px] text-ink">
            {deposer.isPending ? (
              'Envoi…'
            ) : (
              <>
                Glissez vos fichiers ici, ou{' '}
                <span className="font-semibold text-primary underline-offset-2 hover:underline">
                  parcourez
                </span>
              </>
            )}
          </span>
          <span className="text-[11.5px] text-ink-muted">
            PDF, JPEG ou PNG · {taille(MAX_FICHIER_REMIS_BYTES)} maximum
          </span>
        </label>
      </div>
    );
  }

  return (
    <div
      {...glisser}
      className={cn(
        'rounded-[14px] border px-3.5 py-3 transition-colors duration-150',
        survol ? 'border-primary bg-primary/[0.05]' : 'border-line-soft bg-surface',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold text-ink-strong">{r.employeeName}</p>
          <p className="truncate text-[11.5px] text-ink-muted">
            {r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ')}
          </p>
        </div>
        <label
          aria-disabled={deposer.isPending}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-primary/40',
            attendu && r.fichiers.length === 0
              ? 'border-badge-orange-line text-badge-orange-ink hover:bg-accent-soft'
              : 'border-line text-primary hover:border-primary/40 hover:bg-primary/[0.07]',
            deposer.isPending && 'pointer-events-none opacity-60',
          )}
        >
          <Icon name="upload_file" size={15} />
          {deposer.isPending ? 'Envoi…' : 'Joindre'}
          {champ}
        </label>
      </div>
      {liste ? <div className="mt-2.5 border-t border-line-soft pt-2.5">{liste}</div> : null}
    </div>
  );
}
