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
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { composePhone, splitPhone } from '../../../../lib/countries';
import { formatDate } from '../../../../lib/hooks';
import { ID_DOCUMENT_LABELS, SEX_LABELS, maritalLabels } from '../../../../lib/person';
import { timeAgo } from '../../../../components/document-request-list';
import { Donnee, Groupe, Peremption } from '../../../../components/fiche';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { PhoneInput } from '../../../../components/phone-input';
import { formatTelephone, Telephone, valeurSignalee } from '../../../../components/telephone';

/* ————————————————————————————————————————————————————————————————
   Mes informations personnelles, en trois temps :

   1. « Qu'est-ce que l'APIX sait de moi ? »  → un registre, en lecture, dans
      la même écriture que la fiche que consulte la RH. Trois cartes de
      cartouches bleus n'en font plus qu'une, coupée par des filets.
   2. « Qu'est-ce que je peux corriger ? »    → les cinq informations qui
      relèvent d'une déclaration, et rien d'autre : le reste s'appuie sur une
      pièce officielle ou sur le contrat.
   3. « Où en sont mes signalements ? »       → l'historique, qui écrit enfin
      l'ancienne valeur et la nouvelle — « Ville : Dakar → Thiès ».
   ———————————————————————————————————————————————————————————————— */

