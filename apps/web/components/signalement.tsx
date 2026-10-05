'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  EmployeeDetail,
  ProfileChangeField,
  ProfileChangeRequestView,
} from '@teranga/contracts';
import {
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_LABELS,
  PROFILE_CHANGE_STATUS_LABELS,
  PROFILE_CHANGE_STATUS_TONES,
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
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { composePhone, splitPhone } from '../lib/countries';
import { maritalLabels } from '../lib/person';
import { compte } from '../lib/mots';
import { timeAgo } from './document-request-list';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { PhoneInput } from './phone-input';
import { formatTelephone, valeurSignalee } from './telephone';

/* ————————————————————————————————————————————————————————————————
   Signaler un changement — ce que l'agent fait corriger lui-même.

   Quatre informations relèvent d'une déclaration (situation matrimoniale,
   email personnel, téléphone, adresse) ; le reste s'appuie sur une pièce
   officielle ou sur le contrat. Le signalement part à la Direction du
   Capital Humain, qui le valide ; son suivi se lit sur la fiche.
   ———————————————————————————————————————————————————————————————— */

type Draft = Partial<Record<ProfileChangeField, string>>;

const CLE_SIGNALEMENTS = ['profile-changes', 'me'] as const;

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

/** Les signalements de l'agent — scope=mine : même pour un membre de la DCH. */
export function useMesSignalements() {
  return useQuery({
    queryKey: CLE_SIGNALEMENTS,
    queryFn: () => api<ProfileChangeRequestView[]>('/profile-changes?scope=mine'),
  });
}

export function FenetreSignalement({
  employe,
  onClose,
}: {
  employe: EmployeeDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signalements = useMesSignalements();
  const enAttente = (signalements.data ?? []).find((r) => r.status === 'pending');

  const p = employe.person;
  const marital = maritalLabels(p.gender);

  const submit = useMutation({
    mutationFn: () =>
      api('/profile-changes', {
        method: 'POST',
        body: { changes: draft, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  /** Valeur actuelle d'un champ demandable, telle qu'elle est au dossier. */
  const current = (f: ProfileChangeField): string =>
    ({
      maritalStatus: p.maritalStatus ?? '',
      personalEmail: p.personalEmail ?? '',
      phone: p.phone ?? '',
      addressLine: p.addressLine ?? '',
    })[f];

  /** La valeur telle qu'elle SE LIT : un code d'état civil et un numéro brut
      ne se montrent pas à l'agent sous leur forme de stockage. */
  const lisible = (f: ProfileChangeField, v: string): string => {
    if (!v) return 'non renseigné';
    if (f === 'maritalStatus') return marital[v as keyof typeof marital] ?? v;
    if (f === 'phone') return formatTelephone(v) || v;
    return v;
  };

  const valueOf = (f: ProfileChangeField) => draft[f] ?? current(f);
  const set = (f: ProfileChangeField, v: string) => setDraft({ ...draft, [f]: v });
  // Seuls les champs RÉELLEMENT modifiés partent : demander à la DCH de
  // confirmer une valeur inchangée n'a aucun sens.
  const modifies = PROFILE_CHANGE_FIELDS.filter(
    (f) => draft[f] !== undefined && draft[f] !== current(f),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Signaler un changement"
      maxWidth="max-w-xl"
      footer={
        enAttente ? (
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <>
            {error ? (
              <p
                role="alert"
                className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
              >
                {error}
              </p>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button
              disabled={modifies.length === 0}
              loading={submit.isPending}
              onClick={() => {
                setError(null);
                submit.mutate();
              }}
            >
              {modifies.length > 0
                ? `Signaler ${compte(modifies.length, 'changement')}`
                : 'Signaler'}
            </Button>
          </>
        )
      }
    >
      {enAttente ? (
        <p className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-accent-text ring-1 ring-current/15 ring-inset">
          <Icon name="schedule" size={15} className="mt-px shrink-0" />
          <span>
            Un signalement attend la validation de la Direction du Capital Humain :{' '}
            {enumerer(enAttente.fields.map((f) => f.label.toLowerCase()))}. Vous pourrez en envoyer
            un nouveau dès qu&apos;il aura été traité.
          </span>
        </p>
      ) : (
        <ModalSection title="Mes infos personnelles">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            <ChampTelephone
              id="phone"
              stocke={valueOf('phone')}
              onChange={(v) => set('phone', v)}
            />
            <Field label={PROFILE_CHANGE_LABELS.addressLine} htmlFor="addressLine">
              <Input
                id="addressLine"
                value={valueOf('addressLine')}
                onChange={(e) => set('addressLine', e.target.value)}
              />
            </Field>
            <Field label="Précision" htmlFor="note" hint="Facultatif">
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            {/* Ce qui part, ligne à ligne : l'ancienne valeur et la nouvelle se
                relisent en une seconde — la dernière occasion de voir qu'on a
                corrigé le bon champ. */}
            {modifies.length > 0 ? (
              <ul className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
                {modifies.map((f) => (
                  <li key={f} className="text-[11.5px] leading-snug text-ink-muted">
                    <span className="font-semibold text-ink">{PROFILE_CHANGE_LABELS[f]}</span> :{' '}
                    {lisible(f, current(f))} <span aria-hidden>→</span>{' '}
                    <span className="font-semibold text-ink-strong">
                      {lisible(f, draft[f] ?? '')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </ModalSection>
      )}
    </Modal>
  );
}

/** Le suivi des signalements de l'agent, à la place de l'historique. */
export function SuiviSignalements() {
  const queryClient = useQueryClient();
  const signalements = useMesSignalements();
  const liste = signalements.data ?? [];
  const [erreur, setErreur] = useState<string | null>(null);
  // Tant que la DCH n'a pas tranché, le signalement s'annule d'un clic.
  const annuler = useMutation({
    mutationFn: (id: string) => api(`/profile-changes/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setErreur(null);
      void queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mes signalements</CardTitle>
      </CardHeader>
      {erreur ? (
        <p role="alert" className="px-5 pb-2 text-[12.5px] text-danger">
          {erreur}
        </p>
      ) : null}
      {liste.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-muted">
            {signalements.isLoading ? '\u00a0' : 'Aucun signalement.'}
          </p>
        </CardContent>
      ) : (
        <CardContent className="px-2 pb-2">
          <ul className="flex flex-col">
            {liste.map((r) => (
              <li
                key={r.id}
                className="rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <ul className="flex flex-col gap-1">
                      {r.fields.map((f) => (
                        <li key={f.field} className="text-[12.5px] leading-snug text-ink-muted">
                          <span className="font-semibold text-ink-strong">{f.label}</span> :{' '}
                          {valeurSignalee(f.field, f.previous) ?? 'non renseigné'}{' '}
                          <span aria-hidden>→</span>{' '}
                          <span className="font-semibold text-ink-strong">
                            {valeurSignalee(f.field, f.next) ?? 'effacé'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[11.5px] text-ink-muted">
                      Signalé {timeAgo(r.createdAt)}
                      {r.handledByName ? ` · traité par ${r.handledByName}` : ''}
                    </p>
                    {r.note ? (
                      <p className="mt-1 text-[11.5px] text-ink-muted italic">« {r.note} »</p>
                    ) : null}
                    {r.hrMessage ? (
                      <p
                        className={
                          r.status === 'rejected'
                            ? 'mt-1 text-[11.5px] font-semibold text-danger'
                            : 'mt-1 text-[11.5px] text-ink-muted italic'
                        }
                      >
                        {r.status === 'rejected' ? `Motif : ${r.hrMessage}` : `« ${r.hrMessage} »`}
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-2">
                    <Badge tone={PROFILE_CHANGE_STATUS_TONES[r.status]}>
                      {PROFILE_CHANGE_STATUS_LABELS[r.status]}
                    </Badge>
                    {r.canCancel ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => annuler.mutate(r.id)}
                        loading={annuler.isPending && annuler.variables === r.id}
                      >
                        Annuler
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Un téléphone dans ce formulaire. La valeur signalée reste la chaîne
 * COMPLÈTE (« +221771234567 ») ; le pays et le numéro local ne sont qu'un
 * moyen de la saisir.
 */
function ChampTelephone({
  id,
  stocke,
  onChange,
}: {
  id: string;
  stocke: string;
  onChange: (valeur: string) => void;
}) {
  const depart = splitPhone(stocke);
  const [pays, setPays] = useState(depart.country);
  const [local, setLocal] = useState(depart.local);
  return (
    <Field label={PROFILE_CHANGE_LABELS.phone} htmlFor={id}>
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
    </Field>
  );
}
