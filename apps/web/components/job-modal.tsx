'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CompetenceLangue, JobPostingView } from '@teranga/contracts';
import {
  COMPETENCE_LANGUE_LABELS,
  COMPETENCES_LANGUE,
  CONTRATS_A_DUREE,
  DUREES_MOIS,
  EXPERIENCES_MIN,
  FRANCAIS,
  LANGUE_LABELS,
  LANGUES,
  libelleExperience,
  NIVEAU_ETUDES_LABELS,
  NIVEAU_LANGUE_LABELS,
  NIVEAUX_ETUDES,
  NIVEAUX_LANGUE,
} from '@teranga/contracts';
import { Button, Field, Input, Select, Textarea } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { aujourdhui } from '../lib/temps';
import { Icon } from './icons';
import { Modal, ModalGrid, ModalSection } from './modal';

/**
 * Ce qu'on demande à un candidat, et rien de plus.
 *
 * Chaque pièce exigée est un candidat qui renonce. Diplômes et références se
 * réclament à l'entretien, quand le dossier est déjà retenu — pas au dépôt.
 */
const DOCUMENTS_SUGGERES = ['CV', 'Lettre de motivation'];

interface Champs {
  title: string;
  description: string;
  contractType: string;
  deadline: string;
  documents: string[];
  /** Les listes rendent des chaînes ; la chaîne vide, c'est « rien choisi ». */
  niveauEtudes: string;
  experienceMin: string;
  experiencePoste: string;
  /** Les langues cochées en plus du français, et leurs niveaux (ADR-0182). */
  langues: string[];
  niveaux: Partial<Record<string, Partial<Record<CompetenceLangue, string>>>>;
  dureeMois: string;
}

const VIDE: Champs = {
  title: '',
  description: '',
  contractType: 'cdi',
  deadline: '',
  documents: ['CV'],
  niveauEtudes: '',
  experienceMin: '',
  experiencePoste: '',
  langues: [],
  niveaux: {},
  dureeMois: '',
};

