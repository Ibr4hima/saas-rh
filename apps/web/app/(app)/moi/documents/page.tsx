'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  DocumentDeLaListe,
  DocumentDemandable,
  DocumentParLettre,
  DocumentRequestView,
  MyEmployeeView,
} from '@teranga/contracts';
import {
  aujourdhuiIso,
  documentsEnCours,
  lettreDatee,
  parLettre,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import { Button, cn, Field, Input } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { Icon } from '../../../../components/icons';
import { ChoixDeLaLettre, type LettreChoisie } from '../../../../components/lettre-de-demande';
import { DANS_L_ORDRE, Etape, ListeDesDocuments } from '../../../../components/liste-des-documents';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';

/*
   « Demander un document » : ce que l'agent demande à la Direction du
   Capital Humain, dans la liste de la DCH (ADR-0084). La page tient en un
   bloc, comme « Générer des documents » : on coche un ou plusieurs documents
   dans la liste, on relit ce qui part, on envoie (ADR-0113). La liste n'offre
   que les documents de la cible de l'agent : son contrat, son âge, son genre
   en décident (ADR-0137). L'avancement se suit dans « Suivi de mes
   demandes » ; ce que l'agent fournit a sa page, « Joindre un document ».

   Une mise en disponibilité, son renouvellement et une domiciliation
   bancaire se demandent par lettre (ADR-0189) : l'agent la joint, et, pour
   une décision, donne la date écrite dessus, que la décision cite.
*/

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

export default function DemanderUnDocumentPage() {
  const queryClient = useQueryClient();
  const [choisis, setChoisis] = useState<DocumentDeLaListe[]>([]);
  /** Le nombre de documents qui viennent de partir : chacun est une demande. */
  const [envoyes, setEnvoyes] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  // Les lettres de demande, et la date de celles des décisions (ADR-0189).
  const [lettres, setLettres] = useState<Partial<Record<DocumentParLettre, LettreChoisie>>>({});
  const [datees, setDatees] = useState<Partial<Record<DocumentParLettre, string>>>({});
  const [lettresRefusees, setLettresRefusees] = useState<
    Partial<Record<DocumentParLettre, string>>
  >({});
  // Sans dossier d'agent, rien à demander : la liste attend de l'avoir lu.
  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  // Les documents de sa cible, dans l'ordre de la liste.
  const demandables = useQuery({
    queryKey: ['document-requests', 'demandables'],
    queryFn: () => api<DocumentDemandable[]>('/document-requests/demandables'),
  });
  const demandes = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  // Un document déjà demandé, et encore en cours, ne se redemande pas : le
  // serveur le refuse, et la liste le dit avant. On ne compose pas une
  // demande pour se la voir refuser à l'envoi.
  const enCours = documentsEnCours(demandes.data ?? []);
  // Dans l'ordre de la liste, pas dans l'ordre des clics.
  const retenus = DANS_L_ORDRE.filter((d) => choisis.includes(d));
  // Ceux qui se demandent par lettre : la demande part avec chacune.
  const parLettres = retenus.filter(parLettre);
  const lettresCompletes = parLettres.every(
    (d) => lettres[d] !== undefined && (!lettreDatee(d) || Boolean(datees[d])),
  );

  const envoyer = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: {
          docTypes: retenus,
          ...(parLettres.length > 0
            ? {
                lettres: parLettres.map((doc) => ({
                  doc,
                  filename: lettres[doc]!.filename,
                  contentType: 'application/pdf',
                  contentBase64: lettres[doc]!.contentBase64,
                  ...(lettreDatee(doc) ? { datee: datees[doc] } : {}),
                })),
              }
            : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      setEnvoyes(retenus.length);
      setChoisis([]);
      setLettres({});
      setDatees({});
      setLettresRefusees({});
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  const basculer = (d: DocumentDeLaListe) => {
    setEnvoyes(0);
    setErreur(null);
    setChoisis((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d]));
  };

  return (
    <Page>
      <Etape
        titre="Sélectionner les documents à demander"
        pied={
          retenus.length > 0 ? (
            <>
              {/* La lettre de chaque document qui se demande par lettre, sur
                  une ligne : le document à gauche, la lettre et sa date à
                  droite, sous la liste. */}
              {parLettres.map((doc) => (
                <div
                  key={doc}
                  className="flex flex-col gap-3 border-b border-line-soft px-5 py-4 sm:flex-row sm:items-start sm:gap-5"
                >
                  <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink-strong sm:pt-9">
                    {REQUESTABLE_DOC_LABELS[doc]}
                  </p>
                  <div
                    className={cn(
                      'grid w-full gap-3 sm:w-[23rem] sm:shrink-0',
                      lettreDatee(doc) && 'grid-cols-[minmax(0,1fr)_9.5rem]',
                    )}
                  >
                    <Field
                      label="Lettre de demande"
                      htmlFor={`lettre-${doc}`}
                      required
                      error={lettresRefusees[doc]}
                    >
                      <ChoixDeLaLettre
                        id={`lettre-${doc}`}
                        lettre={lettres[doc] ?? null}
                        invalide={Boolean(lettresRefusees[doc])}
                        onChoisir={(l) => setLettres((s) => ({ ...s, [doc]: l ?? undefined }))}
                        onErreur={(m) =>
                          setLettresRefusees((s) => ({ ...s, [doc]: m ?? undefined }))
                        }
                      />
                    </Field>
                    {lettreDatee(doc) ? (
                      <Field label="Date de la lettre" htmlFor={`datee-${doc}`} required>
                        <Input
                          id={`datee-${doc}`}
                          type="date"
                          value={datees[doc] ?? ''}
                          max={aujourdhuiIso()}
                          onChange={(e) => setDatees((s) => ({ ...s, [doc]: e.target.value }))}
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
                {/* Ce qui part, en toutes lettres et sous le titre des
                  documents : deux choix cochés se lisent d'un coup d'œil ; à
                  quatre, relire la ligne est plus sûr que recompter les cases. */}
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
                  <span className="font-semibold text-ink-strong">
                    Vous demandez {compte(retenus.length, 'document')}
                  </span>{' '}
                  : {enumerer(retenus.map((d) => REQUESTABLE_DOC_LABELS[d]))}.
                </p>
                <Button
                  className="shrink-0 self-end sm:self-auto"
                  loading={envoyer.isPending}
                  disabled={!lettresCompletes}
                  onClick={() => {
                    setErreur(null);
                    envoyer.mutate();
                  }}
                >
                  Envoyer ma demande
                </Button>
              </div>
            </>
          ) : envoyes > 0 ? (
            <p
              role="status"
              className="flex items-start gap-2 px-5 py-3.5 text-[12.5px] font-semibold text-success"
            >
              <Icon name="check_circle" size={15} className="mt-px shrink-0" />
              <span>
                {envoyes > 1 ? `${envoyes} demandes envoyées.` : 'Demande envoyée.'}{' '}
                <Link href="/moi/documents/suivi" className="underline">
                  Suivre mes demandes
                </Link>
              </span>
            </p>
          ) : null
        }
      >
        <ListeDesDocuments
          libelle="Documents à demander"
          invite="Choisir un ou plusieurs documents"
          documents={demandables.data ?? []}
          multiple
          resume={(n) => compte(n, 'document')}
          choisis={choisis}
          mention={(d) => (enCours.has(d) ? 'En cours' : null)}
          onChoisir={basculer}
          disabled={!moi.data || !demandables.data}
        />
      </Etape>
      {erreur ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
        >
          {erreur}
        </p>
      ) : null}
    </Page>
  );
}