type Draft = Partial<Record<ProfileChangeField, string>>;

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

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
      <div className="mx-auto flex max-w-[880px] flex-col gap-4">
        <Skeleton className="h-[340px] w-full rounded-[16px]" />
        <Skeleton className="h-64 w-full rounded-[16px]" />
      </div>
    );
  }
  if (me.isError || !me.data)
    return <LoadFailure error={me.error} onRetry={() => void me.refetch()} />;
  if (!detail.data) {
    return <LoadFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const p = detail.data.person;
  const marital = maritalLabels(p.gender);
  const signalements = requests.data ?? [];
  const enAttente = signalements.find((r) => r.status === 'pending');

  /** Valeur actuelle d'un champ demandable, telle qu'elle est au dossier. */
  const current = (f: ProfileChangeField): string =>
    ({
      maritalStatus: p.maritalStatus ?? '',
      personalEmail: p.personalEmail ?? '',
      phone: p.phone ?? '',
      addressLine: p.addressLine ?? '',
      city: p.city ?? '',
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
    <div className="mx-auto max-w-[880px]">
      <div className="mb-4">
        <Link
          href="/moi"
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="chevron_left" size={15} />
          Mon espace
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        {/* ———— Le registre ————
            Trois cartes de cartouches bleus pour quinze champs faisaient un
            mur de cadres. Une seule carte, trois sections coupées par un
            filet : c'est l'écriture de la fiche que la RH consulte, et le
            même dossier doit se lire pareil des deux côtés. */}
        <Card>
          <CardHeader>
            <CardTitle>Mon dossier</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-7">
            <Groupe titre="État civil">
              <Donnee label="Nom">{`${p.givenName} ${p.familyName}`}</Donnee>
              <Donnee label="Sexe">{p.gender ? SEX_LABELS[p.gender] : null}</Donnee>
              <Donnee label="Date de naissance">
                {p.birthDate ? formatDate(p.birthDate) : null}
              </Donnee>
              <Donnee label="Pays de naissance">{p.birthPlace}</Donnee>
              <Donnee label="Situation matrimoniale">
                {p.maritalStatus ? marital[p.maritalStatus] : null}
              </Donnee>
            </Groupe>

            <Groupe titre="Pièce d'identité">
              <Donnee label="Type">
                {p.idDocumentType ? ID_DOCUMENT_LABELS[p.idDocumentType] : null}
              </Donnee>
              <Donnee label="Numéro">
                {p.nationalId ? <span className="font-mono">{p.nationalId}</span> : null}
              </Donnee>
              <Donnee label="Délivrée le">
                {p.idDocumentIssuedOn ? formatDate(p.idDocumentIssuedOn) : null}
              </Donnee>
              <Donnee label="Expire le">
                {p.idDocumentExpiresOn ? (
                  <>
                    {formatDate(p.idDocumentExpiresOn)}
                    <Peremption date={p.idDocumentExpiresOn} />
                  </>
                ) : null}
              </Donnee>
            </Groupe>

            <Groupe titre="Dossier professionnel">
              <Donnee label="Matricule">
                <span className="font-mono">{detail.data.employeeNumber}</span>
              </Donnee>
              <Donnee label="Poste">{me.data.positionTitle}</Donnee>
              <Donnee label="Direction affectée">{me.data.orgUnitName}</Donnee>
              <Donnee label="Manager">{detail.data.managerName}</Donnee>
              <Donnee label="Email professionnel">{detail.data.workEmail}</Donnee>
              <Donnee label="Téléphone professionnel">
                {detail.data.workPhone ? <Telephone valeur={detail.data.workPhone} /> : null}
              </Donnee>
            </Groupe>

            <p className="border-t border-line-soft pt-4 text-[11.5px] leading-relaxed text-ink-muted">
              Ces informations s&apos;appuient sur une pièce officielle ou sur votre contrat : leur
              correction passe par la Direction du Capital Humain. Ce que vous pouvez faire
              rectifier vous-même se signale juste en dessous.
            </p>
          </CardContent>
        </Card>

        {/* ———— Ce que l'agent fait corriger lui-même ———— */}
        <Card>
          <CardHeader>
            <CardTitle>Signaler un changement</CardTitle>
            <p className="mt-1.5 max-w-[72ch] text-[12.5px] leading-relaxed text-ink-muted">
              Déménagement, mariage, nouveau numéro : vous le savez avant nous. Corrigez ici — la
              Direction du Capital Humain confirme avant que le dossier change.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {enAttente ? (
              <p className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-accent-text ring-1 ring-current/15 ring-inset">
                <Icon name="schedule" size={15} className="mt-px shrink-0" />
                <span>
                  Un signalement attend la validation de la Direction du Capital Humain —{' '}
                  {enumerer(enAttente.fields.map((f) => f.label.toLowerCase()))}. Vous pourrez en
                  envoyer un nouveau dès qu&apos;il aura été traité.
                </span>
              </p>
            ) : (
              <>
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

                {/* Le numéro se saisit ici comme partout ailleurs : pays à
                    gauche, indicatif écrit en dur, mise en forme au fil de la
                    frappe. C'était le dernier champ du produit à rester une
                    ligne de texte nue. */}
                <ChampTelephone
                  id="phone"
                  stocke={valueOf('phone')}
                  onChange={(v) => set('phone', v)}
                />

                <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
                </div>

                <Field
                  label="Précision"
                  htmlFor="note"
                  hint="Facultatif — la date d'effet, ou ce qui l'explique. Ex. : déménagement au 1er septembre."
                >
                  <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>

                {/* ———— Ce qui part, ligne à ligne ————
                    « Signaler 2 changements » ne dit pas lesquels. L'ancienne
                    valeur et la nouvelle, écrites côte à côte, se relisent en
                    une seconde — et c'est la dernière occasion de voir qu'on
                    a corrigé le bon champ. */}
                <div className="-mx-5 border-t border-line-soft px-5 pt-4 pb-1">
                  {modifies.length === 0 ? (
                    <p className="text-[12px] text-ink-muted">
                      Modifiez au moins une information ci-dessus.
                    </p>
                  ) : (
                    <>
                      <p className="text-[12.5px] font-semibold text-ink-strong">
                        Vous signalez {pluriel(modifies.length, 'changement')}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {modifies.map((f) => (
                          <li key={f} className="text-[11.5px] leading-snug text-ink-muted">
                            <span className="font-semibold text-ink">
                              {PROFILE_CHANGE_LABELS[f]}
                            </span>{' '}
                            : {lisible(f, current(f))} <span aria-hidden>→</span>{' '}
                            <span className="font-semibold text-ink-strong">
                              {lisible(f, draft[f] ?? '')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                {error ? (
                  <p className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset">
                    <Icon name="error" size={15} className="mt-px shrink-0" />
                    {error}
                  </p>
                ) : null}
                {sent ? (
                  <p className="flex items-start gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset">
                    <Icon name="check_circle" size={15} className="mt-px shrink-0" />
                    Signalement envoyé — la Direction du Capital Humain a été prévenue. Son état se
                    suit juste en dessous.
                  </p>
                ) : null}

                <Button
                  disabled={modifies.length === 0}
                  loading={submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {modifies.length > 0
                    ? `Signaler ${pluriel(modifies.length, 'changement')}`
                    : 'Signaler un changement'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* ———— L'historique ———— */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Suivi de mes signalements</CardTitle>
            {signalements.length > 0 ? (
              <span
                className="shrink-0 text-[11.5px] text-ink-muted"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {pluriel(signalements.length, 'signalement')}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {requests.isLoading ? (
              <div className="flex flex-col gap-3 px-3 py-1">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-3 w-56" />
                ))}
              </div>
            ) : signalements.length === 0 ? (
              <EmptyState
                className="py-7"
                icon={<Icon name="badge" size={22} />}
                title="Aucun signalement pour le moment"
                description="Ceux que vous enverrez s’afficheront ici, avec l’ancienne valeur, la nouvelle, et la réponse de la Direction du Capital Humain."
              />
            ) : (
              <ul className="flex flex-col">
                {signalements.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
                  >
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-56">
                        {/* La liste des champs ne suffisait pas : « Ville »
                            ne dit ni d'où l'on part ni où l'on va. */}
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
                            {r.status === 'rejected'
                              ? `Motif : ${r.hrMessage}`
                              : `« ${r.hrMessage} »`}
                          </p>
                        ) : null}
                      </div>
                      <Badge
                        tone={PROFILE_CHANGE_STATUS_TONES[r.status]}
                        className="ml-auto shrink-0"
                      >
                        {PROFILE_CHANGE_STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
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

/**
 * Un téléphone dans ce formulaire.
 *
 * La valeur signalée reste la chaîne COMPLÈTE (« +221771234567 ») : c'est
 * elle qui part au serveur et c'est sur elle qu'on décide si le champ a
 * bougé. Le pays et le numéro local ne sont qu'un moyen de la saisir — ils
 * vivent donc ici, en état local, et chaque frappe recompose la valeur.
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
