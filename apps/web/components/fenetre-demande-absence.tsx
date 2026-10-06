'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AbsencePreview, AbsenceType, AgentSaisieView, BalanceView } from '@teranga/contracts';
import { Button, cn, Field, Input, Select, Skeleton, Textarea } from '@teranga/ui';
import { Donnee } from './fiche';
import { Icon } from './icons';
import { Modal, ModalGrid, ModalSection } from './modal';
import { api, ApiError } from '../lib/api';
import { compte } from '../lib/mots';

/* ————————————————————————————————————————————————————————————————
   La fiche d'une demande d'absence : sa nature, sa période, son motif, et
   le décompte — combien de jours ouvrés elle coûte, ce qu'il reste après.
   ———————————————————————————————————————————————————————————————— */

/** Le jour d'aujourd'hui au calendrier LOCAL — `toISOString` répond en UTC et
    décale la date d'un jour dès qu'on saisit le soir depuis l'ouest. */
export function aujourdhui(): string {
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

export function FenetreDemandeAbsence({
  employeeId: pourMoi,
  pourAutrui = false,
  onClose,
  onEnvoyee,
}: {
  /** L'agent qui pose sa demande ; absent quand la DCH saisit pour un autre. */
  employeeId?: string;
  /** La DCH saisit pour un agent qui ne le peut pas : elle le choisit. */
  pourAutrui?: boolean;
  onClose: () => void;
  /** La demande est partie : son nombre de jours. */
  onEnvoyee: (jours: number) => void;
}) {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const employeeId = pourAutrui ? agentId : (pourMoi ?? '');
  const agents = useQuery({
    queryKey: ['absences-saisie-agents'],
    queryFn: () => api<AgentSaisieView[]>('/absences/saisie/agents'),
    enabled: pourAutrui,
  });
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
  // Le solde de chaque année touchée : un congé du 28 décembre au 8 janvier
  // se retranche pour partie du droit de chacune.
  const parts = preview.data?.parAnnee ?? [];
  const annees =
    parts.length > 0
      ? parts.map((p) => String(p.annee))
      : [(startDate || aujourdhui()).slice(0, 4)];
  const soldes = useQueries({
    queries: annees.map((annee) => ({
      queryKey: ['balances', employeeId, annee],
      queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${annee}`),
      enabled: Boolean(employeeId),
    })),
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
    reader.onerror = () => setFileError('Impossible de lire ce fichier, réessayez.');
    reader.readAsDataURL(file);
  };

  /** Déplacer le début au-delà de la fin ne doit pas produire un état invalide :
      la fin suit. C'est le geste attendu — on repousse un congé entier. */
  const changerDebut = (v: string) => {
    setStartDate(v);
    if (v && endDate && endDate < v) setEndDate(v);
  };

  const days = preview.data?.workingDays ?? 0;
  const feries = preview.data?.holidaysSkipped ?? [];
  const periodeInvalide = Boolean(startDate && endDate && endDate < startDate);
  const calendaires = joursCalendaires(startDate, endDate);
  const weekEnd = Math.max(0, calendaires - days - feries.length);
  const lignes = annees.map((annee, i) => {
    const balance = soldes[i]?.data?.find((b) => b.absenceTypeId === typeId);
    const jours =
      parts.length > 0 ? (parts.find((p) => String(p.annee) === annee)?.jours ?? 0) : days;
    return { annee, balance, apres: balance ? balance.remainingDays - jours : 0 };
  });
  const plusieurs = lignes.length > 1;
  const decompte =
    Boolean(selectedType?.deductsBalance) && lignes.every((l) => l.balance !== undefined);
  const manquent = decompte ? lignes.filter((l) => l.apres < 0) : [];
  const insufficient = manquent.length > 0;

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
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
      onEnvoyee(r.daysCount);
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.'),
  });

  // Le justificatif peut suivre : la DCH ne valide qu'avec lui.
  const peutEnvoyer =
    Boolean(employeeId) && Boolean(typeId) && days > 0 && !periodeInvalide && !insufficient;

  return (
    <Modal
      open
      onClose={onClose}
      title={pourAutrui ? 'Saisir une demande' : 'Poser une demande'}
      maxWidth="max-w-2xl"
      footer={
        <>
          {serverError ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {serverError}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!peutEnvoyer}
            loading={submit.isPending}
            onClick={() => {
              setServerError(null);
              submit.mutate();
            }}
          >
            {pourAutrui ? 'Enregistrer la demande' : 'Envoyer la demande'}
          </Button>
        </>
      }
    >
      {types.data && types.data.length === 0 ? (
        <p className="rounded-[12px] bg-warning-soft px-3.5 py-2.5 text-[12.5px] text-warning ring-1 ring-current/15 ring-inset">
          Aucun type d&apos;absence n&apos;est encore configuré.
        </p>
      ) : null}

      {pourAutrui ? (
        <ModalSection title="Agent">
          <Field label="Pour" htmlFor="agent" required>
            <Select id="agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Choisir un agent</option>
              {agents.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom} · {a.matricule}
                </option>
              ))}
            </Select>
          </Field>
        </ModalSection>
      ) : null}

      <ModalSection title="Nature">
        <ModalGrid>
          <Field label="Type d'absence" htmlFor="type" required>
            <Select id="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
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
        </ModalGrid>
      </ModalSection>

      <ModalSection title="Période">
        <ModalGrid>
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
        </ModalGrid>
      </ModalSection>

      <ModalSection title="Motif">
        <Textarea
          id="reason"
          aria-label="Motif"
          placeholder="Facultatif"
          rows={2}
          className="min-h-[72px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalSection>

      {/* ———— Le décompte, arithmétique à l'appui ———— */}
      <ModalSection title="Décompte">
        {periodeInvalide ? (
          <p className="text-[12.5px] text-danger">La date de fin précède la date de début.</p>
        ) : preview.isLoading && !preview.data ? (
          <Skeleton className="h-9 w-56" />
        ) : (
          <>
            <dl
              className={cn(
                'grid grid-cols-2 gap-x-10 gap-y-[18px]',
                plusieurs && 'sm:grid-cols-3',
              )}
            >
              <Donnee label="Jours ouvrés">
                <span className={cn(days === 0 && 'text-ink-muted')}>{compte(days, 'jour')}</span>
                {plusieurs ? (
                  <span className="block text-[12px] font-normal text-ink-muted">
                    {parts.map((p) => `${p.jours} en ${p.annee}`).join(' · ')}
                  </span>
                ) : null}
              </Donnee>
              {lignes.map((l) => (
                <Donnee key={l.annee} label={plusieurs ? `Solde ${l.annee} après` : 'Solde après'}>
                  {decompte && l.balance ? (
                    <span className={cn(l.apres < 0 && 'text-danger')}>
                      {compte(l.apres, 'jour')}
                      {l.apres < 0 ? null : (
                        <span className="font-normal text-ink-muted">
                          {' '}
                          sur {l.balance.entitledDays}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="font-normal text-ink-muted">Non décompté</span>
                  )}
                </Donnee>
              ))}
            </dl>
            {days === 0 ? (
              <p className="mt-3 text-[12px] text-accent-text">
                Aucun jour ouvré sur cette période.
              </p>
            ) : insufficient ? (
              <p className="mt-3 text-[12px] text-danger">
                {manquent
                  .map(
                    (l) =>
                      `Solde${plusieurs ? ` ${l.annee}` : ''} insuffisant : il manque ${compte(-l.apres, 'jour')}.`,
                  )
                  .join(' ')}
              </p>
            ) : retires.length > 0 ? (
              <p className="mt-3 text-[12px] text-ink-muted">
                Sur {compte(calendaires, 'jour')} de calendrier, {retires.join(' et ')} ne comptent
                pas.
              </p>
            ) : null}
          </>
        )}
      </ModalSection>
    </Modal>
  );
}
