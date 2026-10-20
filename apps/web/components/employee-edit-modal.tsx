'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type {
  EmployeeDetail,
  OrgUnitView,
  RattachementChoisi,
  UpdateEmployeeInput,
} from '@teranga/contracts';
import { peut } from '@teranga/contracts';
import { Button, Field, Input, Select, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { composePhone, COUNTRIES, splitPhone } from '../lib/countries';
import { useMe } from '../lib/hooks';
import { maritalLabels, maxBirthDate } from '../lib/person';
import {
  libelleResponsable,
  rattachementsPossibles,
  useN1FonctionnelsPossibles,
} from '../lib/responsables';
import { Modal, ModalGrid, ModalSection } from './modal';
import { PhoneInput } from './phone-input';
import { composeWorkEmail, localWorkEmail, WorkEmailInput } from './work-email-input';

/**
 * Un téléphone dans ce formulaire.
 *
 * Le champ enregistré par react-hook-form reste la chaîne COMPLÈTE
 * (« +221771234567 ») : c'est elle que le PATCH envoie, et c'est sur elle que
 * `dirtyFields` décide si le champ a bougé. Le pays et le numéro local ne sont
 * qu'un moyen de la saisir — ils vivent donc ici, en état local, et chaque
 * frappe recompose la valeur enregistrée.
 */
function ChampTelephone({
  id,
  stocke,
  onChange,
}: {
  id: string;
  stocke: string | null;
  onChange: (valeur: string) => void;
}) {
  const depart = splitPhone(stocke);
  const [pays, setPays] = useState(depart.country);
  const [local, setLocal] = useState(depart.local);
  return (
    <PhoneInput
      id={id}
      country={pays}
      local={local}
      onCountryChange={(c) => {
        setPays(c);
        onChange(composePhone(c, local) ?? '');
      }}
      onLocalChange={(v) => {
        setLocal(v);
        onChange(composePhone(pays, v) ?? '');
      }}
    />
  );
}

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
  nationalId: string;
  idDocumentType: string;
  idDocumentIssuedOn: string;
  idDocumentExpiresOn: string;
  personalEmail: string;
  phone: string;
  addressLine: string;
  employeeNumber: string;
  hiredOn: string;
  workEmail: string;
  workPhone: string;
  status: string;
  /** `''` : identique au N+1 hiérarchique. */
  n1FonctionnelId: string;
  /** À la Direction Générale : `''` le DG, `dga`, ou `unite:<id>`. */
  rattachement: string;
}

const PERSON_KEYS = [
  'givenName',
  'familyName',
  'gender',
  'birthDate',
  'birthPlace',
  'maritalStatus',
  'nationalId',
  'idDocumentType',
  'idDocumentIssuedOn',
  'idDocumentExpiresOn',
  'personalEmail',
  'phone',
  'addressLine',
] as const;
const EMPLOYEE_KEYS = ['employeeNumber', 'hiredOn', 'workEmail', 'workPhone', 'status'] as const;
const REQUIRED_KEYS = new Set(['givenName', 'familyName', 'employeeNumber', 'hiredOn', 'status']);

function toDefaults(e: EmployeeDetail): FormValues {
  return {
    givenName: e.person.givenName,
    familyName: e.person.familyName,
    gender: e.person.gender ?? '',
    birthDate: e.person.birthDate ?? '',
    birthPlace: e.person.birthPlace ?? '',
    maritalStatus: e.person.maritalStatus ?? '',
    nationalId: e.person.nationalId ?? '',
    idDocumentType: e.person.idDocumentType ?? '',
    idDocumentIssuedOn: e.person.idDocumentIssuedOn ?? '',
    idDocumentExpiresOn: e.person.idDocumentExpiresOn ?? '',
    personalEmail: e.person.personalEmail ?? '',
    phone: e.person.phone ?? '',
    addressLine: e.person.addressLine ?? '',
    employeeNumber: e.employeeNumber,
    hiredOn: e.hiredOn,
    workEmail: localWorkEmail(e.workEmail),
    workPhone: e.workPhone ?? '',
    status: e.status,
    n1FonctionnelId: e.n1Fonctionnel?.id ?? '',
    rattachement: valeurDuRattachement(e.rattachementChoisi),
  };
}

function valeurDuRattachement(r: RattachementChoisi | null): string {
  if (!r) return '';
  return r.type === 'dga' ? 'dga' : `unite:${r.uniteId}`;
}

