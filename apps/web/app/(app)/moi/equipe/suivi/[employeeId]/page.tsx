'use client';

import dynamic from 'next/dynamic';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FicheObjectifs, FicheSuivi, FormationProposable } from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../../lib/api';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import { EnTete, Repere } from '../../../../../../components/fiche';
import { Page } from '../../../../../../components/gabarit';
import { Telephone } from '../../../../../../components/telephone';
import { Icon } from '../../../../../../components/icons';
import { CLE_OBJECTIFS } from '../../../../../../components/objectifs';

// L'éditeur ne vit que dans le navigateur, et ne se charge que sur cette page.
const EditeurFicheObjectifs = dynamic(
  () => import('../../../../../../components/fiche-objectifs').then((m) => m.EditeurFicheObjectifs),
  { ssr: false, loading: () => <Skeleton className="mx-5 my-4 h-24" /> },
);

/** Une fiche dit quelque chose dès qu'un bloc porte du texte, une échéance ou une formation. */
function ficheRemplie(contenu: unknown): boolean {
  const texte = JSON.stringify(contenu);
  return /"text":"\s*[^"\s]/.test(texte) || /"type":"(echeance|formation)"/.test(texte);
}

/**
 * La fiche d'un direct : la tête de son dossier, puis sa fiche d'objectifs —
 * que le n+1 rédige comme une page Notion, et qui s'enregistre d'elle-même.
 */
export default function FicheSuiviPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const [ouverte, setOuverte] = useState(false);
  const [signal, setSignal] = useState(0);
  const zone = useRef<HTMLDivElement>(null);

  const fiche = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'equipe', employeeId],
    queryFn: () => api<FicheSuivi>(`/objectifs/equipe/${employeeId}`),
    retry: false,
  });
  const catalogue = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'formations'],
    queryFn: () => api<FormationProposable[]>('/objectifs/formations'),
  });

  if (fiche.isLoading) {
    return (
      <Page>
        <Skeleton className="h-20 w-full rounded-[16px]" />
        <Skeleton className="h-48 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (!fiche.data) {
    return (
      <Page>
        <RetourAcademy href="/moi/equipe/suivi" label="Suivi & Évaluation" />
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="groups" size={22} />}
            title="Cet agent ne fait pas partie de votre équipe"
          />
        </Card>
      </Page>
    );
  }

  const { membre: m } = fiche.data;
  const nom = `${m.givenName} ${m.familyName}`;
  // Déjà rédigée, la fiche s'affiche d'emblée ; sinon, « Fixer des objectifs » l'ouvre.
  const visible = ouverte || ficheRemplie(fiche.data.fiche.contenu);

  return (
    <Page>
      <RetourAcademy href="/moi/equipe/suivi" label="Suivi & Évaluation" />
      {/* La même tête que le dossier du personnel ; à la place du stylo, le
          geste du n+1 — fixer des objectifs. */}
      <EnTete
        titre={nom}
        marque={
          <span role="img" aria-label="Actif" title="Actif" className="inline-flex text-success">
            <Icon name="verified" size={22} />
          </span>
        }
        sousTitre={
          <>
            <span className="font-mono tracking-tight">{m.number}</span>
            {m.positionTitle ? <> · {m.positionTitle}</> : null}
          </>
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOuverte(true);
              setSignal((n) => n + 1);
              zone.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          >
            <Icon name="flag" size={15} />
            Fixer des objectifs
          </Button>
        }
        reperes={
          <>
            <Repere
              label="Direction"
              titre={m.directionName ?? undefined}
              valeur={m.directionShortName ?? m.directionName ?? m.unitName}
            />
            <Repere
              label="Email professionnel"
              titre={m.workEmail ?? undefined}
              valeur={
                m.workEmail ? (
                  <a
                    href={`mailto:${m.workEmail}`}
                    className="break-all transition-colors hover:text-primary hover:underline"
                  >
                    {m.workEmail}
                  </a>
                ) : null
              }
            />
            <Repere
              label="Téléphone professionnel"
              titre={m.workPhone ?? undefined}
              valeur={m.workPhone ? <Telephone valeur={m.workPhone} /> : null}
            />
            <Repere
              label="Téléphone portable"
              titre={m.phone ?? undefined}
              valeur={m.phone ? <Telephone valeur={m.phone} /> : null}
            />
          </>
        }
      />

      <div ref={zone}>
        {visible ? (
          <ZoneFiche
            employeeId={employeeId}
            fiche={fiche.data.fiche}
            catalogue={catalogue.data ?? []}
            signal={signal}
          />
        ) : null}
      </div>
    </Page>
  );
}

