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
import { CarteSolde } from '../../../../components/carte-solde';
import { Icon } from '../../../../components/icons';
import { api, ApiError } from '../../../../lib/api';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Poser un congé, c'est trois questions dans l'ordre :

   1. « Combien de jours cela me coûte-t-il ? »  → le décompte, calculé en
      direct sous le formulaire, avec l'arithmétique écrite : six jours de
      calendrier, deux de week-end, un férié nommé.
   2. « Et après, il me reste quoi ? »           → le solde, à droite, et sa
      projection — « solde après » — dans le décompte lui-même.
   3. « Qui doit dire oui ? »                    → le circuit de visa, annoncé
      AVANT l'envoi, plus seulement découvert après.

   La boîte grise qui portait tout cela a disparu : sur cette plateforme, un
   groupe s'annonce par un intitulé et se sépare par un filet, jamais par un
   aplat teinté. Les aplats restent aux messages — succès, erreur — qui, eux,
   doivent interrompre la lecture.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

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

export default function MyLeavesPage() {
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
  const [success, setSuccess] = useState<string | null>(null);

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
  const balances = useQuery({
    queryKey: ['balances', employeeId, startDate.slice(0, 4)],
    queryFn: () =>
      api<BalanceView[]>(`/employees/${employeeId}/balances?year=${startDate.slice(0, 4)}`),
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
      setSuccess(
        `Demande envoyée — ${compte(r.daysCount, 'jour')}. Elle suit maintenant le circuit de validation.`,
      );
      setReason('');
      setDoc(null);
      // La période repart à aujourd'hui : laisser les dates en place invite au
      // double envoi, et le récapitulatif projetterait un solde qu'on vient de
      // consommer.
      setStartDate(aujourdhui());
      setEndDate(aujourdhui());
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible — réessayez.'),
  });

  const deductibles = (balances.data ?? []).filter((b) => b.deductsBalance);
  // Le circuit, fixé par l'APIX : son N+1 d'abord, puis la DCH. Sans N+1
  // qui puisse viser (absent, sans accès), la demande va directement à la
  // DCH ; celle du directeur du Capital Humain, le DG la vise seul.
  const valideurN1 = myEmployee.data?.valideurN1 ?? null;
  const valideurDCH = myEmployee.data?.valideurDCH ?? null;
  const etapes = myEmployee.data?.demandeDuDirecteur
    ? [{ titre: 'Votre N+1', qui: valideurN1 ? `${valideurN1} — son visa suffit` : 'Le DG' }]
    : [
        valideurN1
          ? { titre: 'Votre N+1', qui: valideurN1 }
          : { titre: 'Votre N+1', qui: 'Personne pour viser : directement à la DCH' },
        {
          titre: 'La Direction du Capital Humain',
          qui: valideurDCH
            ? `${valideurDCH}, dès que votre N+1 a visé`
            : 'Dès que votre N+1 a visé',
        },
      ];

  return (
    <Page>
      {/* `minmax(0,1fr)` dès la première colonne, et pas seulement en grand
          écran : sans plancher à zéro, la piste se dimensionne sur le
          min-content de sa plus longue ligne insécable et la page entière
          débordait sur un téléphone. */}
      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_288px]">
        {/* ———— Le formulaire ———— */}
        <Card className="lg:order-1">
          <CardHeader>
            <CardTitle>Poser une demande</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {types.data && types.data.length === 0 ? (
              <p className="rounded-[12px] bg-warning-soft px-3.5 py-2.5 text-[12.5px] text-warning ring-1 ring-current/15 ring-inset">
                Aucun type d&apos;absence n&apos;est encore configuré — contactez votre service RH.
              </p>
            ) : null}

            <Field
              label="Type d'absence"
              htmlFor="type"
              required
              hint={
                selectedType && !selectedType.deductsBalance
                  ? 'Ce type ne se retranche d’aucun solde.'
                  : undefined
              }
            >
              <Select id="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>

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
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>

            <Field
              label="Motif"
              htmlFor="reason"
              hint="Facultatif — lu par les personnes qui visent votre demande."
            >
              <Textarea
                id="reason"
                rows={2}
                className="min-h-[72px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>

            {needsDocument ? (
              <Field
                label={`Justificatif (${selectedType?.name === 'Mission' ? 'ordre de mission' : 'attestation'})`}
                htmlFor="justificatif"
                required
              >
                <div className="rounded-[18px] border border-line bg-surface px-4 py-3">
                  <input
                    id="justificatif"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => pickDocument(e.target.files?.[0] ?? null)}
                    className="block w-full text-[12.5px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-soft file:px-3.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-primary hover:file:bg-primary-soft/70"
                  />
                  {doc ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-success">
                      <Icon name="check_circle" size={14} />
                      {doc.filename} · {Math.round(doc.sizeBytes / 1024)} Ko
                    </p>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-ink-muted">
                      Obligatoire pour « {selectedType?.name} » — PDF, 5 Mo au plus.
                    </p>
                  )}
                </div>
                {fileError ? <p className="mt-1 text-xs text-danger">{fileError}</p> : null}
              </Field>
            ) : null}

            {/* ———— Le décompte, arithmétique à l'appui ———— */}
            <Decompte
              chargement={preview.isLoading && !preview.data}
              invalide={periodeInvalide}
              jours={days}
              calendaires={calendaires}
              weekEnd={weekEnd}
              feries={feries}
              solde={decompte ? balance : undefined}
              restantApres={restantApres}
            />

            {serverError ? (
              <p className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset">
                <Icon name="error" size={15} className="mt-px shrink-0" />
                {serverError}
              </p>
            ) : null}
            {success ? (
              <p className="flex items-start gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset">
                <Icon name="check_circle" size={15} className="mt-px shrink-0" />
                <span>
                  {success}{' '}
                  <Link href="/moi/conges/historique" className="font-semibold underline">
                    Voir l&apos;historique
                  </Link>
                </span>
              </p>
            ) : null}

            <Button
              onClick={() => {
                setServerError(null);
                setSuccess(null);
                submit.mutate();
              }}
              disabled={
                !employeeId ||
                !typeId ||
                days === 0 ||
                periodeInvalide ||
                insufficient ||
                (needsDocument && !doc)
              }
              loading={submit.isPending}
            >
              Envoyer ma demande
            </Button>
          </CardContent>
        </Card>

        {/* ———— Le contexte : ce que j'ai, et qui décide ————
            Il suit la page quand elle défile : on règle ses dates en gardant
            son solde sous les yeux, ce qui est très exactement l'arbitrage
            qu'on est en train de faire. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:order-2">
          {balances.isLoading ? (
            <Skeleton className="h-[136px] w-full rounded-[16px]" />
          ) : (
            deductibles.map((b) => <CarteSolde key={b.absenceTypeId} solde={b} />)
          )}

          {myEmployee.data ? (
            <Card>
              <CardHeader>
                <CardTitle>Circuit de validation</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col">
                  {etapes.map((e, i) => (
                    <li key={e.titre} className="relative flex gap-2.5 pb-3 last:pb-0">
                      {i < etapes.length - 1 ? (
                        <span
                          aria-hidden
                          className="absolute top-[18px] left-[9px] h-[calc(100%-18px)] w-px bg-line-soft"
                        />
                      ) : null}
                      <span
                        className="relative flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[9.5px] font-bold text-primary"
                        style={TABULAIRE}
                      >
                        {i + 1}
                      </span>
                      <span className="-mt-px min-w-0">
                        <span className="block text-[12.5px] font-semibold text-ink-strong">
                          {e.titre}
                        </span>
                        <span className="block text-[11.5px] leading-snug text-ink-muted">
                          {e.qui}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-muted">
                  Chaque visa appelle le suivant. Tant que la demande est en attente, vous pouvez
                  l&apos;annuler.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </Page>
  );
}

/**
 * Le décompte, et ce qu'il laisse.
 *
 * « 4 jours ouvrés » est un résultat ; l'employé qui a demandé six jours veut
 * savoir POURQUOI quatre. La phrase sous le chiffre pose l'opération —
 * six jours de calendrier, deux de week-end, un férié qu'on nomme — et le
 * férié nommé sert deux fois : il justifie le décompte et apprend au passage
 * qu'il tombe là.
 */
function Decompte({
  chargement,
  invalide,
  jours,
  calendaires,
  weekEnd,
  feries,
  solde,
  restantApres,
}: {
  chargement: boolean;
  invalide: boolean;
  jours: number;
  calendaires: number;
  weekEnd: number;
  feries: { day: string; label: string }[];
  solde?: BalanceView;
  restantApres: number;
}) {
  const cadre = '-mx-5 border-t border-line-soft px-5 pt-4 pb-1';

  if (invalide) {
    return (
      <div className={cadre}>
        <p className="text-[12.5px] text-danger">
          La date de fin précède la date de début — corrigez la période pour voir le décompte.
        </p>
      </div>
    );
  }
  if (chargement) {
    return (
      <div className={cadre}>
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const retires: string[] = [];
  if (weekEnd > 0) retires.push(compte(weekEnd, 'jour') + ' de week-end');
  if (feries.length > 0) {
    const noms = feries
      .map((f) => f.label)
      .filter(Boolean)
      .join(', ');
    retires.push(
      `${compte(feries.length, 'jour')} férié${feries.length > 1 ? 's' : ''}${noms ? ` (${noms})` : ''}`,
    );
  }
  const insuffisant = solde !== undefined && restantApres < 0;

  return (
    <div className={cadre}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[19rem]">
          <p className="flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-[27px] leading-none font-bold tracking-[-0.025em]',
                jours === 0 ? 'text-ink-muted' : 'text-ink-strong',
              )}
              style={TABULAIRE}
            >
              {jours}
            </span>
            <span className="text-[13px] font-medium text-ink-muted">
              jour{jours > 1 ? 's' : ''} ouvré{jours > 1 ? 's' : ''} décompté{jours > 1 ? 's' : ''}
            </span>
          </p>
          {jours === 0 ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-accent-text">
              Cette période ne contient aucun jour ouvré — il n&apos;y a rien à poser.
            </p>
          ) : retires.length > 0 ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted" style={TABULAIRE}>
              Sur {compte(calendaires, 'jour')} de calendrier, {retires.join(' et ')} ne comptent
              pas.
            </p>
          ) : null}
        </div>

        {solde && jours > 0 ? (
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
              Solde après
            </p>
            <p
              className={cn(
                'mt-1 text-[19px] leading-none font-bold tracking-[-0.02em]',
                insuffisant ? 'text-danger' : 'text-ink-strong',
              )}
              style={TABULAIRE}
            >
              {restantApres}{' '}
              <span className="text-[12px] font-medium text-ink-muted">
                j{insuffisant ? '' : ` sur ${solde.entitledDays}`}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {insuffisant ? (
        <p className="mt-2.5 text-[12px] leading-snug text-danger">
          Solde insuffisant : il manque {compte(-restantApres, 'jour')} à votre solde de{' '}
          {solde!.absenceTypeName.toLowerCase()}. Raccourcissez la période, ou rapprochez-vous de la
          Direction du Capital Humain.
        </p>
      ) : null}
    </div>
  );
}