function depuis(offre: JobPostingView): Champs {
  return {
    title: offre.title,
    description: offre.description,
    contractType: offre.contractType,
    deadline: offre.deadline ?? '',
    // Une offre plus ancienne peut porter d'autres pièces : elles restent
    // affichées et décochables, sinon la modifier les effacerait en silence.
    documents: offre.requiredDocuments,
    niveauEtudes: offre.niveauEtudes ?? '',
    experienceMin: offre.experienceMin === null ? '' : String(offre.experienceMin),
    experiencePoste: offre.experiencePoste === null ? '' : String(offre.experiencePoste),
    // Une langue d'une offre plus ancienne n'a pas ses niveaux : ils restent
    // à choisir avant d'enregistrer.
    langues: offre.langues.map((l) => l.langue),
    niveaux: Object.fromEntries(offre.langues.map((l) => [l.langue, l.niveaux ?? {}])),
    dureeMois: offre.dureeMois === null ? '' : String(offre.dureeMois),
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
  const [erreur, setErreur] = useState<string | null>(null);

  const set = <K extends keyof Champs>(k: K, val: Champs[K]) => setV((c) => ({ ...c, [k]: val }));
  const basculerDoc = (doc: string) =>
    set(
      'documents',
      v.documents.includes(doc) ? v.documents.filter((d) => d !== doc) : [...v.documents, doc],
    );
  const basculerLangue = (l: string) =>
    set('langues', v.langues.includes(l) ? v.langues.filter((x) => x !== l) : [...v.langues, l]);
  const choisirNiveau = (l: string, c: CompetenceLangue, niveau: string) =>
    setV((x) => ({ ...x, niveaux: { ...x.niveaux, [l]: { ...x.niveaux[l], [c]: niveau } } }));
  // L'expérience pour le poste ne dépasse pas l'expérience minimum : une
  // expérience minimum revue à la baisse la remet à choisir.
  const choisirExperienceMin = (ans: string) =>
    setV((x) => ({
      ...x,
      experienceMin: ans,
      experiencePoste:
        x.experiencePoste !== '' && Number(x.experiencePoste) > Number(ans)
          ? ''
          : x.experiencePoste,
    }));
  const langues = LANGUES.filter((l) => v.langues.includes(l));
  const aDuree = CONTRATS_A_DUREE.includes(v.contractType);
  const complet =
    Boolean(v.title.trim()) &&
    Boolean(v.description.trim()) &&
    v.niveauEtudes !== '' &&
    v.experienceMin !== '' &&
    v.experiencePoste !== '' &&
    langues.every((l) => COMPETENCES_LANGUE.every((c) => Boolean(v.niveaux[l]?.[c]))) &&
    (!aDuree || v.dureeMois !== '');

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        title: v.title.trim(),
        description: v.description.trim(),
        contractType: v.contractType,
        deadline: v.deadline || (offre ? null : undefined),
        requiredDocuments: v.documents,
        niveauEtudes: v.niveauEtudes,
        experienceMin: Number(v.experienceMin),
        experiencePoste: Number(v.experiencePoste),
        // Dans l'ordre de la liste, quel que soit l'ordre des clics.
        langues: langues.map((l) => ({ langue: l, niveaux: v.niveaux[l] })),
        dureeMois: aDuree ? Number(v.dureeMois) : null,
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
            disabled={!complet}
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
            <Input id="title" value={v.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Description de la mission" htmlFor="description" required>
            <Textarea
              id="description"
              rows={6}
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
              </Select>
            </Field>
            {aDuree ? (
              <Field label="Durée du contrat" htmlFor="dureeMois" required>
                <Select
                  id="dureeMois"
                  value={v.dureeMois}
                  onChange={(e) => set('dureeMois', e.target.value)}
                >
                  <option value="" hidden>
                    Choisir
                  </option>
                  {DUREES_MOIS.map((m) => (
                    <option key={m} value={m}>
                      {m} mois
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Date limite de candidature" htmlFor="deadline">
              <Input
                id="deadline"
                type="date"
                min={aujourdhui()}
                value={v.deadline}
                onChange={(e) => set('deadline', e.target.value)}
              />
            </Field>
          </ModalGrid>
        </div>
      </ModalSection>

      <ModalSection title="Profil recherché">
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Niveau d’études" htmlFor="niveauEtudes" required>
              <Select
                id="niveauEtudes"
                value={v.niveauEtudes}
                onChange={(e) => set('niveauEtudes', e.target.value)}
              >
                <option value="" hidden>
                  Choisir
                </option>
                {NIVEAUX_ETUDES.map((n) => (
                  <option key={n} value={n}>
                    {NIVEAU_ETUDES_LABELS[n]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expérience minimum" htmlFor="experienceMin" required>
              <Select
                id="experienceMin"
                value={v.experienceMin}
                onChange={(e) => choisirExperienceMin(e.target.value)}
              >
                <option value="" hidden>
                  Choisir
                </option>
                {EXPERIENCES_MIN.map((a) => (
                  <option key={a} value={a}>
                    {libelleExperience(a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expérience pour le poste" htmlFor="experiencePoste" required>
              <Select
                id="experiencePoste"
                value={v.experiencePoste}
                onChange={(e) => set('experiencePoste', e.target.value)}
              >
                <option value="" hidden>
                  Choisir
                </option>
                {EXPERIENCES_MIN.filter(
                  (a) => v.experienceMin === '' || a <= Number(v.experienceMin),
                ).map((a) => (
                  <option key={a} value={a}>
                    {libelleExperience(a)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {/* Même intitulé que les champs voisins : un groupe de puces, pas un
              champ, d'où la légende d'un fieldset plutôt qu'un label. */}
          <fieldset className="min-w-0">
            <legend className="mb-1.5 block text-sm font-medium text-ink-strong">
              Langues exigées
            </legend>
            <div className="flex flex-wrap gap-2">
              {/* Le français, exigé sur toute offre : coché, il ne se décoche pas. */}
              <Puce coche verrouillee>
                {FRANCAIS}
              </Puce>
              {LANGUES.map((l) => (
                <Puce key={l} coche={v.langues.includes(l)} onClick={() => basculerLangue(l)}>
                  {LANGUE_LABELS[l]}
                </Puce>
              ))}
            </div>
          </fieldset>
          {langues.map((l) => (
            <fieldset key={l} className="min-w-0">
              <legend className="mb-1.5 block text-[13px] font-semibold text-ink-strong">
                {LANGUE_LABELS[l]}
              </legend>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                {COMPETENCES_LANGUE.map((c) => (
                  <Field
                    key={c}
                    label={COMPETENCE_LANGUE_LABELS[c]}
                    htmlFor={`niveau-${l}-${c}`}
                    required
                  >
                    <Select
                      id={`niveau-${l}-${c}`}
                      value={v.niveaux[l]?.[c] ?? ''}
                      onChange={(e) => choisirNiveau(l, c, e.target.value)}
                    >
                      <option value="" hidden>
                        Choisir
                      </option>
                      {NIVEAUX_LANGUE.map((n) => (
                        <option key={n} value={n}>
                          {NIVEAU_LANGUE_LABELS[n]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </ModalSection>

      <ModalSection title="Documents demandés aux candidats">
        <div className="flex flex-wrap gap-2">
          {[...new Set([...DOCUMENTS_SUGGERES, ...v.documents])].map((doc) => (
            <Puce key={doc} coche={v.documents.includes(doc)} onClick={() => basculerDoc(doc)}>
              {doc}
            </Puce>
          ))}
        </div>
        <p className="mt-2.5 text-[11.5px] text-ink-muted">
          Le candidat devra fournir chaque document coché pour pouvoir postuler.
        </p>
      </ModalSection>
    </Modal>
  );
}

/**
 * Une puce qu'on coche ou décoche : un document demandé, une langue exigée.
 * Verrouillée, elle reste cochée : le français.
 */
function Puce({
  coche,
  onClick,
  verrouillee = false,
  children,
}: {
  coche: boolean;
  onClick?: () => void;
  verrouillee?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={coche}
      disabled={verrouillee}
      onClick={onClick}
      className={
        coche
          ? 'flex items-center gap-1.5 rounded-controle-sm border border-primary/25 bg-primary/[0.07] px-3 py-1 text-[12px] font-semibold text-primary disabled:cursor-default'
          : 'flex items-center gap-1.5 rounded-controle-sm border border-line px-3 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:border-primary/30 hover:text-ink'
      }
    >
      {coche ? <Icon name="check" size={13} /> : null}
      {children}
    </button>
  );
}
