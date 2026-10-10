'use client';

// La feuille de l'éditeur part avec la page, pas avec l'éditeur chargé à la
// demande : une feuille venue d'un module différé peut manquer à l'affichage
// (cases au-dessus du texte, cadre de focus du navigateur autour de la fiche).
import '@blocknote/mantine/style.css';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  objectifsDeLaFiche,
  titreDuSemestre,
  type FicheObjectifs,
  type FicheSuivi,
  type FormationDeLaFiche,
  type FormationProposable,
  type Semestre,
  type StatutObjectif,
} from '@teranga/contracts';
import { Button, Card, CardContent, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../../lib/api';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import { EvaluationSemestre } from '../../../../../../components/evaluation-objectifs';
import { EnTete, Repere } from '../../../../../../components/fiche';
import {
  ChoixSemestre,
  cleDe,
  FicheSemestre,
  SeparateurAnnee,
} from '../../../../../../components/fiches-semestres';
import { Page } from '../../../../../../components/gabarit';
import { Modal } from '../../../../../../components/modal';
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
 * La fiche d'un direct : la tête de son dossier, puis ses objectifs, une
 * année à la fois (choisie dans la liste), semestre par semestre. Le n+1 les
 * rédige comme une page Notion, le crayon puis « Enregistrer ». L'agent
 * s'auto-évalue : chaque case prend la couleur de son statut, et le n+1 le
 * voit à mesure. « Évaluation », en tête, montre ce que l'agent en dit,
 * objectif par objectif, et ce que le n+1 en dit à son tour.
 */
export default function FicheSuiviPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const [vue, setVue] = useState<Vue>('objectifs');
  // L'année choisie dans la liste ; sans choix, celle que la page propose.
  const [choisie, setChoisie] = useState<number | null>(null);

  // « ?vue=evaluation » : on arrive d'une notification, des commentaires à
  // évaluer ; « ?annee= » dit de quelle année.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('vue') === 'evaluation') setVue('evaluation');
    const a = Number(q.get('annee'));
    if (Number.isInteger(a) && a >= 2000 && a <= 2100) setChoisie(a);
  }, []);
  // L'adresse suit la vue et l'année : recharger la page n'en change rien.
  const adresse = (v: Vue, a: number | null) => {
    const q = new URLSearchParams();
    if (v === 'evaluation') q.set('vue', 'evaluation');
    if (a !== null) q.set('annee', String(a));
    const s = q.toString();
    window.history.replaceState(null, '', s ? `?${s}` : window.location.pathname);
  };
  const changerDeVue = (v: Vue) => {
    setVue(v);
    adresse(v, choisie);
  };
  const choisirAnnee = (a: number) => {
    setChoisie(a);
    adresse(vue, a);
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
  // La liste des années : la suivante (ses objectifs se fixent à l'avance),
  // l'année en cours, puis les années passées qui ont des fiches. Sans choix,
  // l'évaluation s'ouvre sur l'année d'une auto-évaluation qui attend.
  const enCours = fiche.data.annee;
  const enAttente = [
    ...new Set(
      fiche.data.fiches
        .filter((f) => f.evaluation.envoyesLe && !f.evaluation.valideeLe)
        .map((f) => f.annee),
    ),
  ].sort((a, b) => b - a);
  const annee = choisie ?? (vue === 'evaluation' ? (enAttente[0] ?? enCours) : enCours);
  const annees = [
    ...new Set([
      ...(m.parti ? [] : [enCours + 1]),
      enCours,
      annee,
      ...fiche.data.fiches.map((f) => f.annee),
    ]),
  ].sort((a, b) => b - a);

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
        annee={annee}
        enCours={enCours}
        annees={annees}
        enAttente={enAttente}
        onAnnee={choisirAnnee}
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
 * Ce qu'on a écrit dans une fiche sans l'enregistrer, par agent et par
 * semestre. La page qui s'en va le garde ; elle le rend, la fiche ouverte,
 * quand on y revient (la vue Évaluation, une notification, le retour du
 * navigateur).
 */
const brouillons = new Map<string, Carte>();
const cleDuBrouillon = (employeeId: string, c: Carte) => `${employeeId}:${cleDe(c)}`;

/**
 * Les objectifs du direct pour l'année choisie. L'année en cours et la
 * suivante portent le geste du n+1, « Fixer des objectifs », pour le 1er ou
 * le 2nd semestre ; les années passées gardent leurs fiches, toujours
 * modifiables.
 */
function FichesDuMembre({
  employeeId,
  prenom,
  parti,
  vue,
  annee,
  enCours,
  annees,
  enAttente,
  onAnnee,
  fiches,
  formations,
  catalogue,
}: {
  employeeId: string;
  prenom: string;
  /** Parti : ses objectifs ne se fixent plus, son évaluation se termine. */
  parti: boolean;
  vue: Vue;
  /** L'année à l'écran. */
  annee: number;
  enCours: number;
  /** Les années de la liste, la plus récente d'abord. */
  annees: number[];
  /** Les années où une auto-évaluation attend le n+1. */
  enAttente: number[];
  onAnnee: (annee: number) => void;
  fiches: FicheSuivi['fiches'];
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
}) {
  const router = useRouter();
  // Les semestres ouverts depuis le menu, pas encore enregistrés : ils
  // rejoignent `fiches` au premier enregistrement. Un brouillon laissé sur
  // l'un d'eux le rouvre.
  const [ouvertes, setOuvertes] = useState<Carte[]>(() =>
    [...brouillons]
      .filter(([cle]) => cle.startsWith(`${employeeId}:`))
      .map(([, c]) => ({ ...c, contenu: [] })),
  );
  const [focus, setFocus] = useState({ cle: '', n: 0 });
  // Un lien de l'application, une fiche modifiée sans être enregistrée : on
  // demande avant de partir. Partir ainsi abandonne les brouillons.
  const [sortie, setSortie] = useState<{ vers: string; fiches: string[] } | null>(null);
  const abandon = useRef(false);

  useEffect(() => {
    const auClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const lien = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(lien instanceof HTMLAnchorElement) || lien.target === '_blank') return;
      const vers = new URL(lien.href);
      if (vers.origin !== window.location.origin || vers.pathname === window.location.pathname) {
        return;
      }
      const fiches = [...document.querySelectorAll('[data-fiche-modifiee]')].map(
        (el) => el.getAttribute('data-fiche-modifiee') ?? '',
      );
      if (!fiches.length) return;
      e.preventDefault();
      e.stopPropagation();
      setSortie({ vers: `${vers.pathname}${vers.search}${vers.hash}`, fiches });
    };
    // À la capture : avant que le lien ne lance la navigation.
    document.addEventListener('click', auClic, true);
    return () => document.removeEventListener('click', auClic, true);
  }, []);

  // Les fiches de l'année, le 2nd semestre avant le 1er.
  const delAnnee = <T extends Carte>(liste: T[]) =>
    liste.filter((c) => c.annee === annee).sort((a, b) => b.semestre - a.semestre);
  const cartes = delAnnee([
    ...fiches,
    ...ouvertes.filter((o) => !fiches.some((f) => cleDe(f) === cleDe(o))),
  ]);
  const fixes = cartes.map((c) => c.semestre);
  const separateur = (geste?: ReactNode) => (
    <SeparateurAnnee annee={annee} choix={{ annees, enAttente, onChoisir: onAnnee }}>
      {geste}
    </SeparateurAnnee>
  );

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
    return (
      <section className="flex flex-col gap-7">
        {separateur()}
        {delAnnee(fiches).map((f) => (
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
    );
  }

  return (
    <>
      <section className="flex flex-col gap-7">
        {/* Les objectifs se fixent pour l'année en cours, ou à l'avance pour la suivante. */}
        {separateur(
          !parti && annee >= enCours ? <ChoixSemestre fixes={fixes} onChoisir={choisir} /> : null,
        )}
        {cartes.map((c) => {
          const enregistree = fiches.find((f) => cleDe(f) === cleDe(c));
          return (
            <ZoneFiche
              key={cleDe(c)}
              employeeId={employeeId}
              carte={c}
              majLe={enregistree?.majLe ?? null}
              statuts={enregistree?.statuts ?? {}}
              // L'agent a envoyé son auto-évaluation : ses objectifs ne changent plus.
              verrouillee={parti || Boolean(enregistree?.evaluation.envoyesLe)}
              // Envoyée, la fiche garde l'état de ses formations à ce jour-là.
              formations={enregistree?.formations ?? formations}
              catalogue={catalogue}
              signal={focus.cle === cleDe(c) ? focus.n : 0}
              abandon={abandon}
              onRetirer={() => setOuvertes((o) => o.filter((x) => cleDe(x) !== cleDe(c)))}
            />
          );
        })}
      </section>
      <Modal
        open={sortie !== null}
        onClose={() => setSortie(null)}
        title="Quitter sans enregistrer ?"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSortie(null)}>
              Rester
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!sortie) return;
                abandon.current = true;
                setSortie(null);
                router.push(sortie.vers);
              }}
            >
              Quitter
            </Button>
          </>
        }
      >
        <Card>
          <CardContent className="flex flex-col gap-1.5 py-4">
            {sortie?.fiches.map((titre) => (
              <p key={titre} className="text-[13.5px] font-semibold text-ink-strong">
                {titre}
              </p>
            ))}
          </CardContent>
        </Card>
      </Modal>
    </>
  );
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

