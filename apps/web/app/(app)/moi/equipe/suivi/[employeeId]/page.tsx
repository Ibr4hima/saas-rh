'use client';

import dynamic from 'next/dynamic';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  titreDuSemestre,
  type FicheSuivi,
  type FormationDeLaFiche,
  type FormationProposable,
  type Semestre,
} from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../../lib/api';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import { EnTete, Repere } from '../../../../../../components/fiche';
import {
  ChoixSemestre,
  cleDe,
  parAnnee,
  SeparateurAnnee,
  TitreFiche,
} from '../../../../../../components/fiches-semestres';
import { Page } from '../../../../../../components/gabarit';
import { Telephone } from '../../../../../../components/telephone';
import { Icon } from '../../../../../../components/icons';
import { CLE_OBJECTIFS } from '../../../../../../components/objectifs';

// L'éditeur ne vit que dans le navigateur, et ne se charge que sur cette page.
const EditeurFicheObjectifs = dynamic(
  () => import('../../../../../../components/fiche-objectifs').then((m) => m.EditeurFicheObjectifs),
  { ssr: false, loading: () => <Skeleton className="mx-5 my-2 h-16" /> },
);

/**
 * La fiche d'un direct : la tête de son dossier, puis ses objectifs, année
 * par année — et dans l'année, semestre par semestre. Le n+1 les rédige comme
 * une page Notion ; ils s'enregistrent d'eux-mêmes.
 */
export default function FicheSuiviPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);

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

  return (
    <Page>
      <RetourAcademy href="/moi/equipe/suivi" label="Suivi & Évaluation" />
      {/* La même tête que le dossier du personnel. */}
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

      <FichesDuMembre
        employeeId={employeeId}
        fiches={fiche.data.fiches}
        formations={fiche.data.formations}
        catalogue={catalogue.data ?? []}
      />
    </Page>
  );
}

/** Une fiche à l'écran : enregistrée, ou tout juste ouverte par le n+1. */
interface Carte {
  annee: number;
  semestre: Semestre;
  contenu: Record<string, unknown>[];
}

/**
 * Les objectifs du direct, par année. L'année en cours porte le geste du
 * n+1 — « Fixer des objectifs », pour le 1er ou le 2nd semestre ; les années
 * passées gardent leurs fiches, toujours modifiables.
 */
