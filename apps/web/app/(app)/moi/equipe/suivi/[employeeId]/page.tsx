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
  dateDEvaluation,
  titreDeLAnnee,
  type FicheEnregistree,
  type FicheObjectifs,
  type FicheSuivi,
  type FormationDeLaFiche,
  type FormationProposable,
  type StatutObjectif,
} from '@teranga/contracts';
import { Button, Card, CardContent, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../../../lib/api';
import { aujourdhui } from '../../../../../../lib/temps';
import { RetourDeLEcran } from '../../../../../../components/entete';
import { EvaluationAnnuelle } from '../../../../../../components/evaluation-objectifs';
import { EnTete, Repere } from '../../../../../../components/fiche';
import { FicheAnnuelle, SeparateurAnnee } from '../../../../../../components/fiches-annuelles';
import { Page } from '../../../../../../components/gabarit';
import { Modal } from '../../../../../../components/modal';
import { Telephone } from '../../../../../../components/telephone';
import { Icon } from '../../../../../../components/icons';
import { Sceau } from '../../../../../../components/sceau';
import { CLE_OBJECTIFS } from '../../../../../../components/objectifs';

// L'éditeur ne vit que dans le navigateur, et ne se charge que sur cette page.
const EditeurFicheObjectifs = dynamic(
  () => import('../../../../../../components/fiche-objectifs').then((m) => m.EditeurFicheObjectifs),
  { ssr: false, loading: () => <Skeleton className="mx-5 my-2 h-16" /> },
);

type Vue = 'objectifs' | 'evaluation';

/**
 * La fiche d'un direct : la tête de son dossier, puis ses objectifs, une
 * année à la fois (choisie dans la liste), une fiche par année. Le n+1 la
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
        <Skeleton className="h-20 w-full rounded-bloc" />
        <Skeleton className="h-48 w-full rounded-bloc" />
      </Page>
    );
  }
  if (!fiche.data) {
    return (
      <Page>
        <RetourDeLEcran href="/moi/equipe/suivi" libelle="Suivi & Évaluation" />
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
      <RetourDeLEcran href="/moi/equipe/suivi" libelle="Suivi & Évaluation" />
      {/* La même tête que le dossier du personnel. */}
      <EnTete
        titre={nom}
        marque={
          m.parti ? (
            <span role="img" aria-label="Inactif" title="Inactif" className="inline-flex">
              <Sceau actif={false} />
            </span>
          ) : (
            <span role="img" aria-label="Actif" title="Actif" className="inline-flex">
              <Sceau actif />
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
                {m.aEvaluer > 0 && !m.lectureSeule ? (
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
        lecture={m.lectureSeule}
        vue={vue}
        annee={annee}
        enCours={enCours}
        annees={annees}
        enAttente={enAttente}
        onAnnee={choisirAnnee}
        fiches={fiche.data.fiches}
        formations={fiche.data.formations}
        // Ce que l'agent encadre ne se donne pas à suivre (ADR-0057, ADR-0058).
        catalogue={(catalogue.data ?? []).filter(
          (c) => !fiche.data.formationsEncadrees.includes(c.id),
        )}
        jourEvaluation={fiche.data.jourEvaluation}
      />
    </Page>
  );
}

/** Ce qu'on écrit dans une fiche sans l'enregistrer. */
interface Brouillon {
  annee: number;
  contenu: Record<string, unknown>[];
}

/**
 * Ce qu'on a écrit dans une fiche sans l'enregistrer, par agent et par
 * année. La page qui s'en va le garde ; elle le rend, la fiche ouverte,
 * quand on y revient (la vue Évaluation, une notification, le retour du
 * navigateur).
 */
const brouillons = new Map<string, Brouillon>();
const cleDuBrouillon = (employeeId: string, annee: number) => `${employeeId}:${annee}`;

/**
 * Les objectifs du direct pour l'année choisie. L'année en cours et la
 * suivante portent le geste du n+1, « Fixer des objectifs », tant que leur
 * évaluation est à venir : la fiche de l'année s'ouvre, à la rédaction
 * (ADR-0075). Les années passées gardent leurs fiches.
 */
function FichesDuMembre({
  employeeId,
  prenom,
  parti,
  lecture,
  vue,
  annee,
  enCours,
  annees,
  enAttente,
  onAnnee,
  fiches,
  formations,
  catalogue,
  jourEvaluation,
}: {
  employeeId: string;
  prenom: string;
  /** Parti : ses objectifs ne se fixent plus, son évaluation se termine. */
  parti: boolean;
  /**
   * Vu par son N+1 hiérarchique, un autre agent étant son N+1 fonctionnel
   * (ADR-0147) : tout se lit, rien ne se fixe ni ne s'évalue.
   */
  lecture: boolean;
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
  jourEvaluation: string;
}) {
  const router = useRouter();
  // Les années ouvertes par « Fixer des objectifs », pas encore enregistrées :
  // elles rejoignent `fiches` au premier enregistrement. Un brouillon laissé
  // sur l'une d'elles la rouvre.
  const [ouvertes, setOuvertes] = useState<number[]>(() =>
    [...brouillons].filter(([cle]) => cle.startsWith(`${employeeId}:`)).map(([, b]) => b.annee),
  );
  // « Fixer des objectifs » : la fiche de l'année s'ouvre et vient à l'écran.
  const [focus, setFocus] = useState({ annee: 0, n: 0 });
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

  const fiche = fiches.find((f) => f.annee === annee) ?? null;
  // La fiche de l'année, enregistrée ou tout juste ouverte.
  const aLEcran = fiche !== null || ouvertes.includes(annee);
  // Les objectifs se fixent pour l'année en cours, ou à l'avance pour la
  // suivante, tant que l'évaluation de l'année est à venir et que l'agent n'a
  // pas rendu compte.
  const fixable =
    !parti &&
    !lecture &&
    annee >= enCours &&
    dateDEvaluation(annee, jourEvaluation) >= aujourdhui() &&
    !fiche?.evaluation.envoyesLe;
  const separateur = (geste?: ReactNode) => (
    <SeparateurAnnee annee={annee} choix={{ annees, enAttente, onChoisir: onAnnee }}>
      {geste}
    </SeparateurAnnee>
  );

  const fixer = () => {
    if (!aLEcran) setOuvertes((o) => [...o, annee]);
    setFocus((f) => ({ annee, n: f.n + 1 }));
  };

  // La fiche vient à l'écran : neuve ou déjà rédigée.
  useEffect(() => {
    if (focus.n === 0) return;
    document
      .getElementById(`fiche-${focus.annee}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focus]);

  // L'évaluation : la fiche enregistrée seulement, avec ce qu'en dit l'agent.
  if (vue === 'evaluation') {
    return (
      <section className="flex flex-col gap-7">
        {separateur()}
        {fiche ? (
          <FicheAnnuelle
            annee={fiche.annee}
            titre={`Évaluation des objectifs de l’année ${fiche.annee}`}
          >
            <EvaluationAnnuelle
              employeeId={employeeId}
              prenom={prenom}
              fiche={fiche}
              reportable={!parti}
              lecture={lecture}
            />
          </FicheAnnuelle>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-7">
        {separateur(
          fixable ? (
            <Button variant="secondary" size="sm" onClick={fixer}>
              <Icon name="flag" size={15} />
              Fixer des objectifs
            </Button>
          ) : null,
        )}
        {aLEcran ? (
          <ZoneFiche
            key={annee}
            employeeId={employeeId}
            annee={annee}
            fiche={fiche}
            // L'agent a envoyé son auto-évaluation : ses objectifs ne changent plus.
            verrouillee={parti || lecture || Boolean(fiche?.evaluation.envoyesLe)}
            // Envoyée, la fiche garde l'état de ses formations à ce jour-là.
            formations={fiche?.formations ?? formations}
            catalogue={catalogue}
            jourEvaluation={jourEvaluation}
            signal={focus.annee === annee ? focus.n : 0}
            abandon={abandon}
            onRetirer={() => setOuvertes((o) => o.filter((x) => x !== annee))}
          />
        ) : null}
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

/** Une fiche tout juste ouverte : rien d'écrit, aucun statut. */
const SANS_CONTENU: Record<string, unknown>[] = [];
const SANS_STATUT: Record<string, StatutObjectif> = {};

/** Le bouton rond posé sur le bord haut de la fiche : le crayon, puis l'enregistrement. */
const ROND =
  'grid size-[30px] shrink-0 place-items-center rounded-full border outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/35';

/**
 * La fiche d'une année. Elle se lit d'abord ; le crayon l'ouvre, et
 * « Enregistrer » la referme et prévient l'agent (ADR-0051) : rien ne s'y
 * change par mégarde. Ouverte par « Fixer des objectifs », elle s'écrit
 * d'emblée ; neuve et refermée sans rien d'écrit, elle disparaît sans rien
 * créer. Ce qui n'est pas enregistré ne se perd pas en silence : le
 * navigateur demande avant de fermer la page, et la page le garde le temps
 * d'y revenir.
 */
function ZoneFiche({
  employeeId,
  annee,
  fiche,
  verrouillee,
  formations,
  catalogue,
  jourEvaluation,
  signal,
  abandon,
  onRetirer,
}: {
  employeeId: string;
  annee: number;
  /** `null` : l'année vient d'être ouverte, rien n'est encore enregistré. */
  fiche: FicheObjectifs | null;
  /** L'agent a rendu compte : la fiche se lit, elle ne s'écrit plus. */
  verrouillee: boolean;
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
  jourEvaluation: string;
  /** « Fixer des objectifs » : la fiche s'ouvre, le curseur en fin d'objectifs. */
  signal: number;
  /** On quitte la page sans enregistrer : les brouillons partent avec elle. */
  abandon: RefObject<boolean>;
  /** Une fiche neuve refermée sans rien d'écrit quitte l'écran. */
  onRetirer: () => void;
}) {
  const queryClient = useQueryClient();
  const cle = cleDuBrouillon(employeeId, annee);
  const contenu = fiche?.contenu ?? SANS_CONTENU;
  const statuts = fiche?.statuts ?? SANS_STATUT;
  const majLe = fiche?.majLe ?? null;
  // Ouverte : le contenu dont l'éditeur repart. Une fiche tout juste ouverte
  // s'écrit d'emblée ; un brouillon laissé la rouvre.
  const [depart, setDepart] = useState<Record<string, unknown>[] | null>(
    () => brouillons.get(cle)?.contenu ?? (fiche === null ? SANS_CONTENU : null),
  );
  // Ce qu'on y a changé ; rien tant qu'on n'a pas écrit.
  const brouillon = useRef<Record<string, unknown>[] | null>(brouillons.get(cle)?.contenu ?? null);
  const [modifiee, setModifiee] = useState(() => brouillons.has(cle));
  const [curseur, setCurseur] = useState(() => (brouillons.has(cle) ? 0 : signal));
  const signalVu = useRef(signal);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const enCours = useRef(false);

  // Verrouillée (l'agent a rendu compte, ou a quitté l'APIX), elle se lit
  // seulement : ce qui n'était pas enregistré n'a plus où aller.
  const ouverte = depart !== null && !verrouillee;
  const aEnregistrer = ouverte && modifiee;

  const ouvrir = useCallback(() => {
    setDepart(contenu);
    setCurseur((c) => c + 1);
  }, [contenu]);

  // « Fixer des objectifs » : la fiche s'ouvre, le curseur au bout de ses
  // objectifs.
  useEffect(() => {
    if (signal === signalVu.current) return;
    signalVu.current = signal;
    if (verrouillee) return;
    if (depart === null) ouvrir();
    else setCurseur((c) => c + 1);
  }, [signal, verrouillee, depart, ouvrir]);

  const onChange = useCallback((blocs: Record<string, unknown>[]) => {
    brouillon.current = blocs;
    setModifiee(true);
    setEchec(null);
  }, []);

  const refermer = useCallback(() => {
    brouillon.current = null;
    setModifiee(false);
    setEchec(null);
    setDepart(null);
  }, []);

  const enregistrer = useCallback(async () => {
    if (enCours.current) return;
    const blocs = brouillon.current;
    // Rien de changé : la fiche se referme, sans écrire ni prévenir. Une
    // fiche neuve où rien n'est écrit ne se crée pas.
    if (!blocs || (fiche === null && blocs.length === 0)) {
      refermer();
      if (fiche === null) onRetirer();
      return;
    }
    enCours.current = true;
    setEnvoi(true);
    try {
      await api<FicheEnregistree>(`/objectifs/equipe/${employeeId}/fiche`, {
        method: 'PUT',
        body: { annee, contenu: blocs },
      });
      // La fiche se relit telle que le serveur l'a rangée.
      await queryClient.invalidateQueries({ queryKey: [...CLE_OBJECTIFS, 'equipe', employeeId] });
      refermer();
      if (fiche === null) onRetirer();
    } catch (err) {
      setEchec(err instanceof ApiError ? err.message : 'Non enregistré');
    } finally {
      enCours.current = false;
      setEnvoi(false);
    }
  }, [employeeId, annee, fiche, queryClient, refermer, onRetirer]);

  // Ctrl+S (⌘S) enregistre la fiche, au lieu d'ouvrir « Enregistrer la page »
  // du navigateur.
  useEffect(() => {
    if (!ouverte) return;
    const auClavier = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      // Une fenêtre ouverte se termine d'abord.
      if (document.querySelector('[aria-modal="true"]')) return;
      void enregistrer();
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
        brouillons.set(cle, { annee, contenu: brouillon.current });
      }
    };
  }, [cle, annee, abandon]);

  useEffect(() => {
    if (verrouillee) brouillon.current = null;
  }, [verrouillee]);

  return (
    <div data-fiche-modifiee={aEnregistrer ? titreDeLAnnee(annee) : undefined}>
      <FicheAnnuelle
        id={`fiche-${annee}`}
        annee={annee}
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
            <Icon name="error" size={14} className="shrink-0" />
            {echec}
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
            annee={annee}
            jourEvaluation={jourEvaluation}
          />
        ) : (
          // Relue après chaque enregistrement : la fiche telle qu'elle est.
          <EditeurFicheObjectifs
            key={`lecture-${majLe}-${jourEvaluation}`}
            className="pt-4 pb-4"
            contenu={contenu}
            modifiable={false}
            formations={formations}
            catalogue={catalogue}
            statuts={statuts}
            annee={annee}
            jourEvaluation={jourEvaluation}
          />
        )}
      </FicheAnnuelle>
    </div>
  );
}
