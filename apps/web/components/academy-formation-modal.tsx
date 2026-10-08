'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AcademyCategory, AgentAcademy, CourseAdminView } from '@teranga/contracts';
import { ACADEMY_CATEGORIES } from '@teranga/contracts';
import { Button, cn, Field, Input, Select, Textarea } from '@teranga/ui';
import { FAMILLES, FOND_COUVERTURE } from '../lib/academy';
import { api, ApiError } from '../lib/api';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';

/** Qui a fait la formation : on ne le dit pas, un agent de l'APIX, ou quelqu'un d'extérieur. */
type SorteFormateur = 'aucun' | 'agent' | 'exterieur';

const SORTES: { id: SorteFormateur; label: string }[] = [
  { id: 'aucun', label: 'Non précisé' },
  { id: 'agent', label: 'Agent APIX' },
  { id: 'exterieur', label: 'Extérieur' },
];

/**
 * Créer une formation, ou reprendre son titre, sa famille, sa présentation,
 * son formateur.
 *
 * La famille se choisit sur des tuiles plutôt que dans une liste déroulante :
 * elles sont cinq, et chacune porte l'icône qui habillera la couverture — la
 * RH voit ce que verront les agents avant de le décider.
 *
 * Le formateur est facultatif. Un agent de l'APIX en suit les leçons, pas
 * l'évaluation ; son dossier dit qu'il l'a animée.
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
  const [sorte, setSorte] = useState<SorteFormateur>(
    !formation?.formateur ? 'aucun' : formation.formateur.employeeId ? 'agent' : 'exterieur',
  );
  const [agent, setAgent] = useState(formation?.formateur?.employeeId ?? '');
  const [exterieur, setExterieur] = useState(
    formation?.formateur && !formation.formateur.employeeId ? formation.formateur.nom : '',
  );
  const [erreur, setErreur] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ['academy', 'gestion', 'agents'],
    queryFn: () => api<AgentAcademy[]>('/academy/gestion/agents'),
    enabled: open && sorte === 'agent',
    staleTime: 60_000,
  });
  // L'agent désigné a pu quitter l'APIX depuis : il reste proposé.
  const agentAbsent =
    formation?.formateur?.employeeId &&
    agents.data &&
    !agents.data.some((a) => a.employeeId === formation.formateur?.employeeId)
      ? formation.formateur
      : null;
  const formateurIncomplet =
    (sorte === 'agent' && !agent) || (sorte === 'exterieur' && exterieur.trim().length < 2);

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        title: titre.trim(),
        category: famille,
        summary: presentation.trim() || null,
        formateurEmployeeId: sorte === 'agent' ? agent : null,
        formateurNom: sorte === 'exterieur' ? exterieur.trim() : null,
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
      subtitle={formation ? formation.title : undefined}
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
            disabled={titre.trim().length < 3 || formateurIncomplet}
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
              placeholder="PowerPoint"
              value={titre}
              maxLength={160}
              onChange={(e) => setTitre(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="presentation">
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

      <ModalSection title="Formateur">
        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-snug text-ink-muted">
            Facultatif : qui a fait cette formation. Une personne de l’APIX peut en suivre les
            leçons, mais pas l’évaluation ; son dossier indique qu’elle l’a animée.
          </p>
          <div
            role="radiogroup"
            aria-label="Formateur"
            className="flex gap-1 rounded-full border border-line-soft bg-bg p-1 sm:w-fit"
          >
            {SORTES.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={sorte === o.id}
                onClick={() => setSorte(o.id)}
                className={cn(
                  'flex-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap transition-colors sm:flex-none',
                  sorte === o.id
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {sorte === 'agent' ? (
            <Field label="Agent" htmlFor="formateur-agent" required>
              <Select
                id="formateur-agent"
                value={agent}
                disabled={agents.isLoading}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">{agents.isLoading ? 'Chargement…' : 'Choisir'}</option>
                {agentAbsent?.employeeId ? (
                  <option value={agentAbsent.employeeId}>
                    {agentAbsent.nom} (a quitté l’APIX)
                  </option>
                ) : null}
                {agents.data?.map((a) => (
                  <option key={a.employeeId} value={a.employeeId}>
                    {a.nom}
                    {a.poste ? ` · ${a.poste}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : sorte === 'exterieur' ? (
            <Field
              label="Nom"
              htmlFor="formateur-exterieur"
              required
              hint="Une personne ou un organisme."
            >
              <Input
                id="formateur-exterieur"
                placeholder="Cabinet, intervenant…"
                value={exterieur}
                maxLength={160}
                onChange={(e) => setExterieur(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
      </ModalSection>

      <ModalSection title="Catégorie">
        <div
          role="radiogroup"
          aria-label="Catégorie"
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
