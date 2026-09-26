'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AcademyCategory, CourseAdminView } from '@teranga/contracts';
import { ACADEMY_CATEGORIES } from '@teranga/contracts';
import { Button, cn, Field, Input, Textarea } from '@teranga/ui';
import { FAMILLES, FOND_COUVERTURE } from '../lib/academy';
import { api, ApiError } from '../lib/api';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';

/**
 * Créer une formation, ou reprendre son titre, sa famille, sa présentation.
 *
 * La famille se choisit sur des tuiles plutôt que dans une liste déroulante :
 * elles sont cinq, et chacune porte l'icône qui habillera la couverture — la
 * RH voit ce que verront les agents avant de le décider.
 */
export function FormationModal({
  open,
  onClose,
  formation,
  onCree,
}: {
  open: boolean;
  onClose: () => void;
  /** Absente : création. */
  formation?: CourseAdminView;
  onCree?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [titre, setTitre] = useState(formation?.title ?? '');
  const [famille, setFamille] = useState<AcademyCategory>(formation?.category ?? 'bureautique');
  const [presentation, setPresentation] = useState(formation?.summary ?? '');
  const [erreur, setErreur] = useState<string | null>(null);

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        title: titre.trim(),
        category: famille,
        summary: presentation.trim() || null,
      };
      if (formation) {
        await api(`/academy/courses/${formation.id}`, { method: 'PUT', body: corps });
        return formation.id;
      }
      const { id } = await api<{ id: string }>('/academy/courses', { method: 'POST', body: corps });
      return id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['academy'] });
      onClose();
      if (!formation) onCree?.(id);
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={formation ? 'Modifier la formation' : 'Nouvelle formation'}
      subtitle={formation ? formation.title : 'Vous ajouterez ensuite les modules et les leçons.'}
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
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={enregistrer.isPending}
            disabled={titre.trim().length < 3}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {formation ? 'Enregistrer' : 'Créer la formation'}
          </Button>
        </>
      }
    >
      <ModalSection title="La formation">
        <div className="flex flex-col gap-3.5">
          <Field label="Titre" htmlFor="titre" required>
            <Input
              id="titre"
              placeholder="Ex : Excel pour l’analyse de données"
              value={titre}
              maxLength={160}
              onChange={(e) => setTitre(e.target.value)}
            />
          </Field>
          <Field
            label="Présentation"
            htmlFor="presentation"
            hint="Deux ou trois phrases : ce que l’agent saura faire à la fin."
          >
            <Textarea
              id="presentation"
              rows={4}
              maxLength={2000}
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
            />
          </Field>
        </div>
      </ModalSection>

      <ModalSection title="Famille">
        <div
          role="radiogroup"
          aria-label="Famille"
          // Deux colonnes : dix familles aux noms parfois longs (« Digital et
          // informatique ») se lisent sur cinq rangées, sans césure.
          className="grid grid-cols-2 gap-2"
        >
          {ACADEMY_CATEGORIES.map((c) => {
            const choisie = c === famille;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={choisie}
                onClick={() => setFamille(c)}
                className={cn(
                  'flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left text-[12.5px] leading-tight font-semibold transition-colors',
                  choisie
                    ? 'border-primary bg-primary-soft/60 text-primary'
                    : 'border-line-soft text-ink hover:border-line hover:bg-hover',
                )}
              >
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-[8px] text-white"
                  style={{ background: FOND_COUVERTURE }}
                >
                  <Icon name={FAMILLES[c].icone} size={16} />
                </span>
                {FAMILLES[c].label}
              </button>
            );
          })}
        </div>
      </ModalSection>
    </Modal>
  );
}