function versRattachement(valeur: string): RattachementChoisi | null {
  if (valeur === 'dga') return { type: 'dga' };
  if (valeur.startsWith('unite:')) return { type: 'unite', uniteId: valeur.slice(6) };
  return null;
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
  // Sans les données sensibles, le numéro de la pièce est masqué : il ne se
  // modifie pas non plus.
  const voitSensible = peut(useMe().data, 'personnel.sensible');
  const [serverError, setServerError] = useState<string | null>(null);

  // Les deux N+1 (ADR-0147). Le hiérarchique se lit : l'organigramme le
  // donne. Ce N+1 ne se choisit qu'à la Direction Générale, pour qui y est
  // rattaché directement. Le fonctionnel se choisit ; le DG n'en a pas.
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });
  const estDG = (unites.data ?? []).some((u) => u.sommet && u.managerEmployeeId === employee.id);
  const { options: fonctionnels } = useN1FonctionnelsPossibles(employee.id, !estDG);
  const fonctionnel = employee.n1Fonctionnel;
  const n1Fonctionnels =
    fonctionnel && !fonctionnels.some((m) => m.id === fonctionnel.id)
      ? [...fonctionnels, fonctionnel]
      : fonctionnels;
  const rattachements = rattachementsPossibles(unites.data ?? [], employee.id);
  // La place choisie, vacante aujourd'hui, reste choisie : elle reste donc
  // dans la liste.
  const choisi = valeurDuRattachement(employee.rattachementChoisi);
  if (choisi && !rattachements.some((r) => r.valeur === choisi)) {
    rattachements.push({
      valeur: choisi,
      libelle:
        choisi === 'dga' ? 'DGA' : (employee.rattachementChoisi?.uniteNom ?? 'Unité choisie'),
    });
  }
  const hierarchique = employee.managerName
    ? libelleResponsable({
        id: employee.managerId ?? '',
        nom: employee.managerName,
        matricule: employee.managerNumber,
      })
    : 'Aucun';

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
    const emploi = { ...pick(EMPLOYEE_KEYS) } as NonNullable<UpdateEmployeeInput['employee']>;
    if (dirty.rattachement) emploi.rattachementChoisi = versRattachement(v.rattachement);
    if (dirty.n1FonctionnelId) emploi.n1FonctionnelId = v.n1FonctionnelId || null;
    const body: UpdateEmployeeInput = {
      person: pick(PERSON_KEYS) as UpdateEmployeeInput['person'],
      employee: Object.keys(emploi).length > 0 ? emploi : undefined,
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
      // Le bandeau de la chaîne hiérarchique se recompte : un rattachement
      // vient peut-être de disparaître de ses anomalies.
      await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
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
                <Input
                  id="nationalId"
                  placeholder={voitSensible ? undefined : 'Masqué'}
                  {...form.register('nationalId', { disabled: !voitSensible })}
                />
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
            <ChampTelephone
              id="phone"
              stocke={employee.person.phone}
              onChange={(v) => form.setValue('phone', v, { shouldDirty: true })}
            />
          </Field>
          <Field label="Email personnel" htmlFor="personalEmail">
            <Input id="personalEmail" type="email" {...form.register('personalEmail')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Adresse" htmlFor="addressLine">
              <Input id="addressLine" {...form.register('addressLine')} />
            </Field>
          </div>
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
              // Passé 30 jours, le matricule reste à la personne.
              className={
                employee.matriculeFige
                  ? 'cursor-default bg-bg text-ink-muted uppercase focus:border-line'
                  : 'uppercase'
              }
              readOnly={employee.matriculeFige}
              {...form.register('employeeNumber', {
                required: 'Le matricule est requis',
                setValueAs: (v: string) => v.toUpperCase(),
              })}
            />
          </Field>
          {/* La date d'embauche, et elle seule : le début d'un contrat se
              corrige sur le contrat, dans le bloc Contrats de la fiche. */}
          <Field label="Date d’embauche" htmlFor="hiredOn" error={errors.hiredOn?.message} required>
            <Input
              id="hiredOn"
              type="date"
              {...form.register('hiredOn', { required: 'La date d’embauche est requise' })}
            />
          </Field>
          <Field label="N+1 hiérarchique" htmlFor="rattachement">
            {employee.rattachementAuChoix ? (
              <Select id="rattachement" {...form.register('rattachement')}>
                {rattachements.map((r) => (
                  <option key={r.valeur} value={r.valeur}>
                    {r.libelle}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="rattachement"
                className="cursor-default bg-bg text-ink-muted focus:border-line"
                readOnly
                value={hierarchique}
              />
            )}
          </Field>
          {estDG ? null : (
            <Field label="N+1 fonctionnel" htmlFor="n1FonctionnelId">
              <Select id="n1FonctionnelId" {...form.register('n1FonctionnelId')}>
                <option value="">Identique au N+1 hiérarchique</option>
                {n1Fonctionnels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {libelleResponsable(m)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Email professionnel" htmlFor="workEmail">
            <WorkEmailInput
              id="workEmail"
              value={form.watch('workEmail')}
              onChange={(local) => form.setValue('workEmail', local, { shouldDirty: true })}
            />
          </Field>
          <Field label="Téléphone professionnel" htmlFor="workPhone">
            <ChampTelephone
              id="workPhone"
              stocke={employee.workPhone}
              onChange={(v) => form.setValue('workPhone', v, { shouldDirty: true })}
            />
          </Field>
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}
