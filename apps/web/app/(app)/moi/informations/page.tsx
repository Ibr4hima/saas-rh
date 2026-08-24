'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  EmployeeDetail,
  MyEmployeeView,
  ProfileChangeField,
  ProfileChangeRequestView,
} from '@teranga/contracts';
import {
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_LABELS,
  PROFILE_CHANGE_STATUS_LABELS,
  PROFILE_CHANGE_STATUS_TONES,
  nationalityLabel,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { ID_DOCUMENT_LABELS, SEX_LABELS, maritalLabels } from '../../../../lib/person';
import { timeAgo } from '../../../../components/document-request-list';

/** Une ligne « libellé : valeur » du dossier tel que la RH l'a rempli. */
function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink-strong">{value || '—'}</span>
    </div>
  );
}

type Draft = Partial<Record<ProfileChangeField, string>>;

export default function MyInformationsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const me = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = me.data?.employeeId;

  const detail = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api<EmployeeDetail>(`/employees/${employeeId}`),
    enabled: Boolean(employeeId),
  });

  const requests = useQuery({
    // scope=mine : l'espace personnel reste personnel, même pour un membre RH.
    queryKey: ['profile-changes', 'me'],
    queryFn: () => api<ProfileChangeRequestView[]>('/profile-changes?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/profile-changes', {
        method: 'POST',
        body: { changes: draft, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      setDraft({});
      setNote('');
      setError(null);
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  if (me.isLoading || detail.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (me.isError || !me.data) {
    const message = me.error instanceof ApiError ? me.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }
  if (!detail.data) return <p className="text-sm text-danger">Dossier introuvable.</p>;

  const p = detail.data.person;
  const marital = maritalLabels(p.gender);
  const enAttente = (requests.data ?? []).find((r) => r.status === 'pending');

  /** Valeur actuelle d'un champ demandable, telle qu'elle est au dossier. */
  const current = (f: ProfileChangeField): string =>
    ({
      maritalStatus: p.maritalStatus ?? '',
      personalEmail: p.personalEmail ?? '',
      phone: p.phone ?? '',
      addressLine: p.addressLine ?? '',
      city: p.city ?? '',
      emergencyContactName: p.emergencyContactName ?? '',
      emergencyContactPhone: p.emergencyContactPhone ?? '',
    })[f];

  const valueOf = (f: ProfileChangeField) => draft[f] ?? current(f);
  const set = (f: ProfileChangeField, v: string) => {
    setSent(false);
    setDraft({ ...draft, [f]: v });
  };
  // Seuls les champs RÉELLEMENT modifiés partent : demander à la RH de
  // confirmer une valeur inchangée n'a aucun sens.
  const modifies = PROFILE_CHANGE_FIELDS.filter(
    (f) => draft[f] !== undefined && draft[f] !== current(f),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/moi" className="text-sm text-ink-muted hover:text-ink">
          ← Mon espace
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>État civil</CardTitle>
          </CardHeader>
          <CardContent>
            <Info label="Nom" value={`${p.givenName} ${p.familyName}`} />
            <Info label="Sexe" value={p.gender ? SEX_LABELS[p.gender] : null} />
            <Info label="Date de naissance" value={p.birthDate ? formatDate(p.birthDate) : null} />
            <Info label="Pays de naissance" value={p.birthPlace} />
            <Info label="Nationalité" value={nationalityLabel(p.nationality)} />
            <Info
              label="Situation matrimoniale"
              value={p.maritalStatus ? marital[p.maritalStatus] : null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pièce d&apos;identité</CardTitle>
          </CardHeader>
          <CardContent>
            <Info
              label="Type"
              value={p.idDocumentType ? ID_DOCUMENT_LABELS[p.idDocumentType] : null}
            />
            <Info label="Numéro" value={p.nationalId} />
            <Info
              label="Délivrée le"
              value={p.idDocumentIssuedOn ? formatDate(p.idDocumentIssuedOn) : null}
            />
            <Info
              label="Expire le"
              value={p.idDocumentExpiresOn ? formatDate(p.idDocumentExpiresOn) : null}
            />
            <p className="pt-3 text-xs text-ink-muted">
              Ces informations s&apos;appuient sur un document officiel : adressez-vous directement
              à la Direction du Capital Humain pour les corriger.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dossier professionnel</CardTitle>
          </CardHeader>
          <CardContent>
            <Info label="Matricule" value={detail.data.employeeNumber} />
            <Info label="Poste" value={me.data.positionTitle} />
            <Info label="Unité" value={me.data.orgUnitName} />
            <Info label="Manager" value={detail.data.managerName} />
            <Info label="Email professionnel" value={detail.data.workEmail} />
            <Info label="Téléphone professionnel" value={detail.data.workPhone} />
          </CardContent>
        </Card>

        {/* Ce que l'employé peut faire corriger lui-même */}
        <Card>
          <CardHeader>
            <CardTitle>Signaler un changement</CardTitle>
            <p className="text-sm text-ink-muted">
              Déménagement, mariage, nouveau numéro : vous le savez avant nous.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {enAttente ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                Une demande est déjà en attente de validation. Vous pourrez en envoyer une nouvelle
                dès qu&apos;elle aura été traitée.
              </p>
            ) : (
              <>
                <Field label={PROFILE_CHANGE_LABELS.maritalStatus} htmlFor="maritalStatus">
                  <Select
                    id="maritalStatus"
                    value={valueOf('maritalStatus')}
                    onChange={(e) => set('maritalStatus', e.target.value)}
                  >
                    <option value="">—</option>
                    {Object.entries(marital).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={PROFILE_CHANGE_LABELS.personalEmail} htmlFor="personalEmail">
                  <Input
                    id="personalEmail"
                    type="email"
                    value={valueOf('personalEmail')}
                    onChange={(e) => set('personalEmail', e.target.value)}
                  />
                </Field>
                <Field label={PROFILE_CHANGE_LABELS.phone} htmlFor="phone">
                  <Input
                    id="phone"
                    value={valueOf('phone')}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                </Field>
                <Field label={PROFILE_CHANGE_LABELS.addressLine} htmlFor="addressLine">
                  <Input
                    id="addressLine"
                    value={valueOf('addressLine')}
                    onChange={(e) => set('addressLine', e.target.value)}
                  />
                </Field>
                <Field label={PROFILE_CHANGE_LABELS.city} htmlFor="city">
                  <Input
                    id="city"
                    value={valueOf('city')}
                    onChange={(e) => set('city', e.target.value)}
                  />
                </Field>
                <Field
                  label={PROFILE_CHANGE_LABELS.emergencyContactName}
                  htmlFor="emergencyContactName"
                >
                  <Input
                    id="emergencyContactName"
                    value={valueOf('emergencyContactName')}
                    onChange={(e) => set('emergencyContactName', e.target.value)}
                  />
                </Field>
                <Field
                  label={PROFILE_CHANGE_LABELS.emergencyContactPhone}
                  htmlFor="emergencyContactPhone"
                >
                  <Input
                    id="emergencyContactPhone"
                    value={valueOf('emergencyContactPhone')}
                    onChange={(e) => set('emergencyContactPhone', e.target.value)}
                  />
                </Field>
                <Field label="Précision (facultatif)" htmlFor="note">
                  <Input
                    id="note"
                    placeholder="Ex : déménagement au 1er septembre"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                {error ? (
                  <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
                ) : null}
                {sent ? (
                  <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
                    Signalement envoyé — la Direction du Capital Humain a été prévenue.
                  </p>
                ) : null}
                <Button
                  disabled={modifies.length === 0}
                  loading={submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {modifies.length > 0
                    ? `Signaler ${modifies.length} changement${modifies.length > 1 ? 's' : ''}`
                    : 'Signaler un changement'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suivi de mes signalements</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (requests.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucun signalement pour le moment — votre historique apparaîtra ici.
              </p>
            ) : (
              <ul className="flex flex-col">
                {requests.data!.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1 border-b border-line-soft py-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink-strong">
                        {r.fields.map((f) => f.label).join(', ')}
                      </p>
                      <Badge tone={PROFILE_CHANGE_STATUS_TONES[r.status]}>
                        {PROFILE_CHANGE_STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-muted">
                      Signalé {timeAgo(r.createdAt)}
                      {r.handledByName ? ` · traité par ${r.handledByName}` : ''}
                    </p>
                    {r.hrMessage ? (
                      <p className="text-xs text-ink-muted italic">« {r.hrMessage} »</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
