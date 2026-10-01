'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  capaciteDuDocument,
  REQUESTABLE_DOC_LABELS,
  type MembreHabilite,
  type RequestableDoc,
} from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';
import { Modal } from './modal';
import { texteErreur } from './traitement-dch';

/* ————————————————————————————————————————————————————————————————
   « Déléguer » les demandes de documents : une fenêtre, un document par
   ligne, et pour chacun les membres de la DCH qui peuvent le traiter.

   Déléguer autorise, sans rien retirer : le directeur traite toujours tout.
   Décocher retire la délégation. « Autre document » n'y figure pas — il
   reste au directeur.
   ———————————————————————————————————————————————————————————————— */

/** Les documents qu'un agent demande, « Autre document » mis à part. */
export const DOCUMENTS_DELEGABLES = [
  'attestation_travail',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
] as const satisfies readonly RequestableDoc[];

const cle = (doc: RequestableDoc, employeeId: string) => `${doc}:${employeeId}`;

/** Qui peut traiter quoi, aujourd'hui : `attestation_travail:<membre>`. */
function delegationsDe(membres: readonly MembreHabilite[]): Set<string> {
  return new Set(
    DOCUMENTS_DELEGABLES.flatMap((doc) =>
      membres
        .filter((m) => m.capacites.includes(capaciteDuDocument(doc)))
        .map((m) => cle(doc, m.employeeId)),
    ),
  );
}

export function DeleguerDocuments({
  membres,
  onFait,
}: {
  membres: MembreHabilite[];
  onFait: () => void;
}) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  const actuelles = delegationsDe(membres);
  const changements = DOCUMENTS_DELEGABLES.flatMap((doc) =>
    membres
      .filter((m) => actuelles.has(cle(doc, m.employeeId)) !== choix.has(cle(doc, m.employeeId)))
      .map((m) => ({ doc, m })),
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
      for (const { doc, m } of changements) {
        await api('/habilitations', {
          method: 'PUT',
          body: {
            employeeId: m.employeeId,
            capacite: capaciteDuDocument(doc),
            accordee: choix.has(cle(doc, m.employeeId)),
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
      await queryClient.invalidateQueries({ queryKey: ['habilitations'] });
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => {
          setChoix(delegationsDe(membres));
          setErreur(null);
          setOuvert(true);
        }}
      >
        Déléguer
      </Button>

      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        title="Déléguer les demandes de documents"
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
            {DOCUMENTS_DELEGABLES.map((doc) => (
              <li
                key={doc}
                className="flex flex-col gap-2.5 py-3.5 sm:flex-row sm:items-center sm:gap-5"
              >
                <span className="flex min-w-0 items-center gap-2.5 sm:w-56 sm:shrink-0">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary/[0.07] text-primary">
                    <Icon name="description" size={16} />
                  </span>
                  <span className="text-[13px] font-semibold text-ink-strong">
                    {REQUESTABLE_DOC_LABELS[doc]}
                  </span>
                </span>
                <div
                  role="group"
                  aria-label={`Qui traite : ${REQUESTABLE_DOC_LABELS[doc]}`}
                  className="flex min-w-0 flex-1 flex-wrap gap-2"
                >
                  {membres.map((m) => (
                    <ChoixMembre
                      key={m.employeeId}
                      nom={m.nom}
                      choisi={choix.has(cle(doc, m.employeeId))}
                      onBasculer={() => basculer(cle(doc, m.employeeId))}
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
function ChoixMembre({
  nom,
  choisi,
  onBasculer,
}: {
  nom: string;
  choisi: boolean;
  onBasculer: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      onClick={onBasculer}
      className={cn(
        // Même graisse cochée ou non : la pastille garde sa largeur, et les
        // membres restent alignés d'un document à l'autre.
        'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] font-medium transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
        choisi
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-line text-ink hover:border-ink-muted/40 hover:bg-hover',
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
