'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CursorPage, EmployeeListItem, OrgUnitView } from '@teranga/contracts';
import { nationalityLabel, orgUnitLabel } from '@teranga/contracts';
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
import { COUNTRIES, composePhone, countryByCode, DEFAULT_COUNTRY } from '../../../../lib/countries';
import { PhoneInput } from '../../../../components/phone-input';
import { contractEnd, maritalLabels, maxBirthDate } from '../../../../lib/person';
import { formatDate } from '../../../../lib/hooks';

const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export default function NewEmployeePage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // État civil
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [gender, setGender] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthCountry, setBirthCountry] = useState('');
  // La nationalité SUIT le pays de naissance tant que la RH n'y a pas touché :
  // c'est le cas courant. Dès qu'elle la choisit elle-même, on cesse de la
  // remplacer — on naît malien et on peut être sénégalais.
  const [nationality, setNationality] = useState(DEFAULT_COUNTRY);
  const [nationalityTouched, setNationalityTouched] = useState(false);
  const [idType, setIdType] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuedOn, setIdIssuedOn] = useState('');
  const [idExpiresOn, setIdExpiresOn] = useState('');
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [city, setCity] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  // Emploi
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [managerId, setManagerId] = useState('');
  const [contractType, setContractType] = useState('cdi');
  const [contractStart, setContractStart] = useState(todayIso());
  const [durationMonths, setDurationMonths] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [workPhoneCountry, setWorkPhoneCountry] = useState(DEFAULT_COUNTRY);
  const [workPhoneLocal, setWorkPhoneLocal] = useState('');
  const [positionTitle, setPositionTitle] = useState('');
  const [directionId, setDirectionId] = useState('');

  const orgUnits = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });
  const directions = (orgUnits.data ?? []).filter((u) => u.unitType === 'direction');
  // Seuls les dossiers ACTIFS peuvent encadrer : le serveur refuse les autres,
  // autant ne pas les proposer.
  const managerQuery = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => api<CursorPage<EmployeeListItem>>('/employees?status=active&limit=100'),
  });
  const managers = managerQuery.data?.items ?? [];
  const marital = maritalLabels(gender || undefined);

  const needsDuration = contractType === 'cdd' || contractType === 'stage';
  const months = Number(durationMonths);
  const computedEnd =
    needsDuration && contractStart && months > 0 ? contractEnd(contractStart, months) : null;

  const idDatesInvalid =
    (idIssuedOn && idExpiresOn && idIssuedOn >= idExpiresOn) ||
    (idExpiresOn !== '' && idExpiresOn <= todayIso());

  const canSubmit =
    givenName.trim() &&
    familyName.trim() &&
    employeeNumber.trim() &&
    contractStart &&
    (!needsDuration || months > 0) &&
    (!idType || idNumber.trim()) &&
    !idDatesInvalid;

  const submit = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const { id } = await api<{ id: string }>('/employees', {
        method: 'POST',
        body: {
          person: {
            givenName,
            familyName,
            gender: gender || undefined,
            birthDate: birthDate || undefined,
            birthPlace: birthCountry ? countryByCode(birthCountry)?.name : undefined,
            nationality,
            maritalStatus: maritalStatus || undefined,
            nationalId: idType ? idNumber.trim() : undefined,
            idDocumentType: idType || undefined,
            idDocumentIssuedOn: idType && idIssuedOn ? idIssuedOn : undefined,
            idDocumentExpiresOn: idType && idExpiresOn ? idExpiresOn : undefined,
            personalEmail: personalEmail || undefined,
            phone: composePhone(phoneCountry, phoneLocal),
            addressLine: addressLine || undefined,
            city: city || undefined,
            emergencyContactName: emergencyName || undefined,
            emergencyContactPhone: emergencyPhone || undefined,
          },
          employee: {
            employeeNumber,
            hiredOn: contractStart,
            workEmail: workEmail || undefined,
            workPhone: composePhone(workPhoneCountry, workPhoneLocal),
            managerEmployeeId: managerId || undefined,
          },
          assignment: positionTitle.trim()
            ? {
                positionTitle: positionTitle.trim(),
                orgUnitId: directionId || undefined,
                startDate: contractStart,
              }
            : undefined,
          contract: {
            contractType,
            startDate: contractStart,
            endDate: computedEnd ?? undefined,
          },
        },
      });
      router.replace(`/employees/${id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/employees" className="text-sm text-ink-muted hover:text-ink">
          ← Employés
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>État civil</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="givenName" required>
              <Input
                id="givenName"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
              />
            </Field>
            <Field label="Nom" htmlFor="familyName" required>
              <Input
                id="familyName"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
              />
            </Field>
            <Field label="Sexe" htmlFor="gender">
              <Select id="gender" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">—</option>
                <option value="male">Masculin</option>
                <option value="female">Féminin</option>
              </Select>
            </Field>
            <Field label="Situation matrimoniale" htmlFor="maritalStatus">
              <Select
                id="maritalStatus"
                value={maritalStatus}
                onChange={(e) => setMaritalStatus(e.target.value)}
              >
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
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-muted">15 ans minimum.</p>
            </Field>
            <Field label="Pays de naissance" htmlFor="birthCountry">
              <Select
                id="birthCountry"
                value={birthCountry}
                onChange={(e) => {
                  setBirthCountry(e.target.value);
                  if (!nationalityTouched && e.target.value) setNationality(e.target.value);
                }}
              >
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Nationalité"
              htmlFor="nationality"
              hint="Reprend le pays de naissance ; modifiable si elle en diffère."
            >
              <Select
                id="nationality"
                value={nationality}
                onChange={(e) => {
                  setNationality(e.target.value);
                  setNationalityTouched(true);
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {nationalityLabel(c.code) ?? c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Pièce d'identité" htmlFor="idType">
              <Select id="idType" value={idType} onChange={(e) => setIdType(e.target.value)}>
                <option value="">—</option>
                <option value="cni">CNI</option>
                <option value="passport">Passeport</option>
              </Select>
            </Field>
            {idType ? (
              <>
                <Field label="Numéro de la pièce (chiffré au stockage)" htmlFor="idNumber" required>
                  <Input
                    id="idNumber"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                  />
                </Field>
                <Field label="Date de délivrance" htmlFor="idIssuedOn">
                  <Input
                    id="idIssuedOn"
                    type="date"
                    max={todayIso()}
                    value={idIssuedOn}
                    onChange={(e) => setIdIssuedOn(e.target.value)}
                  />
                </Field>
                <Field
                  label="Date d'expiration"
                  htmlFor="idExpiresOn"
                  error={
                    idDatesInvalid
                      ? "L'expiration doit être future et postérieure à la délivrance"
                      : undefined
                  }
                >
                  <Input
                    id="idExpiresOn"
                    type="date"
                    min={tomorrowIso()}
                    value={idExpiresOn}
                    onChange={(e) => setIdExpiresOn(e.target.value)}
                  />
                </Field>
              </>
            ) : null}

            <Field label="Téléphone" htmlFor="phoneLocal">
              <PhoneInput
                id="phoneLocal"
                country={phoneCountry}
                local={phoneLocal}
                onCountryChange={setPhoneCountry}
                onLocalChange={setPhoneLocal}
              />
            </Field>
            <Field label="Email personnel" htmlFor="personalEmail">
              <Input
                id="personalEmail"
                type="email"
                value={personalEmail}
                onChange={(e) => setPersonalEmail(e.target.value)}
              />
            </Field>
            <Field label="Ville" htmlFor="city">
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="Adresse" htmlFor="addressLine">
              <Input
                id="addressLine"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
              />
            </Field>
            <Field label="Contact d'urgence — nom" htmlFor="emergencyName">
              <Input
                id="emergencyName"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
              />
            </Field>
            <Field label="Contact d'urgence — téléphone" htmlFor="emergencyPhone">
              <Input
                id="emergencyPhone"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emploi</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Matricule" htmlFor="employeeNumber" required>
              <Input
                id="employeeNumber"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
              />
            </Field>
            <Field label="Type de contrat" htmlFor="contractType" required>
              <Select
                id="contractType"
                value={contractType}
                onChange={(e) => setContractType(e.target.value)}
              >
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
                <option value="stage">Stage</option>
              </Select>
            </Field>
            <Field label="Début du contrat" htmlFor="contractStart" required>
              <Input
                id="contractStart"
                type="date"
                value={contractStart}
                onChange={(e) => setContractStart(e.target.value)}
              />
            </Field>
            {needsDuration ? (
              <Field label="Durée (mois)" htmlFor="durationMonths" required>
                <Input
                  id="durationMonths"
                  type="number"
                  min={1}
                  max={60}
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                />
                {computedEnd ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Fin du contrat : <span className="font-medium">{formatDate(computedEnd)}</span>
                  </p>
                ) : null}
              </Field>
            ) : null}
            <Field label="Email professionnel" htmlFor="workEmail">
              <Input
                id="workEmail"
                type="email"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
              />
            </Field>
            <Field label="Téléphone professionnel" htmlFor="workPhone">
              <PhoneInput
                id="workPhone"
                country={workPhoneCountry}
                local={workPhoneLocal}
                onCountryChange={setWorkPhoneCountry}
                onLocalChange={setWorkPhoneLocal}
                placeholder="33 889 11 22"
              />
            </Field>
            <Field label="Poste" htmlFor="positionTitle">
              <Input
                id="positionTitle"
                placeholder="Ex : Chargée d'études"
                value={positionTitle}
                onChange={(e) => setPositionTitle(e.target.value)}
              />
            </Field>
            <Field label="Direction affectée" htmlFor="directionId">
              <Select
                id="directionId"
                value={directionId}
                onChange={(e) => setDirectionId(e.target.value)}
              >
                <option value="">—</option>
                {directions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {orgUnitLabel(u)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Manager"
              htmlFor="managerId"
              hint="À qui la personne rend compte. Un directeur général n’en a pas."
            >
              <Select
                id="managerId"
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
              >
                <option value="">— Aucun</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.givenName} {m.familyName}
                    {m.positionTitle ? ` — ${m.positionTitle}` : ''}
                  </option>
                ))}
              </Select>
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
          <Button onClick={submit} loading={saving} disabled={!canSubmit}>
            Créer l&apos;employé
          </Button>
        </div>
      </div>
    </div>
  );
}
