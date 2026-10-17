'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { DocumentRequestView, MyEmployeeView } from '@teranga/contracts';
import { documentsEnCours, REQUESTABLE_DOC_LABELS, requestableDocSchema } from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { BlocQuiOuvre } from '../../../../components/fiche';
import { Icon } from '../../../../components/icons';
import { Modal, ModalSection } from '../../../../components/modal';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';

/*
   « Demander un document » : ce que l'agent demande à la Direction du
   Capital Humain, dans la liste de la DCH (ADR-0084). Comme « Poser une
   demande », la page tient en un bloc, et son « + » ouvre la fiche en
   fenêtre : on coche, on envoie. L'avancement se suit dans « Suivi de mes
   demandes » ; ce que l'agent fournit a sa page, « Joindre un document ».
*/

const REQUESTABLE = requestableDocSchema.options;
type Demandable = (typeof REQUESTABLE)[number];

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

export default function DemanderUnDocumentPage() {
  const [ouverte, setOuverte] = useState(false);
  /** Le nombre de documents qui viennent de partir : chacun est une demande. */
  const [envoyes, setEnvoyes] = useState(0);
  // Sans dossier d'agent, rien à demander : la fiche attend de l'avoir lu.
  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });

  return (
    <Page>
      <BlocQuiOuvre
        titre="Demander un document"
        disabled={!moi.data}
        onOuvrir={() => {
          setEnvoyes(0);
          setOuverte(true);
        }}
        envoi={
          envoyes > 0 ? (
            <>
              {envoyes > 1 ? `${envoyes} demandes envoyées.` : 'Demande envoyée.'}{' '}
              <Link href="/moi/documents/suivi" className="underline">
                Suivre mes demandes
              </Link>
            </>
          ) : null
        }
      />

      {ouverte && moi.data ? (
        <FenetreDemandeDocument
          onClose={() => setOuverte(false)}
          onEnvoyee={(n) => {
            setOuverte(false);
            setEnvoyes(n);
          }}
        />
      ) : null}
    </Page>
  );
}

/**
 * La fiche d'une demande de document : les documents qu'on coche, et ce qui
 * part, en toutes lettres.
 */
function FenetreDemandeDocument({
  onClose,
  onEnvoyee,
}: {
  onClose: () => void;
  /** Le nombre de documents partis. */
  onEnvoyee: (n: number) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Demandable[]>([]);
  const [error, setError] = useState<string | null>(null);

  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: { docTypes: selected },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      onEnvoyee(selected.length);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  // Un document déjà demandé, et encore en cours, ne se redemande pas : le
  // serveur le refuse, et la pastille le dit avant. On ne compose pas une
  // demande pour se la voir refuser à l'envoi.
  const enCours = documentsEnCours(docRequests.data ?? []);
  const toggle = (doc: Demandable) => {
    if (enCours.has(doc)) return;
    setSelected(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Demander un document"
      maxWidth="max-w-2xl"
      footer={
        <>
          {error ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {error}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={selected.length === 0}
            loading={submit.isPending}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
          >
            Envoyer ma demande
          </Button>
        </>
      }
    >
      <ModalSection title="Documents">
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
      </ModalSection>

      {/* Ce qui part, en toutes lettres : deux pastilles cochées se lisent
          d'un coup d'œil ; à quatre, relire la ligne est plus sûr que
          recompter les bordures bleues. */}
      {selected.length > 0 ? (
        <p className="px-1 text-[12.5px] leading-snug text-ink">
          <span className="font-semibold text-ink-strong">
            Vous demandez {compte(selected.length, 'document')}
          </span>{' '}
          {/* Les libellés gardent leur majuscule : « et Certificat de
              travail » se lit comme l'entrée cochée, pas comme la suite de
              la phrase. */}
          : {enumerer(selected.map((d) => REQUESTABLE_DOC_LABELS[d]))}.
        </p>
      ) : null}
    </Modal>
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
      {/* Un seul bloc de texte : sur un téléphone, un long libellé passe à
          la ligne aligné à gauche, « · en cours » à sa suite. */}
      <span className="text-left">
        {libelle}
        {enCours ? <span className="ml-1.5 text-[11px] whitespace-nowrap">· en cours</span> : null}
      </span>
    </button>
  );
}
