'use client';

// La feuille de l'éditeur part avec la page, pas avec l'éditeur chargé à la
// demande : une feuille venue d'un module différé peut manquer à l'affichage
// (cases au-dessus du texte, cadre de focus du navigateur autour de la fiche).
import '@blocknote/mantine/style.css';
import dynamic from 'next/dynamic';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type FicheObjectifs,
  type FicheSuivi,
  type FormationDeLaFiche,
  type FormationProposable,
  type Semestre,
  type StatutObjectif,
} from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../../lib/api';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import { EvaluationSemestre } from '../../../../../../components/evaluation-objectifs';
import { EnTete, Repere } from '../../../../../../components/fiche';
import {
  ChoixSemestre,
  cleDe,
  FicheSemestre,
  parAnnee,
  SeparateurAnnee,
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

type Vue = 'objectifs' | 'evaluation';

/**
 * La fiche d'un direct : la tête de son dossier, puis ses objectifs, année
 * par année — et dans l'année, semestre par semestre. Le n+1 les rédige comme
 * une page Notion ; ils s'enregistrent d'eux-mêmes. L'agent s'auto-évalue —
 * chaque case prend la couleur de son statut, et le n+1 le voit à mesure.
 * « Évaluation », en tête, montre ce que l'agent en dit, objectif par
 * objectif, et ce que le n+1 en dit à son tour.
 */
export default function FicheSuiviPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const [vue, setVue] = useState<Vue>('objectifs');

  // « ?vue=evaluation » : on arrive d'une notification — des commentaires à évaluer.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('vue') === 'evaluation') {
      setVue('evaluation');
    }
  }, []);
  const changerDeVue = (v: Vue) => {
    setVue(v);
    window.history.replaceState(
      null,
      '',
      v === 'evaluation' ? '?vue=evaluation' : window.location.pathname,
    );
  };

  const fiche = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'equipe', employeeId],
    queryFn: () => api<FicheSuivi>(`/objectifs/equipe/${employeeId}`, { arrierePlan: true }),
    retry: false,
    // L'auto-évaluation de l'agent se voit à mesure, sans recharger la page.
    refetchInterval: 4000,
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
          m.parti ? (
            <span
              role="img"
              aria-label="Inactif"
              title="Inactif"
              className="inline-flex text-ink-muted"
            >
              <Icon name="verified_off" size={22} />
            </span>
          ) : (
            <span role="img" aria-label="Actif" title="Actif" className="inline-flex text-success">
              <Icon name="verified" size={22} />
            </span>
          )
        }
        sousTitre={
          <>
            <span className="font-mono tracking-tight">{m.number}</span>
            {m.positionTitle ? <> · {m.positionTitle}</> : null}
          </>
        }
        action={
          vue === 'objectifs' ? (
            <Button variant="secondary" size="sm" onClick={() => changerDeVue('evaluation')}>
              <span className="relative flex">
                <Icon name="rate_review" size={16} />
                {/* Des commentaires attendent l'évaluation. */}
                {m.aEvaluer > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-surface"
                  />
                ) : null}
              </span>
              Évaluation
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => changerDeVue('objectifs')}>
              <Icon name="flag" size={15} />
              Objectifs
            </Button>
          )
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
        prenom={m.givenName}
        parti={m.parti}
        vue={vue}
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
  prenom,
  parti,
  vue,
  fiches,
  formations,
  catalogue,
}: {
  employeeId: string;
  prenom: string;
  /** Parti : ses objectifs ne se fixent plus, son évaluation se termine. */
  parti: boolean;
  vue: Vue;
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

  // L'évaluation : les fiches enregistrées seulement, avec ce qu'en dit l'agent.
  if (vue === 'evaluation') {
    return parAnnee(fiches, annee).map((groupe) => (
      <section key={groupe.annee} className="flex flex-col gap-7">
        <SeparateurAnnee annee={groupe.annee} />
        {groupe.fiches.map((f) => (
          <FicheSemestre
            key={cleDe(f)}
            annee={f.annee}
            semestre={f.semestre}
            titre={`Évaluation des objectifs du ${f.semestre === 1 ? '1er' : '2nd'} semestre de ${f.annee}`}
          >
            <EvaluationSemestre employeeId={employeeId} prenom={prenom} fiche={f} />
          </FicheSemestre>
        ))}
      </section>
    ));
  }

  return parAnnee(cartes, annee).map((groupe) => (
    <section key={groupe.annee} className="flex flex-col gap-7">
      <SeparateurAnnee annee={groupe.annee}>
        {groupe.annee === annee && !parti ? (
          <ChoixSemestre fixes={fixes} onChoisir={choisir} />
        ) : null}
      </SeparateurAnnee>
      {groupe.fiches.map((c) => {
        const enregistree = fiches.find((f) => cleDe(f) === cleDe(c));
        return (
          <FicheSemestre
            key={cleDe(c)}
            id={`fiche-${cleDe(c)}`}
            annee={c.annee}
            semestre={c.semestre}
          >
            <ZoneFiche
              employeeId={employeeId}
              carte={c}
              statuts={enregistree?.statuts ?? {}}
              // L'agent a envoyé son auto-évaluation : ses objectifs ne changent plus.
              verrouillee={parti || Boolean(enregistree?.evaluation.envoyesLe)}
              // Envoyée, la fiche garde l'état de ses formations à ce jour-là.
              formations={enregistree?.formations ?? formations}
              catalogue={catalogue}
              signal={focus.cle === cleDe(c) ? focus.n : 0}
            />
          </FicheSemestre>
        );
      })}
    </section>
  ));
}

/** Une fiche tout juste ouverte : ni statut, ni commentaire. */
const SANS_EVALUATION: FicheObjectifs['evaluation'] = {
  commentairesAgent: {},
  envoyesLe: null,
  commentairesN1: {},
  note: null,
  valideeLe: null,
  evaluateur: null,
};

/**
 * La zone de rédaction d'un semestre. Chaque pause de la saisie enregistre —
 * pas de bouton : on ne perd pas une fiche parce qu'on a oublié de la sauver.
 * Les enregistrements partent l'un après l'autre, dans l'ordre de la frappe.
 */
function ZoneFiche({
  employeeId,
  carte,
  statuts,
  verrouillee,
  formations,
  catalogue,
  signal,
}: {
  employeeId: string;
  carte: Carte;
  /** L'auto-évaluation de l'agent — la fiche la suit, sans que le n+1 puisse cocher. */
  statuts: Record<string, StatutObjectif>;
  /** L'agent a rendu compte : la fiche se lit, elle ne s'écrit plus. */
  verrouillee: boolean;
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
              {
                annee,
                semestre,
                contenu: blocs,
                majLe: r.majLe,
                auteur: ancienne?.auteur ?? null,
                statuts: ancienne?.statuts ?? {},
                statutsCaducs: ancienne?.statutsCaducs ?? [],
                formations: ancienne?.formations ?? null,
                evaluation: ancienne?.evaluation ?? SANS_EVALUATION,
              },
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
        className={cn('pt-4', verrouillee ? 'pb-4' : 'pb-1')}
        contenu={carte.contenu}
        modifiable={!verrouillee}
        formations={formations}
        catalogue={catalogue}
        onChange={onChange}
        focusSignal={signal}
        statuts={statuts}
      />
    </>
  );
}
