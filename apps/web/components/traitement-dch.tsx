'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CAPACITE_INFOS,
  type CapaciteDemande,
  type EtatHabilitations,
  type MembreHabilite,
  type TraitementView,
  type TypeDemande,
} from '@teranga/contracts';
import { Button, Field, Select } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { Icon } from './icons';
import { Modal } from './modal';

/* ————————————————————————————————————————————————————————————————
   Ce que les files de la DCH ont en commun : qui traite, confier une
   demande, reprendre la main, et — après avoir confié — proposer de
   confier aussi les suivantes.

   Toutes les demandes du personnel relèvent de la DCH. Son directeur les
   traite, ou les confie : une à une (ici), ou toutes celles d'un type
   (« Déléguer des tâches »). Les membres habilités les reçoivent directement.
   ———————————————————————————————————————————————————————————————— */

export type Message = { ton: 'ok' | 'erreur'; texte: string } | null;

export const texteErreur = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Action impossible.';

/** Le retour d'une action, en tête de page. */
export function BandeauMessage({ message }: { message: NonNullable<Message> }) {
  return (
    <p
      role="status"
      className={
        message.ton === 'ok'
          ? 'flex shrink-0 items-center gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset'
          : 'flex shrink-0 items-center gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset'
      }
    >
      <Icon name={message.ton === 'ok' ? 'check_circle' : 'error'} size={16} />
      {message.texte}
    </p>
  );
}

/**
 * Les membres de la DCH et ce qui leur est confié : pour qui la dirige (à
 * qui confier), et pour l'administrateur (qui peut quoi, en lecture).
 */
export function useMembresDCH() {
  const me = useMe();
  return useQuery({
    queryKey: ['habilitations'],
    queryFn: () => api<EtatHabilitations>('/habilitations'),
    enabled: Boolean(me.data?.dirigeLaDCH || me.data?.role === 'admin'),
  });
}

/** « Confiée à Awa Diop », « Awa Diop ou Khady Fall la traite » — en une ligne. */
export function quiTraite(t: TraitementView | null | undefined): string | null {
  if (!t) return null;
  if (t.aConfier) return 'Votre propre demande — à confier à un membre de la DCH';
  if (t.confiee) return `Confiée à ${t.confiee.nom}`;
  if (t.traitants)
    return `${t.traitants} la ${t.traitants.includes(' ou ') ? 'traitent' : 'traite'}`;
  return 'Personne pour la traiter en ce moment';
}

const CHEMIN: Record<Exclude<TypeDemande, 'conges'>, string> = {
  documents: 'documents',
  informations: 'informations',
  pieces: 'pieces',
};

/**
 * Confier une demande — ou la reprendre (`null`). Rend si le membre n'est
 * pas encore habilité à ce type : l'écran propose alors les suivantes.
 */
export function useConfier(type: TypeDemande, onFait: () => Promise<void> | void) {
  return useMutation({
    mutationFn: (v: { id: string; employeeId: string | null }) =>
      api<{ proposerHabilitation: boolean }>(
        type === 'conges'
          ? `/absence-requests/${v.id}/confier`
          : `/demandes/${CHEMIN[type]}/${v.id}/confier`,
        { method: 'POST', body: { employeeId: v.employeeId } },
      ),
    onSuccess: async () => {
      await onFait();
    },
  });
}

/** Choisir le membre de la DCH à qui confier une demande. */
export function ModalConfier({
  titre,
  sousTitre,
  membres,
  exclure,
  enCours,
  onConfier,
  onClose,
}: {
  titre: string;
  sousTitre?: string;
  membres: MembreHabilite[];
  /** Le demandeur : on ne lui confie pas sa propre demande. */
  exclure: string;
  enCours: boolean;
  onConfier: (employeeId: string) => void;
  onClose: () => void;
}) {
  const [membre, setMembre] = useState('');
  const possibles = membres.filter((m) => m.employeeId !== exclure);
  return (
    <Modal
      open
      onClose={onClose}
      title={titre}
      subtitle={sousTitre}
      maxWidth="max-w-lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!membre} loading={enCours} onClick={() => onConfier(membre)}>
            Confier
          </Button>
        </div>
      }
    >
      {possibles.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Aucun autre membre de la DCH n’a encore accès au portail.
        </p>
      ) : (
        <Field
          label="À un membre de la DCH"
          htmlFor="confier-a"
          hint="Il ou elle reçoit une notification et la traite. Vous la voyez toujours, et pouvez la reprendre."
        >
          <Select id="confier-a" value={membre} onChange={(e) => setMembre(e.target.value)}>
            <option value="">— Choisir</option>
            {possibles.map((m) => (
              <option key={m.employeeId} value={m.employeeId} disabled={m.absent}>
                {m.nom}
                {m.poste ? ` — ${m.poste}` : ''}
                {m.absent ? ' (en congé)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

/**
 * Après une demande confiée à la main : confier aussi les suivantes de ce
 * type au même membre — une habilitation, que « Délégations » retire.
 */
export function ModalLesSuivantes({
  membre,
  capacite,
  onFait,
  onClose,
}: {
  membre: MembreHabilite;
  capacite: CapaciteDemande;
  onFait: (texte: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const libelle = CAPACITE_INFOS[capacite].libelle.toLowerCase();
  const habiliter = useMutation({
    mutationFn: () =>
      api('/habilitations', {
        method: 'PUT',
        body: { employeeId: membre.employeeId, capacite, accordee: true },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['habilitations'] });
      await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
      onFait(`Les ${libelle} vont désormais directement à ${membre.nom}.`);
    },
    onError: (err) => setErreur(texteErreur(err)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Confier aussi les prochaines à ${membre.nom} ?`}
      maxWidth="max-w-lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Non, pas maintenant
          </Button>
          <Button loading={habiliter.isPending} onClick={() => habiliter.mutate()}>
            Oui, désormais
          </Button>
        </div>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink">
        Les {libelle} iront directement à {membre.nom}. Vous ne recevrez plus de notification, mais
        vous les verrez toutes et pourrez reprendre la main à tout moment. Vous retrouverez ce choix
        dans « Déléguer des tâches ».
      </p>
      {erreur ? <p className="mt-3 text-[12.5px] text-danger">{erreur}</p> : null}
    </Modal>
  );
}
