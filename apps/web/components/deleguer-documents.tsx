'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  capaciteDeLaPiece,
  capaciteDuDocument,
  DOCUMENT_CATEGORY_LABELS,
  REQUESTABLE_DOC_LABELS,
  type Capacite,
  type DocumentCategory,
  type MembreHabilite,
  type RequestableDoc,
} from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';
import { Modal } from './modal';
import { texteErreur } from './traitement-dch';

/* ————————————————————————————————————————————————————————————————
   « Déléguer » type par type : une fenêtre, un type de document par ligne,
   et pour chacun les membres de la DCH qui peuvent le traiter — les
   demandes de documents, et la vérification des documents officiels.

   Déléguer autorise, sans rien retirer : le directeur traite toujours tout.
   Décocher retire la délégation. « Autre document » n'y figure pas — il
   reste au directeur.
   ———————————————————————————————————————————————————————————————— */

/** Un type qui se délègue à part : son libellé, son habilitation. */
export interface TypeDelegable {
  libelle: string;
  capacite: Capacite;
}

/** Les documents qu'un agent demande, « Autre document » mis à part. */
export const DOCUMENTS_DELEGABLES = [
  'attestation_travail',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
] as const satisfies readonly RequestableDoc[];

/** Les documents officiels qu'un agent dépose. */
export const PIECES_DELEGABLES = [
  'cni',
  'passeport',
  'diplome',
  'certification',
  'attestation_travail',
  'attestation_stage',
  'cv',
] as const satisfies readonly DocumentCategory[];

export const TYPES_DOCUMENTS: readonly TypeDelegable[] = DOCUMENTS_DELEGABLES.map((d) => ({
  libelle: REQUESTABLE_DOC_LABELS[d],
  capacite: capaciteDuDocument(d),
}));

export const TYPES_PIECES: readonly TypeDelegable[] = PIECES_DELEGABLES.map((c) => ({
  libelle: DOCUMENT_CATEGORY_LABELS[c],
  capacite: capaciteDeLaPiece(c),
}));

const cle = (capacite: Capacite, employeeId: string) => `${capacite}:${employeeId}`;

/** Qui peut traiter quoi, aujourd'hui : `<habilitation>:<membre>`. */
export function delegationsDe(
  types: readonly TypeDelegable[],
  membres: readonly MembreHabilite[],
): Set<string> {
  return new Set(
    types.flatMap((t) =>
      membres
        .filter((m) => m.capacites.includes(t.capacite))
        .map((m) => cle(t.capacite, m.employeeId)),
    ),
  );
}

/** Les demandes de documents, document par document. */
export function DeleguerDocuments(props: { membres: MembreHabilite[]; onFait: () => void }) {
  return (
    <DeleguerParType
      {...props}
      types={TYPES_DOCUMENTS}
      titre="Déléguer les demandes de documents"
      fichiers={['document-requests']}
    />
  );
}

/** La vérification des documents officiels, type par type. */
export function DeleguerPieces(props: { membres: MembreHabilite[]; onFait: () => void }) {
  return (
    <DeleguerParType
      {...props}
      types={TYPES_PIECES}
      titre="Déléguer la vérification des documents"
      fichiers={['pieces']}
    />
  );
}

function DeleguerParType({
  membres,
  types,
  titre,
  fichiers,
  onFait,
}: {
  membres: MembreHabilite[];
  types: readonly TypeDelegable[];
  titre: string;
  fichiers: readonly string[];
  onFait: () => void;
}) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  const actuelles = delegationsDe(types, membres);
  const changements = types.flatMap((t) =>
    membres
      .filter(
        (m) =>
          actuelles.has(cle(t.capacite, m.employeeId)) !== choix.has(cle(t.capacite, m.employeeId)),
      )
      .map((m) => ({ capacite: t.capacite, m })),
  );

  const basculer = (k: string) =>
    setChoix((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const appliquer = useMutation({
    mutationFn: async () => {
      // Un changement à la fois : chaque membre l'apprend par sa notification.
      for (const { capacite, m } of changements) {
        await api('/habilitations', {
          method: 'PUT',
          body: {
            employeeId: m.employeeId,
            capacite,
            accordee: choix.has(cle(capacite, m.employeeId)),
          },
        });
      }
    },
    onSuccess: () => {
      setOuvert(false);
      onFait();
    },
    onError: (err) => setErreur(texteErreur(err)),
    onSettled: async () => {
      for (const q of ['habilitations', ...fichiers, 'validations-compteurs']) {
        await queryClient.invalidateQueries({ queryKey: [q] });
      }
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => {
          setChoix(delegationsDe(types, membres));
          setErreur(null);
          setOuvert(true);
        }}
      >
        Déléguer
      </Button>

      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        title={titre}
        maxWidth="max-w-2xl"
        footer={
          <>
            {erreur ? (
              <p
                role="alert"
                className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
              >
                {erreur}
              </p>
            ) : null}
            <Button variant="secondary" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button
              disabled={changements.length === 0}
              loading={appliquer.isPending}
              onClick={() => {
                setErreur(null);
                appliquer.mutate();
              }}
            >
              Valider
            </Button>
          </>
        }
      >
        {membres.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">
            Aucun autre membre dans votre direction.
          </p>
        ) : (
          <ul className="-my-1 flex flex-col divide-y divide-line-soft">
            {types.map((t) => (
              <li
                key={t.capacite}
                className="flex flex-col gap-2.5 py-3.5 sm:flex-row sm:items-center sm:gap-5"
              >
                <span className="flex min-w-0 items-center gap-2.5 sm:w-56 sm:shrink-0">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary/[0.07] text-primary">
                    <Icon name="description" size={16} />
                  </span>
                  <span className="text-[13px] font-semibold text-ink-strong">{t.libelle}</span>
                </span>
                <div
                  role="group"
                  aria-label={`Qui traite : ${t.libelle}`}
                  className="flex min-w-0 flex-1 flex-wrap gap-2"
                >
                  {membres.map((m) => (
                    <ChoixMembre
                      key={m.employeeId}
                      nom={m.nom}
                      choisi={choix.has(cle(t.capacite, m.employeeId))}
                      onBasculer={() => basculer(cle(t.capacite, m.employeeId))}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

/** Un membre, en pastille à cocher — celle de « Demander un document ». */
export function ChoixMembre({
  nom,
  choisi,
  onBasculer,
  desactive = false,
}: {
  nom: string;
  choisi: boolean;
  onBasculer: () => void;
  desactive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      onClick={onBasculer}
      disabled={desactive}
      className={cn(
        // Même graisse cochée ou non : la pastille garde sa largeur, et les
        // membres restent alignés d'une ligne à l'autre.
        'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] font-medium transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
        'disabled:cursor-default',
        choisi
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-line text-ink enabled:hover:border-ink-muted/40 enabled:hover:bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150',
          choisi ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
        )}
      >
        {choisi ? <Icon name="check" size={11} /> : null}
      </span>
      {nom}
    </button>
  );
}
