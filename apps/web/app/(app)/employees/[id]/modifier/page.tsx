'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type {
  CursorPage,
  EmployeeDetail,
  EmployeeListItem,
  UpdateEmployeeInput,
} from '@teranga/contracts';
import {
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
import { api, ApiError } from '../../../../../lib/api';
import { COUNTRIES } from '../../../../../lib/countries';
import { maritalLabels, maxBirthDate } from '../../../../../lib/person';

/**
 * Formulaire à plat (chaînes vides pour « vide »), re-mappé à l'envoi :
 * seuls les champs modifiés partent en PATCH — '' devient null (effacement).
 */
interface FormValues {
  givenName: string;
  familyName: string;
  gender: string;
  birthDate: string;
  birthPlace: string;
  maritalStatus: string;
  nationality: string;
  nationalId: string;
  idDocumentType: string;
  idDocumentIssuedOn: string;
  idDocumentExpiresOn: string;
  personalEmail: string;
  phone: string;
  addressLine: string;
  city: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  employeeNumber: string;
  hiredOn: string;
  workEmail: string;
  workPhone: string;
  status: string;
  managerEmployeeId: string;
}

const PERSON_KEYS = [
  'givenName',
  'familyName',
  'gender',
  'birthDate',
  'birthPlace',
  'maritalStatus',
  'nationality',
  'nationalId',
  'idDocumentType',
  'idDocumentIssuedOn',
  'idDocumentExpiresOn',
  'personalEmail',
  'phone',
  'addressLine',
  'city',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
const EMPLOYEE_KEYS = [
  'employeeNumber',
  'hiredOn',
  'workEmail',
  'workPhone',
  'status',
  'managerEmployeeId',
] as const;
const REQUIRED_KEYS = new Set(['givenName', 'familyName', 'employeeNumber', 'hiredOn', 'status']);
/** Champs qu'on ne peut pas effacer : vidés, ils restent simplement inchangés. */
const KEEP_IF_EMPTY = new Set(['nationality']);

function toDefaults(e: EmployeeDetail): FormValues {
  return {
    givenName: e.person.givenName,
    familyName: e.person.familyName,
    gender: e.person.gender ?? '',
    birthDate: e.person.birthDate ?? '',
    birthPlace: e.person.birthPlace ?? '',
    maritalStatus: e.person.maritalStatus ?? '',
    nationality: e.person.nationality ?? '',
    nationalId: e.person.nationalId ?? '',
    idDocumentType: e.person.idDocumentType ?? '',
    idDocumentIssuedOn: e.person.idDocumentIssuedOn ?? '',
    idDocumentExpiresOn: e.person.idDocumentExpiresOn ?? '',
    personalEmail: e.person.personalEmail ?? '',
    phone: e.person.phone ?? '',
    addressLine: e.person.addressLine ?? '',
    city: e.person.city ?? '',
    emergencyContactName: e.person.emergencyContactName ?? '',
    emergencyContactPhone: e.person.emergencyContactPhone ?? '',
    employeeNumber: e.employeeNumber,
    hiredOn: e.hiredOn,
    workEmail: e.workEmail ?? '',
    workPhone: e.workPhone ?? '',
    status: e.status,
    // Vidé, le champ vaut « plus de manager » : c'est bien un effacement.
    managerEmployeeId: e.managerId ?? '',
  };
}

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<EmployeeDetail>(`/employees/${id}`),
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    const message =
      detail.error instanceof ApiError ? detail.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }
  return <EditForm employee={detail.data} />;
}