/** Une fiche où rien n'est écrit : ni objectif, ni formation, ni commentaire. */
const vide = (blocs: Record<string, unknown>[]) =>
  objectifsDeLaFiche(blocs).length === 0 && blocs.every((b) => b.type === 'checkListItem');

/** Le bouton rond posé sur le bord haut de la fiche : le crayon, puis l'enregistrement. */
const ROND =
  'grid size-[30px] shrink-0 place-items-center rounded-full border outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/35';

/**
 * La fiche d'un semestre. Elle se lit d'abord ; le crayon l'ouvre, et
 * « Enregistrer » la referme et prévient l'agent (ADR-0051) : rien ne s'y
 * change par mégarde. Ce qui n'est pas enregistré ne se perd pas en
 * silence : le navigateur demande avant de fermer la page, et la page le
 * garde le temps d'y revenir.
 */
function ZoneFiche({
  employeeId,
  carte,
  majLe,
  statuts,
  verrouillee,
  formations,
  catalogue,
  signal,
  abandon,
  onRetirer,
}: {
  employeeId: string;
  carte: Carte;
  /** Le dernier enregistrement ; aucun pour un semestre tout juste ouvert. */
  majLe: string | null;
  /** L'auto-évaluation de l'agent : la fiche la suit, sans que le n+1 puisse cocher. */
  statuts: Record<string, StatutObjectif>;
  /** L'agent a rendu compte : la fiche se lit, elle ne s'écrit plus. */
  verrouillee: boolean;
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
  /** « Fixer des objectifs » sur ce semestre : la fiche s'ouvre, le curseur en fin d'objectifs. */
  signal: number;
  /** On quitte la page sans enregistrer : les brouillons partent avec elle. */
  abandon: RefObject<boolean>;
  /** Un semestre neuf refermé sans rien d'écrit quitte l'écran. */
  onRetirer: () => void;
}) {
  const queryClient = useQueryClient();
  const { annee, semestre } = carte;
  const cle = cleDuBrouillon(employeeId, carte);
  const racine = useRef<HTMLDivElement>(null);
  // Ouverte : le contenu dont l'éditeur repart. Un semestre tout juste
  // ouvert s'écrit d'emblée ; un brouillon laissé rouvre sa fiche.
  const [depart, setDepart] = useState<Record<string, unknown>[] | null>(
    () => brouillons.get(cle)?.contenu ?? (majLe === null ? carte.contenu : null),
  );
  // Ce qu'on y a changé ; rien tant qu'on n'a pas écrit.
  const brouillon = useRef<Record<string, unknown>[] | null>(brouillons.get(cle)?.contenu ?? null);
  const [modifiee, setModifiee] = useState(() => brouillons.has(cle));
  const [curseur, setCurseur] = useState(() => (brouillons.has(cle) ? 0 : signal));
  const [signalVu, setSignalVu] = useState(signal);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState(false);
  const enCours = useRef(false);

  if (signal !== signalVu) {
    setSignalVu(signal);
    if (!verrouillee) {
      setDepart((d) => d ?? carte.contenu);
      setCurseur((c) => c + 1);
    }
  }

  // Verrouillée (l'agent a rendu compte, ou a quitté l'APIX), elle se lit
  // seulement : ce qui n'était pas enregistré n'a plus où aller.
  const ouverte = depart !== null && !verrouillee;
  const aEnregistrer = ouverte && modifiee;

  const ouvrir = () => {
    setDepart(carte.contenu);
    setCurseur((c) => c + 1);
  };

  const onChange = useCallback((blocs: Record<string, unknown>[]) => {
    brouillon.current = blocs;
    setModifiee(true);
  }, []);

  const refermer = useCallback(() => {
    brouillon.current = null;
    setModifiee(false);
    setEchec(false);
    setDepart(null);
  }, []);

  const enregistrer = useCallback(async () => {
    if (enCours.current) return;
    const blocs = brouillon.current;
    // Rien de changé : la fiche se referme, sans écrire ni prévenir. Un
    // semestre neuf où rien n'est écrit ne se crée pas.
    if (!blocs || (majLe === null && vide(blocs))) {
      refermer();
      if (majLe === null) onRetirer();
      return;
    }
    enCours.current = true;
    setEnvoi(true);
    const cleFiche = [...CLE_OBJECTIFS, 'equipe', employeeId];
    try {
      const r = await api<{ majLe: string }>(`/objectifs/equipe/${employeeId}/fiche`, {
        method: 'PUT',
        body: { annee, semestre, contenu: blocs },
      });
      // Une lecture partie avant l'enregistrement ne ramène pas l'ancienne fiche.
      await queryClient.cancelQueries({ queryKey: cleFiche });
      queryClient.setQueryData<FicheSuivi>(cleFiche, (avant) => {
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
      refermer();
    } catch {
      setEchec(true);
    } finally {
      enCours.current = false;
      setEnvoi(false);
    }
  }, [employeeId, annee, semestre, majLe, queryClient, refermer, onRetirer]);

  // Ctrl+S (⌘S) enregistre la fiche où l'on écrit, au lieu d'ouvrir
  // « Enregistrer la page » du navigateur ; sans curseur dans aucune
  // fiche, toutes celles qui sont ouvertes.
  useEffect(() => {
    if (!ouverte) return;
    const auClavier = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      const ici = document.activeElement?.closest('[data-fiche-ouverte]');
      if (!ici || ici === racine.current) void enregistrer();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [ouverte, enregistrer]);

  // Fermer ou recharger la page, une fiche modifiée : le navigateur demande.
  useEffect(() => {
    if (!aEnregistrer) return;
    const avantDePartir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avantDePartir);
    return () => window.removeEventListener('beforeunload', avantDePartir);
  }, [aEnregistrer]);

  // Le brouillon repris ; la page qui s'en va le garde à son tour.
  useEffect(() => {
    brouillons.delete(cle);
    return () => {
      if (brouillon.current && !abandon.current) {
        brouillons.set(cle, { annee, semestre, contenu: brouillon.current });
      }
    };
  }, [cle, annee, semestre, abandon]);

  useEffect(() => {
    if (verrouillee) brouillon.current = null;
  }, [verrouillee]);

  return (
    <div
      ref={racine}
      data-fiche-ouverte={ouverte || undefined}
      data-fiche-modifiee={aEnregistrer ? titreDuSemestre(semestre, annee) : undefined}
    >
      <FicheSemestre
        id={`fiche-${cleDe(carte)}`}
        annee={annee}
        semestre={semestre}
        enEdition={ouverte}
        // Un seul bouton, qui change de rôle : le focus du clavier y reste
        // quand la fiche se referme. Jamais désactivé (il perdrait le focus) :
        // un second clic pendant l'envoi ne fait rien.
        action={
          verrouillee ? null : (
            <button
              type="button"
              onClick={ouverte ? () => void enregistrer() : ouvrir}
              aria-busy={envoi || undefined}
              aria-label={ouverte ? 'Enregistrer les objectifs' : 'Modifier les objectifs'}
              title={ouverte ? 'Enregistrer' : 'Modifier'}
              className={cn(
                ROND,
                ouverte
                  ? 'border-primary bg-primary text-primary-ink shadow-[0_4px_12px_-4px_rgb(0_79_145/0.5)] hover:bg-primary-hover'
                  : 'border-card-line bg-surface text-ink-muted shadow-xs hover:border-primary/45 hover:text-primary',
                envoi && 'opacity-70',
              )}
            >
              <Icon name={ouverte ? 'save' : 'edit'} size={ouverte ? 17 : 16} />
            </button>
          )
        }
      >
        {/* L'enregistrement réussi referme la fiche ; seul un échec se dit. */}
        {echec ? (
          <p
            role="alert"
            className="flex items-center justify-end gap-1.5 px-5 pt-3 text-[11.5px] font-semibold text-danger"
          >
            <Icon name="error" size={14} />
            Non enregistré
          </p>
        ) : null}
        {depart !== null && !verrouillee ? (
          <EditeurFicheObjectifs
            key="redaction"
            className="pt-4 pb-1"
            contenu={depart}
            modifiable
            formations={formations}
            catalogue={catalogue}
            onChange={onChange}
            focusSignal={curseur}
            statuts={statuts}
          />
        ) : (
          // Relue après chaque enregistrement : la fiche telle qu'elle est.
          <EditeurFicheObjectifs
            key={`lecture-${majLe}`}
            className="pt-4 pb-4"
            contenu={carte.contenu}
            modifiable={false}
            formations={formations}
            catalogue={catalogue}
            statuts={statuts}
          />
        )}
      </FicheSemestre>
    </div>
  );
}
