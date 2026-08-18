'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { PublicJobInfo } from '@teranga/contracts';
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, Field, Input, Skeleton, Textarea } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { CONTRACT_LABELS } from '../../../lib/recruitment';

const INVALID_MESSAGES: Record<string, string> = {
  closed: "La date limite de candidature est passée — cette offre n'accepte plus de dossiers.",
  not_found: "Cette offre n'existe pas ou n'est plus publiée.",
};

interface PickedFile {
  filename: string;
  contentType: string;
  contentBase64: string;
  sizeBytes: number;
}

export default function ApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<Record<string, PickedFile>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const info = useQuery({
    queryKey: ['public-job', slug],
    queryFn: () => api<PublicJobInfo>(`/public/jobs/${slug}`),
    retry: false,
  });

  const apply = useMutation({
    mutationFn: () =>
      api(`/public/jobs/${slug}/apply`, {
        method: 'POST',
        body: {
          givenName,
          familyName,
          email,
          phone: phone || undefined,
          message: message || undefined,
          documents: Object.entries(files).map(([label, f]) => ({
            label,
            filename: f.filename,
            contentType: f.contentType,
            contentBase64: f.contentBase64,
          })),
        },
      }),
    onSuccess: () => setSent(true),
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible — réessayez.'),
  });

  const pickFile = (label: string, file: File | null) => {
    setFileError(null);
    if (!file) {
      setFiles((prev) => {
        const next = { ...prev };
        delete next[label];
        return next;
      });
      return;
    }
    if (!(file.type in ALLOWED_DOCUMENT_TYPES)) {
      setFileError(`« ${file.name} » : format accepté — PDF, Word, JPG ou PNG.`);
      return;
    }
    if (file.size === 0) {
      setFileError(`« ${file.name} » est vide — vérifiez le fichier (synchronisation cloud ?).`);
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFileError(`« ${file.name} » dépasse 5 Mo.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      setFiles((prev) => ({
        ...prev,
        [label]: {
          filename: file.name,
          contentType: file.type,
          contentBase64: base64,
          sizeBytes: file.size,
        },
      }));
    };
    reader.onerror = () =>
      setFileError(
        `Impossible de lire « ${file.name} » — réessayez ou choisissez un autre fichier.`,
      );
    reader.readAsDataURL(file);
  };

  if (info.isLoading) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  // Une erreur réseau/serveur n'est PAS « offre inexistante » : on distingue.
  if (info.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="mb-2 text-sm font-semibold text-ink-strong">Chargement impossible</p>
            <p className="mb-4 text-sm text-ink-muted">
              Impossible de joindre le serveur — vérifiez votre connexion et réessayez.
            </p>
            <Button variant="secondary" onClick={() => void info.refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!info.data?.valid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="mb-2 text-sm font-semibold text-ink-strong">Offre indisponible</p>
            <p className="text-sm text-ink-muted">
              {INVALID_MESSAGES[info.data?.reason ?? 'not_found']}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const offer = info.data;
  const missingDocs = offer.requiredDocuments.filter((label) => !files[label]);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = givenName.trim() && familyName.trim() && emailValid && missingDocs.length === 0;

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="mb-3 text-4xl">🎉</p>
            <p className="mb-2 text-lg font-bold text-ink-strong">Candidature envoyée !</p>
            <p className="text-sm text-ink-muted">
              Merci {givenName} — votre dossier pour « {offer.title} » est bien arrivé chez{' '}
              {offer.organizationName}. Vous serez contacté·e à l&apos;adresse {email}.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      {/* En-tête de l'offre */}
      <div className="mb-6">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-ink">
          {offer.organizationName[0]}
        </div>
        <p className="text-sm font-medium text-ink-muted">{offer.organizationName} recrute</p>
        <h1 className="mt-0.5 text-2xl font-bold text-ink-strong">{offer.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone="primary">{CONTRACT_LABELS[offer.contractType] ?? offer.contractType}</Badge>
          {offer.location ? <span>{offer.location}</span> : null}
          {offer.deadline ? (
            <span>
              · candidatures jusqu&apos;au{' '}
              {new Date(`${offer.deadline}T00:00:00`).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          ) : null}
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="py-4">
          <p className="text-sm whitespace-pre-wrap text-ink">{offer.description}</p>
        </CardContent>
      </Card>

      {/* Formulaire */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <h2 className="text-base font-semibold text-ink-strong">Postuler</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="givenName" required>
              <Input
                id="givenName"
                autoComplete="given-name"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
              />
            </Field>
            <Field label="Nom" htmlFor="familyName" required>
              <Input
                id="familyName"
                autoComplete="family-name"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Téléphone" htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>

          {offer.requiredDocuments.map((label) => (
            <Field key={label} label={label} htmlFor={`doc-${label}`} required>
              <input
                id={`doc-${label}`}
                type="file"
                accept={Object.values(ALLOWED_DOCUMENT_TYPES).join(',')}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  // Réinitialise l'input : re-sélectionner le même nom de
                  // fichier (après compression, par ex.) redéclenche bien.
                  e.target.value = '';
                  pickFile(label, file);
                }}
                className="block w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:opacity-90"
              />
              {files[label] ? (
                <p className="mt-1 text-xs text-success">
                  ✓ {files[label].filename} ({Math.round(files[label].sizeBytes / 1024)} Ko)
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">PDF, Word, JPG ou PNG — 5 Mo max.</p>
              )}
            </Field>
          ))}

          <Field label="Message (facultatif)" htmlFor="message">
            <Textarea
              id="message"
              rows={4}
              placeholder="Quelques mots sur votre motivation…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>

          {fileError ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{fileError}</p>
          ) : null}
          {serverError ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
          ) : null}

          <Button
            onClick={() => {
              setServerError(null);
              apply.mutate();
            }}
            disabled={!canSubmit}
            loading={apply.isPending}
          >
            Envoyer ma candidature
          </Button>
          {missingDocs.length > 0 ? (
            <p className="text-center text-xs text-ink-muted">
              Documents à joindre : {missingDocs.join(', ')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-ink-muted">
        Propulsé par Teranga RH — vos données ne sont transmises qu&apos;à {offer.organizationName}.
      </p>
    </main>
  );
}
