'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AbsencePreview, AbsenceType, BalanceView, MyEmployeeView } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@teranga/ui';
import { Donnee, EnTete, Repere, Rubrique } from '../../../../components/fiche';
import { Icon } from '../../../../components/icons';
import { Page } from '../../../../components/gabarit';
import { api, ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Poser une demande — la même grammaire que « Mes infos personnelles » :
   une carte de tête (le solde, en quatre repères), puis la demande, coupée
   en rubriques (nature, période, motif, décompte), et à côté, qui la vise.
   ———————————————————————————————————————————————————————————————— */

/** Le jour d'aujourd'hui au calendrier LOCAL — `toISOString` répond en UTC et
    décale la date d'un jour dès qu'on saisit le soir depuis l'ouest. */
function aujourdhui(): string {
  const d = new Date();
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${String(d.getDate()).padStart(2, '0')}`;
}

/** « mercredi 16 septembre » : écrit sous le champ, il évite de poser un congé
    un samedi sans le voir — la cause la plus banale d'un décompte surprenant. */
function jourEnLettres(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Nombre de jours du calendrier entre deux dates incluses. */
function joursCalendaires(debut: string, fin: string): number {
  const a = Date.parse(`${debut}T00:00:00Z`);
  const b = Date.parse(`${fin}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

export default function PoserUneDemandePage() {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState('');
  const [startDate, setStartDate] = useState(aujourdhui());
  const [endDate, setEndDate] = useState(aujourdhui());
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<{
    filename: string;
    contentBase64: string;
    sizeBytes: number;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<number | null>(null);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const types = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => api<AbsenceType[]>('/absence-types'),
  });
  const preview = useQuery({
    queryKey: ['absence-preview', startDate, endDate],
    queryFn: () =>
      api<AbsencePreview>('/absence-preview', { method: 'POST', body: { startDate, endDate } }),
    enabled: Boolean(startDate && endDate && endDate >= startDate),
  });
  const annee = (startDate || aujourdhui()).slice(0, 4);
  const balances = useQuery({
    queryKey: ['balances', employeeId, annee],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${annee}`),
    enabled: Boolean(employeeId),
  });

  useEffect(() => {
    if (!typeId && types.data && types.data.length > 0) setTypeId(types.data[0]!.id);
  }, [types.data, typeId]);

  const selectedType = types.data?.find((t) => t.id === typeId);
  const needsDocument = Boolean(selectedType?.requiresDocument);

  const pickDocument = (file: File | null) => {
    setFileError(null);
    setDoc(null); // une sélection invalide ne doit jamais garder l'ancien fichier
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setFileError('Le justificatif doit être un PDF.');
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setFileError('Le PDF doit faire entre 1 octet et 5 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      setDoc({ filename: file.name, contentBase64: base64, sizeBytes: file.size });
    };
    reader.onerror = () => setFileError('Impossible de lire ce fichier — réessayez.');
    reader.readAsDataURL(file);
  };

  /** Déplacer le début au-delà de la fin ne doit pas produire un état invalide :
      la fin suit. C'est le geste attendu — on repousse un congé entier. */
  const changerDebut = (v: string) => {
    setEnvoyee(null);
    setStartDate(v);
    if (v && endDate && endDate < v) setEndDate(v);
  };

  const balance = balances.data?.find((b) => b.absenceTypeId === typeId);
  const days = preview.data?.workingDays ?? 0;
  const feries = preview.data?.holidaysSkipped ?? [];
  const periodeInvalide = Boolean(startDate && endDate && endDate < startDate);
  const calendaires = joursCalendaires(startDate, endDate);
  const weekEnd = Math.max(0, calendaires - days - feries.length);
  const decompte = Boolean(selectedType?.deductsBalance) && balance !== undefined;
  const restantApres = balance ? balance.remainingDays - days : 0;
  const insufficient = decompte && restantApres < 0;

  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string; daysCount: number }>('/absence-requests', {
        method: 'POST',
        body: {
          employeeId,
          absenceTypeId: typeId,
          startDate,
          endDate,
          reason: reason.trim() || undefined,
          document: doc ? { filename: doc.filename, contentBase64: doc.contentBase64 } : undefined,
        },
      }),
    onSuccess: (r) => {
      setEnvoyee(r.daysCount);
      setReason('');
      setDoc(null);
      // La période repart à aujourd'hui : laisser les dates en place invite au
      // double envoi, et le décompte projetterait un solde qu'on vient de
      // consommer.
      setStartDate(aujourdhui());
      setEndDate(aujourdhui());
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible — réessayez.'),
  });

  // Le solde de tête : celui du type choisi s'il se décompte, sinon le premier
  // qui se décompte — le congé annuel, en pratique.
  const solde = decompte ? balance : (balances.data ?? []).find((b) => b.deductsBalance);

  // Le circuit, fixé par l'APIX : son N+1 d'abord, puis la DCH. Sans N+1
  // qui puisse viser, la demande va directement à la DCH ; celle du
  // directeur du Capital Humain, le DG la vise seul.
  const valideurN1 = myEmployee.data?.valideurN1 ?? null;
  const valideurDCH = myEmployee.data?.valideurDCH ?? null;
  const etapes: { titre: string; qui: string | null }[] = myEmployee.data?.demandeDuDirecteur
    ? [{ titre: 'Le directeur général', qui: valideurN1 }]
    : [
        { titre: 'Votre N+1', qui: valideurN1 ?? 'Aucun — directement à la DCH' },
        { titre: 'Direction du Capital Humain', qui: valideurDCH },
      ];

  const retires: string[] = [];
  if (weekEnd > 0) retires.push(`${compte(weekEnd, 'jour')} de week-end`);
  if (feries.length > 0) {
    const noms = feries
      .map((f) => f.label)
      .filter(Boolean)
      .join(', ');
    retires.push(
      `${compte(feries.length, 'jour')} férié${feries.length > 1 ? 's' : ''}${noms ? ` (${noms})` : ''}`,
    );
  }

  const peutEnvoyer =
    Boolean(employeeId && typeId) &&
    days > 0 &&
    !periodeInvalide &&
    !insufficient &&
    !(needsDocument && !doc);

  return (
    <Page>
      <EnTete
        titre={solde ? `${solde.absenceTypeName} ${solde.year}` : 'Absences & Congés'}
        sousTitre={`Solde au ${formatDate(aujourdhui())}`}
        reperes={
          balances.isLoading || !employeeId ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-2.5 h-4 w-20" />
                </div>
              ))}
            </>
          ) : solde ? (
            <>
              <Repere label="Droit" valeur={compte(solde.entitledDays, 'jour')} />
              <Repere label="Pris" valeur={compte(solde.takenDays, 'jour')} />
              <Repere
                label="En attente"
                valeur={compte(solde.pendingDays, 'jour')}
                ton={solde.pendingDays > 0 ? 'attente' : undefined}
              />
              <Repere label="Restant" valeur={compte(solde.remainingDays, 'jour')} />
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {/* ———— La demande ———— */}
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Nouvelle demande</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-7 pt-2">
            {types.data && types.data.length === 0 ? (
              <p className="rounded-[12px] bg-warning-soft px-3.5 py-2.5 text-[12.5px] text-warning ring-1 ring-current/15 ring-inset">
                Aucun type d&apos;absence n&apos;est encore configuré.
              </p>
            ) : null}

            <Rubrique titre="Nature">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type d'absence" htmlFor="type" required>
                  <Select
                    id="type"
                    value={typeId}
                    onChange={(e) => {
                      setEnvoyee(null);
                      setTypeId(e.target.value);
                    }}
                  >
                    {types.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {needsDocument ? (
                  <Field
                    label={selectedType?.name === 'Mission' ? 'Ordre de mission' : 'Justificatif'}
                    htmlFor="justificatif"
                    required
                    hint={doc ? undefined : 'PDF, 5 Mo au plus'}
                    error={fileError ?? undefined}
                  >
                    <label
                      htmlFor="justificatif"
                      className={cn(
                        'flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-[13px] transition-colors duration-150',
                        doc
                          ? 'border-success/40 text-ink-strong'
                          : 'border-line text-ink-muted hover:border-primary/40 hover:text-primary',
                      )}
                    >
                      <Icon
                        name={doc ? 'check_circle' : 'upload_file'}
                        size={17}
                        className={cn('shrink-0', doc ? 'text-success' : undefined)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {doc
                          ? `${doc.filename} · ${Math.round(doc.sizeBytes / 1024)} Ko`
                          : 'Choisir un fichier'}
                      </span>
                    </label>
                    <input
                      id="justificatif"
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      onChange={(e) => pickDocument(e.target.files?.[0] ?? null)}
                    />
                  </Field>
                ) : null}
              </div>
            </Rubrique>

            <Rubrique titre="Période">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Du" htmlFor="start" required hint={jourEnLettres(startDate)}>
                  <Input
                    id="start"
                    type="date"
                    value={startDate}
                    onChange={(e) => changerDebut(e.target.value)}
                  />
                </Field>
                <Field
                  label="Au (inclus)"
                  htmlFor="end"
                  required
                  error={periodeInvalide ? 'La fin précède le début.' : undefined}
                  hint={jourEnLettres(endDate)}
                >
                  <Input
                    id="end"
                    type="date"
                    min={startDate || undefined}
                    value={endDate}
                    onChange={(e) => {
                      setEnvoyee(null);
                      setEndDate(e.target.value);
                    }}
                  />
                </Field>
              </div>
            </Rubrique>

            <Rubrique titre="Motif">
              <Textarea
                id="reason"
                aria-label="Motif"
                placeholder="Facultatif"
                rows={2}
                className="min-h-[72px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Rubrique>

            {/* ———— Le décompte, arithmétique à l'appui ———— */}
            <Rubrique titre="Décompte">
              {periodeInvalide ? (
                <p className="text-[12.5px] text-danger">
                  La date de fin précède la date de début.
                </p>
              ) : preview.isLoading && !preview.data ? (
                <Skeleton className="h-9 w-56" />
              ) : (
                <>
                  <dl className="grid grid-cols-1 gap-x-10 gap-y-[18px] sm:grid-cols-2">
                    <Donnee label="Jours ouvrés décomptés">
                      <span className={cn(days === 0 && 'text-ink-muted')}>
                        {compte(days, 'jour')}
                      </span>
                    </Donnee>
                    <Donnee label="Solde après">
                      {decompte && balance ? (
                        <span className={cn(insufficient && 'text-danger')}>
                          {compte(restantApres, 'jour')}
                          {insufficient ? null : (
                            <span className="font-normal text-ink-muted">
                              {' '}
                              sur {balance.entitledDays}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="font-normal text-ink-muted">Non décompté</span>
                      )}
                    </Donnee>
                  </dl>
                  {days === 0 ? (
                    <p className="mt-3 text-[12px] text-accent-text">
                      Aucun jour ouvré sur cette période.
                    </p>
                  ) : insufficient ? (
                    <p className="mt-3 text-[12px] text-danger">
                      Solde insuffisant : il manque {compte(-restantApres, 'jour')}.
                    </p>
                  ) : retires.length > 0 ? (
                    <p className="mt-3 text-[12px] text-ink-muted">
                      Sur {compte(calendaires, 'jour')} de calendrier, {retires.join(' et ')} ne
                      comptent pas.
                    </p>
                  ) : null}
                </>
              )}
            </Rubrique>
          </CardContent>

          {/* ———— L'envoi ———— */}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line-soft px-5 py-4">
            {serverError ? (
              <p
                role="alert"
                className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-danger"
              >
                <Icon name="error" size={15} className="mt-px shrink-0" />
                {serverError}
              </p>
            ) : envoyee !== null ? (
              <p
                role="status"
                className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-success"
              >
                <Icon name="check_circle" size={15} className="mt-px shrink-0" />
                <span>
                  Demande envoyée — {compte(envoyee, 'jour')}.{' '}
                  <Link href="/moi/conges/historique" className="underline">
                    Voir l&apos;historique
                  </Link>
                </span>
              </p>
            ) : null}
            <Button
              onClick={() => {
                setServerError(null);
                setEnvoyee(null);
                submit.mutate();
              }}
              disabled={!peutEnvoyer}
              loading={submit.isPending}
            >
              Envoyer la demande
            </Button>
          </div>
        </Card>

        {/* ———— Qui la vise ———— */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Circuit de validation</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {myEmployee.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <ol className="flex flex-col">
                {etapes.map((e, i) => (
                  <li key={e.titre} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < etapes.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute top-[22px] bottom-0 left-[10.5px] w-px bg-line-soft"
                      />
                    ) : null}
                    <span className="relative flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[10.5px] font-bold text-primary tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[9.5px] font-bold tracking-[0.1em] text-ink-muted uppercase">
                        {e.titre}
                      </p>
                      <p
                        className={cn(
                          'mt-1.5 text-[13.5px] leading-snug font-semibold break-words',
                          e.qui ? 'text-ink-strong' : 'text-ink-muted/45',
                        )}
                      >
                        {e.qui ?? '—'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
