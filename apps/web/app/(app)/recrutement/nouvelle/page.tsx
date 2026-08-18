'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrgUnit } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';

const SUGGESTED_DOCUMENTS = ['CV', 'Lettre de motivation', 'Diplômes', 'Références'];

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [contractType, setContractType] = useState('cdi');
  const [location, setLocation] = useState('Dakar');
  const [deadline, setDeadline] = useState('');
  const [documents, setDocuments] = useState<string[]>(['CV']);
  const [extraDoc, setExtraDoc] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const orgUnits = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnit[]>('/org-units'),
  });

  const toggleDoc = (doc: string) =>
    setDocuments(
      documents.includes(doc) ? documents.filter((d) => d !== doc) : [...documents, doc],
    );

  const submit = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const { id } = await api<{ id: string; publicSlug: string }>('/jobs', {
        method: 'POST',
        body: {
          title,
          description,
          orgUnitId: orgUnitId || undefined,
          contractType,
          location: location || undefined,
          deadline: deadline || undefined,
          requiredDocuments: documents,
        },
      });
      router.replace(`/recrutement/${id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Création impossible.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/recrutement" className="text-sm text-ink-muted hover:text-ink">
          ← Recrutement
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Nouvelle offre</h1>
        <p className="text-sm text-ink-muted">
          L&apos;offre est créée en brouillon : vous la publierez quand elle sera prête.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Le poste</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Intitulé du poste" htmlFor="title" required>
              <Input
                id="title"
                placeholder="Ex : Chargé d'affaires investissement"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Description de la mission" htmlFor="description" required>
              <Textarea
                id="description"
                rows={8}
                placeholder="Missions, profil recherché, avantages…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Type de contrat" htmlFor="contractType" required>
                <Select
                  id="contractType"
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                >
                  <option value="cdi">CDI</option>
                  <option value="cdd">CDD</option>
                  <option value="stage">Stage</option>
                  <option value="consultant">Consultant</option>
                  <option value="detachement">Détachement</option>
                </Select>
              </Field>
              <Field label="Unité d'organisation" htmlFor="orgUnitId">
                <Select
                  id="orgUnitId"
                  value={orgUnitId}
                  onChange={(e) => setOrgUnitId(e.target.value)}
                >
                  <option value="">—</option>
                  {orgUnits.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lieu" htmlFor="location">
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
              <Field label="Date limite de candidature" htmlFor="deadline">
                <Input
                  id="deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents demandés aux candidats</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {[...new Set([...SUGGESTED_DOCUMENTS, ...documents])].map((doc) => (
                <button
                  key={doc}
                  type="button"
                  onClick={() => toggleDoc(doc)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    documents.includes(doc)
                      ? 'border-primary bg-primary-soft font-medium text-primary'
                      : 'border-line text-ink-muted hover:border-ink-muted/40'
                  }`}
                >
                  {documents.includes(doc) ? '✓ ' : ''}
                  {doc}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Autre document…"
                value={extraDoc}
                onChange={(e) => setExtraDoc(e.target.value)}
                className="max-w-60"
              />
              <Button
                variant="secondary"
                disabled={!extraDoc.trim() || documents.length >= 5}
                onClick={() => {
                  const doc = extraDoc.trim();
                  if (doc && !documents.includes(doc)) setDocuments([...documents, doc]);
                  setExtraDoc('');
                }}
              >
                Ajouter
              </Button>
            </div>
            <p className="text-xs text-ink-muted">
              Le candidat devra fournir chaque document coché pour pouvoir postuler (5 maximum).
            </p>
          </CardContent>
        </Card>

        {serverError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Link href="/recrutement">
            <Button variant="secondary">Annuler</Button>
          </Link>
          <Button onClick={submit} loading={saving} disabled={!title.trim() || !description.trim()}>
            Créer l&apos;offre
          </Button>
        </div>
      </div>
    </div>
  );
}
