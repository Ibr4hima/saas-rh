'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  DocumentRequestView,
  MyEmployeeView,
  PeriodeDuBulletin,
  RequestableDoc,
} from '@teranga/contracts';
import {
  BULLETINS_PAR_DEMANDE_MAX,
  documentsEnCours,
  moisDeDuAu,
  moisEnLettres,
  periodeEnLettres,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
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
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { Icon } from '../../../../components/icons';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';
import { aujourdhui } from '../../../../lib/temps';

/* ————————————————————————————————————————————————————————————————
   « Demander un document » — ce que l'agent DEMANDE à la Direction du
   Capital Humain (attestation, contrat, bulletin) : il coche, il envoie.
   L'avancement se suit dans « Suivi de mes demandes » ; ce qu'il FOURNIT a
   sa page, « Joindre un document ».
   ———————————————————————————————————————————————————————————————— */

const REQUESTABLE: RequestableDoc[] = [
  'attestation_travail',
  'attestation_stage',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
];

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

/* Le bulletin de salaire se demande pour un mois, les N derniers mois, ou de
   tel mois à tel mois. */
type ModeDuBulletin = 'mois' | 'derniers' | 'periode';
interface ChoixBulletin {
  mode: ModeDuBulletin | null;
  mois: string;
  nombre: string;
  du: string;
  au: string;
}
const BULLETIN_VIDE: ChoixBulletin = { mode: null, mois: '', nombre: '', du: '', au: '' };

/** La période choisie ; `null` tant qu'il manque quelque chose. */
function periodeChoisie(c: ChoixBulletin): PeriodeDuBulletin | null {
  if (c.mode === 'mois' && c.mois) return { type: 'mois', mois: c.mois };
  if (c.mode === 'derniers' && c.nombre) return { type: 'derniers', nombre: Number(c.nombre) };
  if (c.mode === 'periode' && c.du && c.au) return { type: 'periode', du: c.du, au: c.au };
  return null;
}

/** « 2026-10 » moins un mois : « 2026-09 ». */
function moisPrecedent(mois: string): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** Les mois de paie possibles, du mois en cours à celui de l'arrivée. */
function moisDePaie(arrivee: string | undefined): string[] {
  const courant = aujourdhui().slice(0, 7);
  // Sans date d'arrivée connue, deux ans en arrière.
  const premier = arrivee && arrivee <= courant ? arrivee : null;
  const liste = [courant];
  while (liste.length < (premier ? Infinity : 24)) {
    const m = moisPrecedent(liste[liste.length - 1]!);
    if (premier && m < premier) break;
    liste.push(m);
  }
  return liste;
}

/** « Septembre 2026 », pour une liste. */
const moisAffiche = (mois: string) => {
  const t = moisEnLettres(mois);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function MyDocumentsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<RequestableDoc[]>([]);
  const [note, setNote] = useState('');
  const [bulletin, setBulletin] = useState<ChoixBulletin>(BULLETIN_VIDE);
  const [error, setError] = useState<string | null>(null);
  /** Le nombre de documents qui viennent de partir — chacun est une demande. */
  const [sent, setSent] = useState(0);

  // L'arrivée de l'agent borne les mois de paie à demander.
  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const moisPossibles = moisDePaie(moi.data?.hiredOn.slice(0, 7));
  const avecBulletin = selected.includes('bulletin_salaire');
  const periode = avecBulletin ? periodeChoisie(bulletin) : null;

  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: {
          docTypes: selected,
          bulletin: periode ?? undefined,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setSelected([]);
      setNote('');
      setBulletin(BULLETIN_VIDE);
      setError(null);
      setSent(selected.length);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  const demandes = docRequests.data ?? [];
  // Un document déjà demandé, et encore en cours, ne se redemande pas : le
  // serveur le refuse, la pastille le dit avant — l'agent ne compose pas
  // une demande pour se la voir rejeter à l'envoi.
  const enCours = documentsEnCours(demandes);
  const toggle = (doc: RequestableDoc) => {
    if (enCours.has(doc)) return;
    setSent(0);
    if (doc === 'bulletin_salaire') setBulletin(BULLETIN_VIDE);
    setSelected(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);
  };
  // Le bulletin se lit avec ses mois : « Bulletin de salaire (3 derniers mois) ».
  const libelleChoisi = (d: RequestableDoc) =>
    d === 'bulletin_salaire' && periode
      ? `${REQUESTABLE_DOC_LABELS[d]} (${periodeEnLettres(periode)})`
      : REQUESTABLE_DOC_LABELS[d];

  return (
    <Page>
      <Card>
        <CardHeader>
          <CardTitle>Demander un document</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {REQUESTABLE.map((doc) => (
              <ChoixDocument
                key={doc}
                libelle={REQUESTABLE_DOC_LABELS[doc]}
                choisi={selected.includes(doc)}
                enCours={enCours.has(doc)}
                onToggle={() => toggle(doc)}
              />
            ))}
          </div>

          {avecBulletin ? (
            <ChoixDuBulletin valeur={bulletin} onChange={setBulletin} mois={moisPossibles} />
          ) : null}

          <Field label="Précision" htmlFor="doc-note">
            <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {/* ———— Ce qui part, en toutes lettres ————
              Deux pastilles cochées se lisent d'un coup d'œil ; à quatre,
              relire la ligne est plus sûr que recompter les bordures bleues. */}
          {selected.length > 0 ? (
            <p className="text-[12.5px] leading-snug text-ink">
              <span className="font-semibold text-ink-strong">
                Vous demandez {compte(selected.length, 'document')}
              </span>{' '}
              {/* Les libellés gardent leur majuscule : « et autre document »
                  en bas de casse se lit comme une phrase inachevée, alors
                  que « et Autre document » se lit comme l'entrée cochée. */}
              : {enumerer(selected.map(libelleChoisi))}.
            </p>
          ) : null}
        </CardContent>

        {/* ———— L'envoi ———— */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line-soft px-5 py-4">
          {error ? (
            <p
              role="alert"
              className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-danger"
            >
              <Icon name="error" size={15} className="mt-px shrink-0" />
              {error}
            </p>
          ) : sent ? (
            <p
              role="status"
              className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-[12.5px] font-semibold text-success"
            >
              <Icon name="check_circle" size={15} className="mt-px shrink-0" />
              <span>
                {sent > 1 ? `${sent} demandes envoyées.` : 'Demande envoyée.'}{' '}
                <Link href="/moi/documents/suivi" className="underline">
                  Suivre mes demandes
                </Link>
              </span>
            </p>
          ) : null}
          <Button
            disabled={selected.length === 0 || (avecBulletin && !periode)}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Envoyer ma demande
          </Button>
        </div>
      </Card>
    </Page>
  );
}

/**
 * Les mois du bulletin de salaire : un mois, les N derniers, ou une période
 * de douze mois au plus. Les listes ne proposent que des mois de paie
 * possibles, du mois en cours à celui de l'arrivée.
 */
function ChoixDuBulletin({
  valeur,
  onChange,
  mois,
}: {
  valeur: ChoixBulletin;
  onChange: (c: ChoixBulletin) => void;
  /** Du plus récent au plus ancien. */
  mois: string[];
}) {
  const set = (p: Partial<ChoixBulletin>) => onChange({ ...valeur, ...p });
  const modes: { v: ModeDuBulletin; label: string }[] = [
    { v: 'mois', label: 'Un mois' },
    // Une arrivée ce mois-ci : un seul bulletin à demander.
    ...(mois.length >= 2
      ? [
          { v: 'derniers' as const, label: 'Les derniers mois' },
          { v: 'periode' as const, label: 'Une période' },
        ]
      : []),
  ];
  const nombres = Array.from(
    { length: Math.min(BULLETINS_PAR_DEMANDE_MAX, mois.length) - 1 },
    (_, i) => i + 2,
  );
  // La période va d'un mois à un mois plus récent, douze au plus.
  const fins = valeur.du
    ? mois.filter((m) => m > valeur.du && moisDeDuAu(valeur.du, m) <= BULLETINS_PAR_DEMANDE_MAX)
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div>
        {/* Le libellé d'un champ, comme « Précision » : un groupe de choix. */}
        <p id="bulletin-question" className="mb-1.5 text-sm font-medium text-ink-strong">
          Bulletin de salaire<span className="text-danger"> *</span>
        </p>
        <div role="radiogroup" aria-labelledby="bulletin-question" className="flex flex-wrap gap-2">
          {modes.map((o) => {
            const actif = valeur.mode === o.v;
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={actif}
                onClick={() => onChange({ ...BULLETIN_VIDE, mode: o.v })}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] transition-colors duration-150',
                  actif
                    ? 'border-primary bg-primary-soft font-semibold text-primary'
                    : 'border-line text-ink hover:border-ink-muted/40 hover:bg-hover',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    // Un rond : un seul choix à la fois.
                    'flex size-[15px] shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                    actif ? 'border-primary' : 'border-line bg-surface',
                  )}
                >
                  {actif ? <span className="size-[7px] rounded-full bg-primary" /> : null}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {valeur.mode === 'mois' ? (
        <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
          <Field label="Mois" htmlFor="bulletin-mois" required>
            <Select
              id="bulletin-mois"
              value={valeur.mois}
              onChange={(e) => set({ mois: e.target.value })}
            >
              <option value="">Choisir</option>
              {mois.map((m) => (
                <option key={m} value={m}>
                  {moisAffiche(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {valeur.mode === 'derniers' ? (
        <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
          <Field label="Nombre de mois" htmlFor="bulletin-nombre" required>
            <Select
              id="bulletin-nombre"
              value={valeur.nombre}
              onChange={(e) => set({ nombre: e.target.value })}
            >
              <option value="">Choisir</option>
              {nombres.map((n) => (
                <option key={n} value={String(n)}>
                  {n} derniers mois
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {valeur.mode === 'periode' ? (
        <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
          <Field label="Du" htmlFor="bulletin-du" required>
            <Select
              id="bulletin-du"
              value={valeur.du}
              onChange={(e) => {
                const du = e.target.value;
                // Le dernier mois suit le premier, douze mois au plus.
                const auTient =
                  valeur.au > du && moisDeDuAu(du, valeur.au) <= BULLETINS_PAR_DEMANDE_MAX;
                set({ du, au: du && auTient ? valeur.au : '' });
              }}
            >
              <option value="">Choisir</option>
              {mois.slice(1).map((m) => (
                <option key={m} value={m}>
                  {moisAffiche(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Au" htmlFor="bulletin-au" required>
            <Select
              id="bulletin-au"
              value={valeur.au}
              disabled={!valeur.du}
              onChange={(e) => set({ au: e.target.value })}
            >
              <option value="">Choisir</option>
              {fins.map((m) => (
                <option key={m} value={m}>
                  {moisAffiche(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Une pastille de choix.
 *
 * L'ancienne collait un « ✓ » devant le libellé : la pastille s'allongeait au
 * clic et toute la ligne se réorganisait. La coche vit maintenant dans un
 * rond de taille fixe, présent coché comme décoché — rien ne bouge, et l'état
 * ne tient pas qu'à la couleur du bord. `aria-pressed` le dit aux lecteurs
 * d'écran, à qui la bordure bleue n'apprend rien.
 */
function ChoixDocument({
  libelle,
  choisi,
  enCours,
  onToggle,
}: {
  libelle: string;
  choisi: boolean;
  /** Déjà demandé, et pas encore prêt : il ne se redemande pas. */
  enCours: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      disabled={enCours}
      title={enCours ? 'Déjà demandé : la demande est en cours de traitement.' : undefined}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] transition-colors duration-150',
        enCours
          ? 'cursor-default border-line-soft text-ink-muted'
          : choisi
            ? 'border-primary bg-primary-soft font-semibold text-primary'
            : 'border-line text-ink hover:border-ink-muted/40 hover:bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          // Un carré arrondi, PAS un rond : le rond promet un choix
          // exclusif, alors qu'on coche ici autant de documents qu'on veut.
          'flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150',
          choisi ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
        )}
      >
        {choisi ? <Icon name="check" size={11} /> : null}
      </span>
      {libelle}
      {enCours ? <span className="text-[11px]">· en cours</span> : null}
    </button>
  );
}
