'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { nationalityLabel } from '@teranga/contracts';
import type {
  EmployeeDetail,
  EmployeeListItem,
  EmployeeListPage,
  UpdateEmployeeInput,
} from '@teranga/contracts';
import { Button, Field, Input, Select, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { COUNTRIES } from '../lib/countries';
import { maritalLabels, maxBirthDate } from '../lib/person';
import { Modal, ModalGrid, ModalSection } from './modal';
import { composeWorkEmail, localWorkEmail, WorkEmailInput } from './work-email-input';

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
    employeeNumber: e.employeeNumber,
    hiredOn: e.hiredOn,
    workEmail: localWorkEmail(e.workEmail),
    workPhone: e.workPhone ?? '',
    status: e.status,
    // Vidé, le champ vaut « plus de manager » : c'est bien un effacement.
    managerEmployeeId: e.managerId ?? '',
  };
}

/**
 * Modification d'un employé, en fenêtre sur sa fiche.
 *
 * Le formulaire n'est monté qu'une fois le dossier chargé : react-hook-form
 * fige ses valeurs par défaut au montage, et un formulaire monté sur un
 * dossier vide resterait vide même après l'arrivée des données.
 */
export function EmployeeEditModal({
  open,
  onClose,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
}) {
  const detail = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api<EmployeeDetail>(`/employees/${employeeId}`),
    enabled: open,
  });

  if (!open) return null;
  if (!detail.data) {
    const message =
      detail.error instanceof ApiError ? detail.error.message : 'Chargement impossible.';
    return (
      <Modal open onClose={onClose} title="Modifier la fiche">
        <ModalSection title="Dossier">
          {detail.isError ? (
            <p className="text-sm text-danger">{message}</p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </ModalSection>
      </Modal>
    );
  }
  return <EditForm employee={detail.data} onClose={onClose} />;
}

function EditForm({ employee, onClose }: { employee: EmployeeDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const managerQuery = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => api<EmployeeListPage>('/employees?status=active&limit=100'),
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
        // L'adresse professionnelle se saisit sans son domaine ; on la
        // recompose ici. Non modifiée, elle n'entre pas dans le lot et reste
        // exactement ce qu'elle était en base.
        const final = k === 'workEmail' ? (composeWorkEmail(value) ?? '') : value;
        out[k] = final === '' && !REQUIRED_KEYS.has(k) ? null : final;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    };
    const body: UpdateEmployeeInput = {
      person: pick(PERSON_KEYS) as UpdateEmployeeInput['person'],
      employee: pick(EMPLOYEE_KEYS) as UpdateEmployeeInput['employee'],
    };
    // Rien de modifié : refermer suffit, inutile d'aller déranger le serveur.
    if (!body.person && !body.employee) {
      onClose();
      return;
    }
    try {
      await api(`/employees/${employee.id}`, { method: 'PATCH', body });
      await queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Modifier la fiche"
      subtitle={`${employee.person.givenName} ${employee.person.familyName}`}
      footer={
        <>
          {serverError ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {serverError}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>
            Enregistrer
          </Button>
        </>
      }
    >
      <ModalSection title="État civil">
        <ModalGrid>
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
          <Field label="Nationalité" htmlFor="nationality">
            {/* Le code pays reste la valeur stockée ; c'est le gentilé qui
                  s'affiche — « SN » ne veut rien dire sur une fiche. Vidable :
                  « pas renseignée » est un état depuis la migration 0015. */}
            <Select id="nationality" {...form.register('nationality')}>
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {nationalityLabel(c.code) ?? c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pièce d'identité" htmlFor="idDocumentType">
            <Select id="idDocumentType" {...form.register('idDocumentType')}>
              <option value="">—</option>
              <option value="cni">Carte Nationale d&apos;Identité</option>
              <option value="passport">Passeport</option>
            </Select>
          </Field>
          {watchedIdType ? (
            <>
              <Field label="Numéro de la pièce" htmlFor="nationalId">
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
          <div className="sm:col-span-2">
            <Field label="Adresse" htmlFor="addressLine">
              <Input id="addressLine" {...form.register('addressLine')} />
            </Field>
          </div>
          <Field label="Ville" htmlFor="city">
            <Input id="city" {...form.register('city')} />
          </Field>
        </ModalGrid>
      </ModalSection>

      <ModalSection title="Emploi">
        <ModalGrid>
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
          <Field label="Manager" htmlFor="managerEmployeeId">
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
            <WorkEmailInput
              id="workEmail"
              value={form.watch('workEmail')}
              onChange={(local) => form.setValue('workEmail', local, { shouldDirty: true })}
            />
          </Field>
          <Field label="Téléphone professionnel" htmlFor="workPhone">
            <Input id="workPhone" {...form.register('workPhone')} />
          </Field>
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}