function FichesDuMembre({
  employeeId,
  fiches,
  formations,
  catalogue,
}: {
  employeeId: string;
  fiches: FicheSuivi['fiches'];
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
}) {
  const annee = new Date().getFullYear();
  // Les semestres ouverts depuis le menu, pas encore enregistrés : ils
  // rejoignent `fiches` à la première frappe.
  const [ouvertes, setOuvertes] = useState<Carte[]>([]);
  const [focus, setFocus] = useState({ cle: '', n: 0 });

  const cartes: Carte[] = [
    ...fiches,
    ...ouvertes.filter((o) => !fiches.some((f) => cleDe(f) === cleDe(o))),
  ];
  const fixes = cartes.filter((c) => c.annee === annee).map((c) => c.semestre);

  const choisir = (semestre: Semestre) => {
    const cible: Carte = { annee, semestre, contenu: [] };
    if (!fixes.includes(semestre)) setOuvertes((o) => [...o, cible]);
    setFocus((f) => ({ cle: cleDe(cible), n: f.n + 1 }));
  };

  // La fiche choisie vient à l'écran — neuve ou déjà rédigée.
  useEffect(() => {
    if (focus.n === 0) return;
    document
      .getElementById(`fiche-${focus.cle}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focus]);

  return parAnnee(cartes, annee).map((groupe) => (
    <section key={groupe.annee} className="flex flex-col gap-5">
      <SeparateurAnnee annee={groupe.annee}>
        {groupe.annee === annee ? <ChoixSemestre fixes={fixes} onChoisir={choisir} /> : null}
      </SeparateurAnnee>
      {groupe.fiches.map((c) => (
        <div key={cleDe(c)} id={`fiche-${cleDe(c)}`} className="flex scroll-mt-24 flex-col gap-2.5">
          <TitreFiche>{titreDuSemestre(c.semestre, c.annee)}</TitreFiche>
          <Card className="overflow-visible">
            <ZoneFiche
              employeeId={employeeId}
              carte={c}
              formations={formations}
              catalogue={catalogue}
              signal={focus.cle === cleDe(c) ? focus.n : 0}
            />
          </Card>
        </div>
      ))}
    </section>
  ));
}

/**
 * La zone de rédaction d'un semestre. Chaque pause de la saisie enregistre —
 * pas de bouton : on ne perd pas une fiche parce qu'on a oublié de la sauver.
 * Les enregistrements partent l'un après l'autre, dans l'ordre de la frappe.
 */
function ZoneFiche({
  employeeId,
  carte,
  formations,
  catalogue,
  signal,
}: {
  employeeId: string;
  carte: Carte;
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
  signal: number;
}) {
  const queryClient = useQueryClient();
  const { annee, semestre } = carte;
  const [echec, setEchec] = useState(false);
  const enAttente = useRef<Record<string, unknown>[] | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const file = useRef<Promise<void>>(Promise.resolve());

  const enregistrer = useCallback(() => {
    file.current = file.current.then(async () => {
      const blocs = enAttente.current;
      if (!blocs) return;
      enAttente.current = null;
      try {
        const r = await api<{ majLe: string }>(`/objectifs/equipe/${employeeId}/fiche`, {
          method: 'PUT',
          body: { annee, semestre, contenu: blocs },
        });
        setEchec(false);
        // Revenir sur la page montre la fiche telle qu'on l'a laissée.
        queryClient.setQueryData<FicheSuivi>([...CLE_OBJECTIFS, 'equipe', employeeId], (avant) => {
          if (!avant) return avant;
          const autres = avant.fiches.filter((f) => f.annee !== annee || f.semestre !== semestre);
          const ancienne = avant.fiches.find((f) => f.annee === annee && f.semestre === semestre);
          return {
            ...avant,
            fiches: [
              ...autres,
              { annee, semestre, contenu: blocs, majLe: r.majLe, auteur: ancienne?.auteur ?? null },
            ],
          };
        });
      } catch {
        enAttente.current = enAttente.current ?? blocs;
        setEchec(true);
      }
    });
    return file.current;
  }, [employeeId, annee, semestre, queryClient]);

  const onChange = useCallback(
    (blocs: Record<string, unknown>[]) => {
      enAttente.current = blocs;
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void enregistrer(), 700);
    },
    [enregistrer],
  );

  // Quitter la page n'abandonne pas la dernière phrase. Ctrl+S (⌘S)
  // enregistre sur-le-champ, au lieu d'ouvrir « Enregistrer la page » du
  // navigateur — le réflexe de qui vient d'un traitement de texte.
  useEffect(() => {
    const avantDePartir = (e: BeforeUnloadEvent) => {
      if (enAttente.current) e.preventDefault();
    };
    const sauver = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        clearTimeout(minuterie.current);
        void enregistrer();
      }
    };
    window.addEventListener('beforeunload', avantDePartir);
    window.addEventListener('keydown', sauver);
    return () => {
      window.removeEventListener('beforeunload', avantDePartir);
      window.removeEventListener('keydown', sauver);
      clearTimeout(minuterie.current);
      if (enAttente.current) void enregistrer();
    };
  }, [enregistrer]);

  return (
    <>
      {/* L'enregistrement ne se montre pas : il se fait. Seul un échec se
          dit — une fiche ne se perd pas en silence. */}
      {echec ? (
        <p
          role="alert"
          className="flex items-center justify-end gap-1.5 px-5 pt-3 text-[11.5px] font-semibold text-danger"
        >
          <Icon name="error" size={14} />
          Non enregistré
          <button type="button" onClick={() => void enregistrer()} className="underline">
            Réessayer
          </button>
        </p>
      ) : null}
      <EditeurFicheObjectifs
        className="pt-3.5 pb-1"
        contenu={carte.contenu}
        modifiable
        formations={formations}
        catalogue={catalogue}
        onChange={onChange}
        focusSignal={signal}
      />
    </>
  );
}