type Etat = 'enregistre' | 'modifie' | 'enregistrement' | 'erreur';

/**
 * La zone de rédaction. Chaque pause de la saisie enregistre — pas de
 * bouton : on ne perd pas une fiche parce qu'on a oublié de la sauver. Les
 * enregistrements partent l'un après l'autre, dans l'ordre de la frappe.
 */
function ZoneFiche({
  employeeId,
  fiche,
  catalogue,
  signal,
}: {
  employeeId: string;
  fiche: FicheObjectifs;
  catalogue: FormationProposable[];
  signal: number;
}) {
  const queryClient = useQueryClient();
  const [etat, setEtat] = useState<Etat>('enregistre');
  const [majLe, setMajLe] = useState(fiche.majLe);
  const enAttente = useRef<Record<string, unknown>[] | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const file = useRef<Promise<void>>(Promise.resolve());

  const enregistrer = useCallback(() => {
    file.current = file.current.then(async () => {
      const blocs = enAttente.current;
      if (!blocs) return;
      enAttente.current = null;
      setEtat('enregistrement');
      try {
        const r = await api<{ majLe: string }>(`/objectifs/equipe/${employeeId}/fiche`, {
          method: 'PUT',
          body: { annee: fiche.annee, contenu: blocs },
        });
        setMajLe(r.majLe);
        setEtat(enAttente.current ? 'modifie' : 'enregistre');
        // Revenir sur la page montre la fiche telle qu'on l'a laissée.
        queryClient.setQueryData<FicheSuivi>([...CLE_OBJECTIFS, 'equipe', employeeId], (avant) =>
          avant ? { ...avant, fiche: { ...avant.fiche, contenu: blocs, majLe: r.majLe } } : avant,
        );
      } catch {
        enAttente.current = enAttente.current ?? blocs;
        setEtat('erreur');
      }
    });
    return file.current;
  }, [employeeId, fiche.annee, queryClient]);

  const onChange = useCallback(
    (blocs: Record<string, unknown>[]) => {
      enAttente.current = blocs;
      setEtat('modifie');
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void enregistrer(), 700);
    },
    [enregistrer],
  );

  // Quitter la page n'abandonne pas la dernière phrase.
  useEffect(() => {
    const avantDePartir = (e: BeforeUnloadEvent) => {
      if (enAttente.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', avantDePartir);
    return () => {
      window.removeEventListener('beforeunload', avantDePartir);
      clearTimeout(minuterie.current);
      if (enAttente.current) void enregistrer();
    };
  }, [enregistrer]);

  return (
    <Card className="overflow-visible">
      <div className="flex min-h-9 items-center justify-end gap-2 px-5 pt-3 text-[11.5px]">
        <EtatEnregistrement etat={etat} majLe={majLe} onReessayer={() => void enregistrer()} />
      </div>
      <div className="pt-1 pb-6">
        <EditeurFicheObjectifs
          contenu={fiche.contenu}
          modifiable
          formations={fiche.formations}
          catalogue={catalogue}
          onChange={onChange}
          focusSignal={signal}
        />
      </div>
    </Card>
  );
}

function EtatEnregistrement({
  etat,
  majLe,
  onReessayer,
}: {
  etat: Etat;
  majLe: string | null;
  onReessayer: () => void;
}) {
  if (etat === 'erreur') {
    return (
      <span className="flex items-center gap-1.5 font-semibold text-danger">
        <Icon name="error" size={14} />
        Non enregistré
        <button type="button" onClick={onReessayer} className="underline">
          Réessayer
        </button>
      </span>
    );
  }
  const enCours = etat === 'modifie' || etat === 'enregistrement';
  return (
    <span className={cn('flex items-center gap-1.5 text-ink-muted', enCours && 'opacity-80')}>
      <Icon name={enCours ? 'schedule' : 'check_circle'} size={14} />
      {enCours
        ? 'Enregistrement…'
        : majLe
          ? `Enregistré · ${new Date(majLe).toLocaleString('fr-FR', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : 'Enregistré automatiquement'}
    </span>
  );
}
