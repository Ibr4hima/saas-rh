'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JobPostingView, OrgUnit } from '@teranga/contracts';
import { Button, Field, Input, Select, Skeleton, Textarea } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { Icon } from './icons';
import { Modal, ModalGrid, ModalSection } from './modal';

const DOCUMENTS_SUGGERES = ['CV', 'Lettre de motivation', 'Diplômes', 'Références'];

interface Champs {
  title: string;
  description: string;
  orgUnitId: string;
  contractType: string;
  location: string;
  deadline: string;
  documents: string[];
}

const VIDE: Champs = {
  title: '',
  description: '',
  orgUnitId: '',
  contractType: 'cdi',
  location: 'Dakar',
  deadline: '',
  documents: ['CV'],
};

function depuis(offre: JobPostingView): Champs {
  return {
    title: offre.title,
    description: offre.description,
    orgUnitId: offre.orgUnitId ?? '',
    contractType: offre.contractType,
    location: offre.location ?? '',
    deadline: offre.deadline ?? '',
    documents: offre.requiredDocuments,
  };
}

/**
 * Créer ou modifier une offre, en fenêtre.
 *
 * Un seul formulaire pour les deux gestes : ce sont les mêmes champs, et deux
 * copies auraient divergé au premier ajout. Ce qui change, c'est la requête —
 * POST sur une création, PATCH des seuls champs touchés sur une modification.
 */
export function JobModal({
  open,
  onClose,
  offre,
}: {
  open: boolean;
  onClose: () => void;
  /** Absente : création. Présente : modification de cette offre. */
  offre?: JobPostingView;
}) {
  const queryClient = useQueryClient();
  const [v, setV] = useState<Champs>(offre ? depuis(offre) : VIDE);
  const [autreDoc, setAutreDoc] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnit[]>('/org-units'),
    enabled: open,
  });

  const set = <K extends keyof Champs>(k: K, val: Champs[K]) => setV((c) => ({ ...c, [k]: val }));
  const basculerDoc = (doc: string) =>
    set(
      'documents',
      v.documents.includes(doc) ? v.documents.filter((d) => d !== doc) : [...v.documents, doc],
    );

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        title: v.title.trim(),
        description: v.description.trim(),
        orgUnitId: v.orgUnitId || (offre ? null : undefined),
        contractType: v.contractType,
        location: v.location.trim() || (offre ? null : undefined),
        deadline: v.deadline || (offre ? null : undefined),
        requiredDocuments: v.documents,
      };
      if (offre) {
        await api(`/jobs/${offre.id}`, { method: 'PATCH', body: corps });
        return offre.id;
      }
      const { id } = await api<{ id: string }>('/jobs', { method: 'POST', body: corps });
      return id;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={offre ? 'Modifier l’offre' : 'Nouvelle offre'}
      subtitle={offre ? `${offre.reference} · ${offre.title}` : undefined}
      maxWidth="max-w-3xl"
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
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={enregistrer.isPending}
            disabled={!v.title.trim() || !v.description.trim()}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {offre ? 'Enregistrer' : 'Créer l’offre'}
          </Button>
        </>
      }
    >
      <ModalSection title="Le poste">
        <div className="flex flex-col gap-3.5">
          <Field label="Intitulé du poste" htmlFor="title" required>
            <Input
              id="title"
              placeholder="Ex : Chargé d'affaires investissement"
              value={v.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label="Description de la mission" htmlFor="description" required>
            <Textarea
              id="description"
              rows={6}
              placeholder="Missions, profil recherché, avantages…"
              value={v.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <ModalGrid>
            <Field label="Type de contrat" htmlFor="contractType" required>
              <Select
                id="contractType"
                value={v.contractType}
                onChange={(e) => set('contractType', e.target.value)}
              >
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
                <option value="stage">Stage</option>
                <option value="consultant">Consultant</option>
                <option value="detachement">Détachement</option>
              </Select>
            </Field>
            <Field label="Unité d'organisation" htmlFor="orgUnitId">
              {unites.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select
                  id="orgUnitId"
                  value={v.orgUnitId}
                  onChange={(e) => set('orgUnitId', e.target.value)}
                >
                  <option value="">—</option>
                  {unites.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Lieu" htmlFor="location">
              <Input
                id="location"
                value={v.location}
                onChange={(e) => set('location', e.target.value)}
              />
            </Field>
            <Field label="Date limite de candidature" htmlFor="deadline">
              <Input
                id="deadline"
                type="date"
                value={v.deadline}
                onChange={(e) => set('deadline', e.target.value)}
              />
            </Field>
          </ModalGrid>
        </div>
      </ModalSection>

      <ModalSection title="Documents demandés aux candidats">
        <div className="flex flex-wrap gap-2">
          {[...new Set([...DOCUMENTS_SUGGERES, ...v.documents])].map((doc) => {
            const coche = v.documents.includes(doc);
            return (
              <button
                key={doc}
                type="button"
                onClick={() => basculerDoc(doc)}
                className={
                  coche
                    ? 'flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1 text-[12px] font-semibold text-primary'
                    : 'flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:border-primary/30 hover:text-ink'
                }
              >
                {coche ? <Icon name="check" size={13} /> : null}
                {doc}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Autre document…"
            value={autreDoc}
            onChange={(e) => setAutreDoc(e.target.value)}
            className="max-w-60"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!autreDoc.trim() || v.documents.length >= 5}
            onClick={() => {
              const doc = autreDoc.trim();
              if (doc && !v.documents.includes(doc)) set('documents', [...v.documents, doc]);
              setAutreDoc('');
            }}
          >
            Ajouter
          </Button>
        </div>
        <p className="mt-2.5 text-[11.5px] text-ink-muted">
          Le candidat devra fournir chaque document coché pour pouvoir postuler (5 maximum).
        </p>
      </ModalSection>
    </Modal>
  );
}