function EditForm({ employee }: { employee: EmployeeDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const managerQuery = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => api<CursorPage<EmployeeListItem>>('/employees?status=active&limit=100'),
  });
  const managers = managerQuery.data?.items ?? [];

  const form = useForm<FormValues>({ defaultValues: toDefaults(employee) });
  const errors = form.formState.errors;
  const watchedGender = form.watch('gender');
  const watchedIdType = form.watch('idDocumentType');
  const marital = maritalLabels(watchedGender || undefined);

  const onSubmit = form.handleSubmit(async (v) => {
    setServerError(null);
    const dirty = form.formState.dirtyFields;
    const pick = (keys: readonly (keyof FormValues)[]) => {
      const out: Record<string, string | null> = {};
      for (const k of keys) {
        if (!dirty[k]) continue;
        const value = v[k].trim();
        if (value === '' && KEEP_IF_EMPTY.has(k)) continue;
        out[k] = value === '' && !REQUIRED_KEYS.has(k) ? null : value;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    };
    const body: UpdateEmployeeInput = {
      person: pick(PERSON_KEYS) as UpdateEmployeeInput['person'],
      employee: pick(EMPLOYEE_KEYS) as UpdateEmployeeInput['employee'],
    };
    if (!body.person && !body.employee) {
      router.push(`/employees/${employee.id}`);
      return;
    }
    try {
      await api(`/employees/${employee.id}`, { method: 'PATCH', body });
      await queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      router.push(`/employees/${employee.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    }
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href={`/employees/${employee.id}`} className="text-sm text-ink-muted hover:text-ink">
          ← Fiche de {employee.person.givenName} {employee.person.familyName}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Modifier la fiche</h1>
        <p className="text-sm text-ink-muted">
          Chaque modification est tracée dans l&apos;historique du dossier.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>État civil</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="givenName" error={errors.givenName?.message} required>
              <Input
                id="givenName"
                {...form.register('givenName', { required: 'Le prénom est requis' })}
              />
            </Field>
            <Field label="Nom" htmlFor="familyName" error={errors.familyName?.message} required>
              <Input
                id="familyName"
                {...form.register('familyName', { required: 'Le nom est requis' })}
              />
            </Field>
            <Field label="Sexe" htmlFor="gender">
              <Select id="gender" {...form.register('gender')}>
                <option value="">—</option>
                <option value="male">Masculin</option>
                <option value="female">Féminin</option>
              </Select>
            </Field>
            <Field label="Situation matrimoniale" htmlFor="maritalStatus">
              <Select id="maritalStatus" {...form.register('maritalStatus')}>
                <option value="">—</option>
                <option value="single">{marital.single}</option>
                <option value="married">{marital.married}</option>
                <option value="divorced">{marital.divorced}</option>
                <option value="widowed">{marital.widowed}</option>
              </Select>
            </Field>
            <Field label="Date de naissance" htmlFor="birthDate">
              <Input
                id="birthDate"
                type="date"
                max={maxBirthDate()}
                {...form.register('birthDate')}
              />
            </Field>
            <Field label="Pays de naissance" htmlFor="birthPlace">
              <Select id="birthPlace" {...form.register('birthPlace')}>
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nationalité (code pays)" htmlFor="nationality">
              <Input
                id="nationality"
                maxLength={2}
                placeholder="SN"
                {...form.register('nationality')}
              />
            </Field>
            <Field label="Pièce d'identité" htmlFor="idDocumentType">
              <Select id="idDocumentType" {...form.register('idDocumentType')}>
                <option value="">—</option>
                <option value="cni">CNI</option>
                <option value="passport">Passeport</option>
              </Select>
            </Field>
            {watchedIdType ? (
              <>
                <Field label="Numéro de la pièce (chiffré au stockage)" htmlFor="nationalId">
                  <Input id="nationalId" {...form.register('nationalId')} />
                </Field>
                <Field label="Date de délivrance" htmlFor="idDocumentIssuedOn">
                  <Input
                    id="idDocumentIssuedOn"
                    type="date"
                    {...form.register('idDocumentIssuedOn')}
                  />
                </Field>
                <Field label="Date d'expiration" htmlFor="idDocumentExpiresOn">
                  <Input
                    id="idDocumentExpiresOn"
                    type="date"
                    {...form.register('idDocumentExpiresOn')}
                  />
                </Field>
              </>
            ) : null}
            <Field label="Téléphone" htmlFor="phone">
              <Input id="phone" {...form.register('phone')} />
            </Field>
            <Field label="Email personnel" htmlFor="personalEmail">
              <Input id="personalEmail" type="email" {...form.register('personalEmail')} />
            </Field>
            <Field label="Ville" htmlFor="city">
              <Input id="city" {...form.register('city')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Adresse" htmlFor="addressLine">
                <Input id="addressLine" {...form.register('addressLine')} />
              </Field>
            </div>
            <Field label="Contact d'urgence — nom" htmlFor="emergencyContactName">
              <Input id="emergencyContactName" {...form.register('emergencyContactName')} />
            </Field>
            <Field label="Contact d'urgence — téléphone" htmlFor="emergencyContactPhone">
              <Input id="emergencyContactPhone" {...form.register('emergencyContactPhone')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emploi</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Matricule"
              htmlFor="employeeNumber"
              error={errors.employeeNumber?.message}
              required
            >
              <Input
                id="employeeNumber"
                {...form.register('employeeNumber', { required: 'Le matricule est requis' })}
              />
            </Field>
            <Field
              label="Manager"
              htmlFor="managerEmployeeId"
              hint="À qui la personne rend compte. Laisser vide si elle n’en a pas."
            >
              <Select id="managerEmployeeId" {...form.register('managerEmployeeId')}>
                <option value="">— Aucun</option>
                {managers
                  .filter((m) => m.id !== employee.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.givenName} {m.familyName}
                      {m.positionTitle ? ` — ${m.positionTitle}` : ''}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              label="Début du contrat"
              htmlFor="hiredOn"
              error={errors.hiredOn?.message}
              required
            >
              <Input
                id="hiredOn"
                type="date"
                {...form.register('hiredOn', { required: "La date d'embauche est requise" })}
              />
            </Field>
            <Field label="Email professionnel" htmlFor="workEmail">
              <Input id="workEmail" type="email" {...form.register('workEmail')} />
            </Field>
            <Field label="Téléphone professionnel" htmlFor="workPhone">
              <Input id="workPhone" {...form.register('workPhone')} />
            </Field>
            <Field label="Statut" htmlFor="status" required>
              <Select id="status" {...form.register('status')}>
                <option value="active">Actif</option>
                <option value="suspended">Suspendu</option>
                <option value="terminated">Sorti</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {serverError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Link href={`/employees/${employee.id}`}>
            <Button variant="secondary">Annuler</Button>
          </Link>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Enregistrer
          </Button>
        </div>
      </form>
    </div>
  );
}
