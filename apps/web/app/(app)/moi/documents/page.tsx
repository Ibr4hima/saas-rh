'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { DocumentRequestView, RequestableDoc } from '@teranga/contracts';
import { documentsEnCours, REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Field, Input } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { Icon } from '../../../../components/icons';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Demander un document » — ce que l'agent DEMANDE à la Direction du
   Capital Humain (attestation, contrat, bulletin) : il coche, il envoie.
   L'avancement se suit dans « Suivi de mes demandes » ; ce qu'il FOURNIT a
   sa page, « Joindre un document ».
   ———————————————————————————————————————————————————————————————— */

const REQUESTABLE: RequestableDoc[] = [
  'attestation_travail',
  'attestation_stage',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
];

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

export default function MyDocumentsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<RequestableDoc[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Le nombre de documents qui viennent de partir — chacun est une demande. */
  const [sent, setSent] = useState(0);

  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: { docTypes: selected, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      setSelected([]);
      setNote('');
      setError(null);
      setSent(selected.length);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  const demandes = docRequests.data ?? [];
  // Un document déjà demandé, et encore en cours, ne se redemande pas : le
  // serveur le refuse, la pastille le dit avant — l'agent ne compose pas
  // une demande pour se la voir rejeter à l'envoi.
  const enCours = documentsEnCours(demandes);
  const toggle = (doc: RequestableDoc) => {
    if (enCours.has(doc)) return;
    setSent(0);
    setSelected(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);
  };

  return (
    <Page>
      <Card>
        <CardHeader>
          <CardTitle>Demander un document</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {REQUESTABLE.map((doc) => (
              <ChoixDocument
                key={doc}
                libelle={REQUESTABLE_DOC_LABELS[doc]}
                choisi={selected.includes(doc)}
                enCours={enCours.has(doc)}
                onToggle={() => toggle(doc)}
              />
            ))}
          </div>

          <Field label="Précision" htmlFor="doc-note">
            <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {/* ———— Ce qui part, en toutes lettres ————
              Deux pastilles cochées se lisent d'un coup d'œil ; à quatre,
              relire la ligne est plus sûr que recompter les bordures bleues. */}
          {selected.length > 0 ? (
            <p className="text-[12.5px] leading-snug text-ink">
              <span className="font-semibold text-ink-strong">
                Vous demandez {compte(selected.length, 'document')}
              </span>{' '}
              {/* Les libellés gardent leur majuscule : « et autre document »
                  en bas de casse se lit comme une phrase inachevée, alors
                  que « et Autre document » se lit comme l'entrée cochée. */}
              : {enumerer(selected.map((d) => REQUESTABLE_DOC_LABELS[d]))}.
            </p>
          ) : null}
        </CardContent>

        {/* ———— L'envoi ———— */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line-soft px-5 py-4">
          {error ? (
            <p
              role="alert"
              className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-danger"
            >
              <Icon name="error" size={15} className="mt-px shrink-0" />
              {error}
            </p>
          ) : sent ? (
            <p
              role="status"
              className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-success"
            >
              <Icon name="check_circle" size={15} className="mt-px shrink-0" />
              <span>
                {sent > 1 ? `${sent} demandes envoyées.` : 'Demande envoyée.'}{' '}
                <Link href="/moi/documents/suivi" className="underline">
                  Suivre mes demandes
                </Link>
              </span>
            </p>
          ) : null}
          <Button
            disabled={selected.length === 0}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Envoyer ma demande
          </Button>
        </div>
      </Card>
    </Page>
  );
}

/**
 * Une pastille de choix.
 *
 * L'ancienne collait un « ✓ » devant le libellé : la pastille s'allongeait au
 * clic et toute la ligne se réorganisait. La coche vit maintenant dans un
 * rond de taille fixe, présent coché comme décoché — rien ne bouge, et l'état
 * ne tient pas qu'à la couleur du bord. `aria-pressed` le dit aux lecteurs
 * d'écran, à qui la bordure bleue n'apprend rien.
 */
function ChoixDocument({
  libelle,
  choisi,
  enCours,
  onToggle,
}: {
  libelle: string;
  choisi: boolean;
  /** Déjà demandé, et pas encore prêt : il ne se redemande pas. */
  enCours: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      disabled={enCours}
      title={enCours ? 'Déjà demandé : la demande est en cours de traitement.' : undefined}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] transition-colors duration-150',
        enCours
          ? 'cursor-default border-line-soft text-ink-muted'
          : choisi
            ? 'border-primary bg-primary-soft font-semibold text-primary'
            : 'border-line text-ink hover:border-ink-muted/40 hover:bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          // Un carré arrondi, PAS un rond : le rond promet un choix
          // exclusif, alors qu'on coche ici autant de documents qu'on veut.
          'flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150',
          choisi ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
        )}
      >
        {choisi ? <Icon name="check" size={11} /> : null}
      </span>
      {libelle}
      {enCours ? <span className="text-[11px]">· en cours</span> : null}
    </button>
  );
}
