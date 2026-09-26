'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EmployeeListItem, EmployeeListPage, OrgUnitView } from '@teranga/contracts';
import { orgUnitLabel } from '@teranga/contracts';
import { Button, Field, Input, Select } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { COUNTRIES, composePhone, countryByCode, DEFAULT_COUNTRY } from '../lib/countries';
import { contractEnd, maritalLabels, maxBirthDate } from '../lib/person';
import { useResponsablesPossibles } from '../lib/responsables';
import { formatDate } from '../lib/hooks';
import { Modal, ModalGrid, ModalSection } from './modal';
import { PhoneInput } from './phone-input';
import { composeWorkEmail, WorkEmailInput } from './work-email-input';

const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Création d'un employé, en fenêtre plutôt qu'en page : la liste reste
 * derrière, et refermer rend exactement l'écran d'où l'on vient — au lieu de
 * renvoyer l'utilisateur en arrière dans l'historique.
 */
export function EmployeeCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // État civil
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [gender, setGender] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthCountry, setBirthCountry] = useState('');
  const [idType, setIdType] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuedOn, setIdIssuedOn] = useState('');
  const [idExpiresOn, setIdExpiresOn] = useState('');
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [addressLine, setAddressLine] = useState('');

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
  const directionChoisie = directions.find((u) => u.id === directionId);
  // Les responsables possibles : ceux de la direction choisie, plus le
  // directeur général — de qui relève un directeur, et lui seul quand la
  // direction n'a pas encore de tête.
  const { options: managers } = useResponsablesPossibles(
    directionChoisie ? (directionChoisie.shortName ?? directionChoisie.name) : null,
  );
  const marital = maritalLabels(gender || undefined);
  // D'abord l'affectation, ensuite la hiérarchie. L'affectation ne part
  // qu'avec un poste : sans direction ET poste, pas de n+1.
  const peutChoisirLeN1 = Boolean(directionChoisie) && positionTitle.trim().length > 0;

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
      await api<{ id: string }>('/employees', {
        method: 'POST',
        body: {
          person: {
            givenName,
            familyName,
            gender: gender || undefined,
            birthDate: birthDate || undefined,
            birthPlace: birthCountry ? countryByCode(birthCountry)?.name : undefined,
            maritalStatus: maritalStatus || undefined,
            nationalId: idType ? idNumber.trim() : undefined,
            idDocumentType: idType || undefined,
            idDocumentIssuedOn: idType && idIssuedOn ? idIssuedOn : undefined,
            idDocumentExpiresOn: idType && idExpiresOn ? idExpiresOn : undefined,
            personalEmail: personalEmail || undefined,
            phone: composePhone(phoneCountry, phoneLocal),
            addressLine: addressLine || undefined,
          },
          employee: {
            employeeNumber,
            hiredOn: contractStart,
            workEmail: composeWorkEmail(workEmail),
            workPhone: composePhone(workPhoneCountry, workPhoneLocal),
            // Le n+1 part avec l'affectation, jamais sans elle.
            managerEmployeeId: peutChoisirLeN1 && managerId ? managerId : undefined,
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
      // La liste derrière la fenêtre doit montrer l'arrivant à la fermeture.
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      // Le bandeau de la chaîne hiérarchique se recompte : un rattachement
      // vient peut-être de disparaître de ses anomalies.
      await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvel employé"
      subtitle="Les champs marqués * sont obligatoires"
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
          <Button onClick={submit} loading={saving} disabled={!canSubmit}>
            Créer l&apos;employé
          </Button>
        </>
      }
    >
      <ModalSection title="État civil">
        <ModalGrid>
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
          </Field>
          <Field label="Pays de naissance" htmlFor="birthCountry">
            <Select
              id="birthCountry"
              value={birthCountry}
              onChange={(e) => setBirthCountry(e.target.value)}
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Pièce d'identité" htmlFor="idType">
            <Select id="idType" value={idType} onChange={(e) => setIdType(e.target.value)}>
              <option value="">—</option>
              <option value="cni">Carte Nationale d&apos;Identité</option>
              <option value="passport">Passeport</option>
            </Select>
          </Field>
          {idType ? (
            <>
              <Field label="Numéro de la pièce" htmlFor="idNumber" required>
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
          {/* Seule de sa rangée depuis le retrait de « Ville » — et de toute
              façon le champ le plus long de la section. */}
          <div className="sm:col-span-2">
            <Field label="Adresse" htmlFor="addressLine">
              <Input
                id="addressLine"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
              />
            </Field>
          </div>
        </ModalGrid>
      </ModalSection>

      <ModalSection title="Emploi">
        <ModalGrid>
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
            <WorkEmailInput id="workEmail" value={workEmail} onChange={setWorkEmail} />
          </Field>
          <Field label="Téléphone professionnel" htmlFor="workPhone">
            <PhoneInput
              id="workPhone"
              country={workPhoneCountry}
              local={workPhoneLocal}
              onCountryChange={setWorkPhoneCountry}
              onLocalChange={setWorkPhoneLocal}
            />
          </Field>
          <Field label="Poste" htmlFor="positionTitle">
            <Input
              id="positionTitle"
              value={positionTitle}
              onChange={(e) => setPositionTitle(e.target.value)}
            />
          </Field>
          <Field label="Direction affectée" htmlFor="directionId">
            <Select
              id="directionId"
              value={directionId}
              onChange={(e) => {
                // Le responsable appartenait à l'ancienne direction : le
                // garder ferait échouer l'enregistrement sur une règle qu'on
                // vient de rendre fausse sous ses pieds.
                setDirectionId(e.target.value);
                setManagerId('');
              }}
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
            label="Responsable hiérarchique (n+1)"
            htmlFor="managerId"
            hint={
              peutChoisirLeN1 && directionChoisie
                ? `Les agents de ${directionChoisie.shortName ?? directionChoisie.name}, et le directeur général.`
                : 'Renseignez d’abord le poste et la direction : le n+1 se choisit ensuite.'
            }
          >
            <Select
              id="managerId"
              value={peutChoisirLeN1 ? managerId : ''}
              disabled={!peutChoisirLeN1}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">— À désigner plus tard</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                  {m.poste ? ` — ${m.poste}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}
