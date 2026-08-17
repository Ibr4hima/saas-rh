'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  contractTypeSchema,
  employeeFieldsSchema,
  personFieldsSchema,
  type OrgUnit,
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
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';

/** Formulaire à plat, re-mappé vers CreateEmployeeInput à l'envoi. */
const formSchema = z.object({
  ...personFieldsSchema.shape,
  ...employeeFieldsSchema.omit({ customFields: true }).shape,
  positionTitle: z.string().trim().max(120).optional(),
  orgUnitId: z.string().optional(),
  contractType: contractTypeSchema.or(z.literal('')).optional(),
  contractStart: z.iso.date().or(z.literal('')).optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function NewEmployeePage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const orgUnits = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnit[]>('/org-units'),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { hiredOn: new Date().toISOString().slice(0, 10) },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setServerError(null);
    try {
      const { id } = await api<{ id: string }>('/employees', {
        method: 'POST',
        body: {
          person: {
            givenName: v.givenName,
            familyName: v.familyName,
            gender: v.gender || undefined,
            birthDate: v.birthDate || undefined,
            birthPlace: v.birthPlace,
            maritalStatus: v.maritalStatus || undefined,
            nationalId: v.nationalId,
            personalEmail: v.personalEmail || undefined,
            phone: v.phone,
            addressLine: v.addressLine,
            city: v.city,
            emergencyContactName: v.emergencyContactName,
            emergencyContactPhone: v.emergencyContactPhone,
          },
          employee: {
            employeeNumber: v.employeeNumber,
            hiredOn: v.hiredOn,
            workEmail: v.workEmail || undefined,
            workPhone: v.workPhone,
          },
          assignment: v.positionTitle
            ? {
                positionTitle: v.positionTitle,
                orgUnitId: v.orgUnitId || undefined,
                startDate: v.hiredOn,
              }
            : undefined,
          contract: v.contractType
            ? { contractType: v.contractType, startDate: v.contractStart || v.hiredOn }
            : undefined,
        },
      });
      router.replace(`/employees/${id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    }
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/employees" className="text-sm text-ink-muted hover:text-ink">
          ← Employés
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Nouvel employé</h1>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>État civil</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="givenName" error={errors.givenName?.message} required>
              <Input id="givenName" {...form.register('givenName')} />
            </Field>
            <Field label="Nom" htmlFor="familyName" error={errors.familyName?.message} required>
              <Input id="familyName" {...form.register('familyName')} />
            </Field>
            <Field label="Genre" htmlFor="gender" error={errors.gender?.message}>
              <Select id="gender" {...form.register('gender')}>
                <option value="">—</option>
                <option value="female">Femme</option>
                <option value="male">Homme</option>
              </Select>
            </Field>
            <Field
              label="Situation familiale"
              htmlFor="maritalStatus"
              error={errors.maritalStatus?.message}
            >
              <Select id="maritalStatus" {...form.register('maritalStatus')}>
                <option value="">—</option>
                <option value="single">Célibataire</option>
                <option value="married">Marié·e</option>
                <option value="divorced">Divorcé·e</option>
                <option value="widowed">Veuf·ve</option>
              </Select>
            </Field>
            <Field label="Date de naissance" htmlFor="birthDate" error={errors.birthDate?.message}>
              <Input id="birthDate" type="date" {...form.register('birthDate')} />
            </Field>
            <Field
              label="Lieu de naissance"
              htmlFor="birthPlace"
              error={errors.birthPlace?.message}
            >
              <Input id="birthPlace" {...form.register('birthPlace')} />
            </Field>
            <Field
              label="N° CNI (chiffré au stockage)"
              htmlFor="nationalId"
              error={errors.nationalId?.message}
            >
              <Input id="nationalId" {...form.register('nationalId')} />
            </Field>
            <Field label="Téléphone" htmlFor="phone" error={errors.phone?.message}>
              <Input id="phone" {...form.register('phone')} />
            </Field>
            <Field
              label="Email personnel"
              htmlFor="personalEmail"
              error={errors.personalEmail?.message}
            >
              <Input id="personalEmail" type="email" {...form.register('personalEmail')} />
            </Field>
            <Field label="Ville" htmlFor="city" error={errors.city?.message}>
              <Input id="city" {...form.register('city')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Adresse" htmlFor="addressLine" error={errors.addressLine?.message}>
                <Input id="addressLine" {...form.register('addressLine')} />
              </Field>
            </div>
            <Field
              label="Contact d'urgence — nom"
              htmlFor="emergencyContactName"
              error={errors.emergencyContactName?.message}
            >
              <Input id="emergencyContactName" {...form.register('emergencyContactName')} />
            </Field>
            <Field
              label="Contact d'urgence — téléphone"
              htmlFor="emergencyContactPhone"
              error={errors.emergencyContactPhone?.message}
            >
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
              <Input id="employeeNumber" {...form.register('employeeNumber')} />
            </Field>
            <Field
              label="Date d'embauche"
              htmlFor="hiredOn"
              error={errors.hiredOn?.message}
              required
            >
              <Input id="hiredOn" type="date" {...form.register('hiredOn')} />
            </Field>
            <Field
              label="Email professionnel"
              htmlFor="workEmail"
              error={errors.workEmail?.message}
            >
              <Input id="workEmail" type="email" {...form.register('workEmail')} />
            </Field>
            <Field
              label="Téléphone professionnel"
              htmlFor="workPhone"
              error={errors.workPhone?.message}
            >
              <Input id="workPhone" {...form.register('workPhone')} />
            </Field>
            <Field label="Poste" htmlFor="positionTitle" error={errors.positionTitle?.message}>
              <Input
                id="positionTitle"
                placeholder="Ex : Chargée d'études"
                {...form.register('positionTitle')}
              />
            </Field>
            <Field label="Unité d'organisation" htmlFor="orgUnitId">
              <Select id="orgUnitId" {...form.register('orgUnitId')}>
                <option value="">—</option>
                {orgUnits.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Type de contrat"
              htmlFor="contractType"
              error={errors.contractType?.message}
            >
              <Select id="contractType" {...form.register('contractType')}>
                <option value="">—</option>
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
                <option value="stage">Stage</option>
                <option value="consultant">Consultant</option>
                <option value="detachement">Détachement</option>
              </Select>
            </Field>
            <Field
              label="Début du contrat"
              htmlFor="contractStart"
              error={errors.contractStart?.message}
            >
              <Input id="contractStart" type="date" {...form.register('contractStart')} />
            </Field>
          </CardContent>
        </Card>

        {serverError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Link href="/employees">
            <Button variant="secondary">Annuler</Button>
          </Link>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Créer l&apos;employé
          </Button>
        </div>
      </form>
    </div>
  );
}
