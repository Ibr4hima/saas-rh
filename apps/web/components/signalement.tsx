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
  cn,
  Field,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { composePhone, splitPhone } from '../lib/countries';
import { maritalLabels } from '../lib/person';
import { compte } from '../lib/mots';
import { timeAgo } from './document-request-list';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { Pagination, usePagination } from './pagination';
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

/**
 * Le suivi des signalements de l'agent, en tableau : ce qui change (avant,
 * après), quand il l'a signalé, qui l'a traité, où en est la demande. La
 * plus récente en tête.
 */
export function SuiviSignalements() {
  const queryClient = useQueryClient();
  const signalements = useMesSignalements();
  const liste = signalements.data ?? [];
  const { tranche, barre } = usePagination(liste);
  // La colonne des gestes n'existe que si un signalement s'annule encore.
  const avecGestes = liste.some((r) => r.canCancel);
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
    <>
      <Card className="@container overflow-hidden">
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
          // Le tableau ne s'ouvre que si la carte a la place de ses sept
          // colonnes ; plus étroite, chaque signalement se range sur une pile.
          // Les dates, les statuts et le geste gardent une largeur fixe.
          <Table className="@5xl:table-fixed">
            <THead className="hidden @5xl:table-header-group">
              <tr>
                <Th className="@5xl:w-44">Information</Th>
                <Th>Avant</Th>
                <Th>Après</Th>
                <Th className="@5xl:w-[7.5rem]">Signalé le</Th>
                <Th className="@5xl:w-32">Traité par</Th>
                <Th className="@5xl:w-28">Statut</Th>
                {avecGestes ? (
                  <Th className="@5xl:w-24">
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </THead>
            {tranche.map((r) => (
              <LigneSignalement
                key={r.id}
                signalement={r}
                avecGestes={avecGestes}
                onAnnuler={() => annuler.mutate(r.id)}
                enCours={annuler.isPending && annuler.variables === r.id}
              />
            ))}
          </Table>
        )}
      </Card>
      <Pagination {...barre} />
    </>
  );
}

/**
 * Un signalement, dans son propre groupe de lignes : une ligne par
 * information changée (information, avant, après), puis la note et le motif
 * sur toute la largeur de ces trois colonnes. La date, le traitant, le
 * statut et le geste couvrent tout le groupe. Une valeur longue passe à la
 * ligne sans décaler les autres. Dans une carte étroite, tout se range dans
 * une seule cellule.
 */
function LigneSignalement({
  signalement: r,
  avecGestes,
  onAnnuler,
  enCours,
}: {
  signalement: ProfileChangeRequestView;
  avecGestes: boolean;
  onAnnuler: () => void;
  enCours: boolean;
}) {
  const avant = (f: ProfileChangeRequestView['fields'][number]) =>
    valeurSignalee(f.field, f.previous) ?? 'Non renseigné';
  const apres = (f: ProfileChangeRequestView['fields'][number]) =>
    valeurSignalee(f.field, f.next) ?? 'Effacé';
  const signale = formatDate(r.createdAt.slice(0, 10));
  const statut = (
    <Badge tone={PROFILE_CHANGE_STATUS_TONES[r.status]}>
      {PROFILE_CHANGE_STATUS_LABELS[r.status]}
    </Badge>
  );
  const geste = r.canCancel ? (
    <Button size="sm" variant="ghost" onClick={onAnnuler} loading={enCours}>
      Annuler
    </Button>
  ) : null;
  const commentaires =
    r.note || r.hrMessage ? (
      <>
        {r.note ? <p className="text-[11.5px] text-ink-muted italic">« {r.note} »</p> : null}
        {r.hrMessage ? (
          <p
            className={cn(
              'text-[11.5px]',
              r.status === 'rejected' ? 'font-semibold text-danger' : 'text-ink-muted italic',
            )}
          >
            {r.status === 'rejected' ? `Motif : ${r.hrMessage}` : `« ${r.hrMessage} »`}
          </p>
        ) : null}
      </>
    ) : null;
  const hauteur = r.fields.length + (commentaires ? 1 : 0);
  const large = 'hidden @5xl:table-cell';
  return (
    <TBody className="group border-t border-line-soft">
      {r.fields.map((f, i) => {
        const premiere = i === 0;
        const derniere = i === r.fields.length - 1 && !commentaires;
        // Les lignes d'un même signalement se serrent ; le groupe garde
        // l'aération d'une ligne de tableau ordinaire.
        const marge = cn(premiere ? 'pt-3.5' : 'pt-1', derniere ? 'pb-3.5' : 'pb-1');
        return (
          <tr
            key={f.field}
            className={cn(
              'transition-colors duration-150 group-hover:bg-hover',
              !premiere && 'hidden @5xl:table-row',
            )}
          >
            {premiere ? (
              <Td className="@5xl:hidden">
                <ul className="flex flex-col gap-1">
                  {r.fields.map((g) => (
                    <li key={g.field} className="text-[12.5px] leading-snug text-ink-muted">
                      <span className="font-semibold text-ink-strong">{g.label}</span> : {avant(g)}{' '}
                      <span aria-hidden>→</span>{' '}
                      <span className="font-semibold text-ink-strong">{apres(g)}</span>
                    </li>
                  ))}
                </ul>
                {commentaires ? (
                  <div className="mt-1 flex flex-col gap-1">{commentaires}</div>
                ) : null}
                <p className="mt-1.5 text-[11.5px] text-ink-muted tabular-nums">
                  Signalé le {signale}
                  {r.handledByName ? ` · traité par ${r.handledByName}` : ''}
                </p>
                <div className="mt-2.5 flex items-center gap-3">
                  {statut}
                  <span className="ml-auto">{geste}</span>
                </div>
              </Td>
            ) : null}
            <Td className={cn(large, 'align-top font-semibold text-ink-strong', marge)}>
              {f.label}
            </Td>
            <Td className={cn(large, 'align-top break-words text-ink-muted', marge)}>
              <Coupable valeur={avant(f)} />
            </Td>
            <Td className={cn(large, 'align-top font-semibold break-words text-ink-strong', marge)}>
              <Coupable valeur={apres(f)} />
            </Td>
            {premiere ? (
              <>
                <Td
                  rowSpan={hauteur}
                  className={cn(large, 'align-top whitespace-nowrap tabular-nums')}
                  title={timeAgo(r.createdAt)}
                >
                  {signale}
                </Td>
                <Td rowSpan={hauteur} className={cn(large, 'align-top break-words')}>
                  {r.handledByName}
                </Td>
                <Td rowSpan={hauteur} className={cn(large, 'align-top')}>
                  {statut}
                </Td>
                {avecGestes ? (
                  <Td rowSpan={hauteur} className={cn(large, 'pl-0 text-right align-top')}>
                    {geste}
                  </Td>
                ) : null}
              </>
            ) : null}
          </tr>
        );
      })}
      {commentaires ? (
        <tr className="hidden transition-colors duration-150 group-hover:bg-hover @5xl:table-row">
          <Td colSpan={3} className={cn(large, 'pt-1 pb-3.5')}>
            <div className="flex flex-col gap-1">{commentaires}</div>
          </Td>
        </tr>
      ) : null}
    </TBody>
  );
}

/** Une adresse électronique trop longue passe à la ligne après l'arobase. */
function Coupable({ valeur }: { valeur: string }) {
  const i = valeur.indexOf('@');
  if (i < 0) return <>{valeur}</>;
  return (
    <>
      {valeur.slice(0, i + 1)}
      <wbr />
      {valeur.slice(i + 1)}
    </>
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
