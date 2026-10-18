'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bilanDesAtteintes,
  LIBELLES_NOTE,
  LIBELLES_STATUT,
  NOTES_GLOBALES,
  objectifsDeLaFiche,
  STATUTS_OBJECTIF,
  type EvaluationValidee,
  type FicheObjectifs,
  type NoteGlobale,
  type ObjectifDeLaFiche,
  type StatutObjectif,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Skeleton,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  type BadgeTone,
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { CLE_OBJECTIFS } from './objectifs';
import { Echeance } from './objectifs-echeances';

/* ————————————————————————————————————————————————————————————————
   Ce que l'agent fait de ses objectifs, et ce que son n+1 en dit.

   L'agent s'auto-évalue : sous chaque objectif, un statut, atteint,
   partiellement ou non atteint, dont la case prend la couleur ; sans
   commentaire (ADR-0079). L'auto-évaluation part au n+1 quand chaque
   objectif a son statut. Une formation de l'APIX Academy est un objectif
   comme les autres, mais son statut vient de l'Academy, figé à l'envoi.
   Le n+1 lit, marque à son tour chaque objectif, reporte au
   besoin à l'année suivante ce qui n'est pas atteint, commente, donne
   l'appréciation globale et valide. La note se lit toujours avec l'atteinte
   de chaque objectif (ADR-0076).
   ———————————————————————————————————————————————————————————————— */

// ———————————————————————————— l'objectif, lu

function dateCourte(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateLongue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** Le texte d'un objectif, avec sa mise en forme et ses échéances. */
function TexteObjectif({ contenu }: { contenu: Record<string, unknown>[] }) {
  return (
    <>
      {contenu.map((c, i) => {
        if (c.type === 'text') {
          const styles = (c.styles ?? {}) as Record<string, boolean>;
          return (
            <span
              key={i}
              className={cn(
                styles.bold && 'font-bold',
                styles.italic && 'italic',
                styles.underline && 'underline',
                styles.strike && 'line-through',
              )}
            >
              {String(c.text ?? '')}
            </span>
          );
        }
        if (c.type === 'link') {
          return (
            <span key={i} className="underline">
              <TexteObjectif contenu={(c.content as Record<string, unknown>[]) ?? []} />
            </span>
          );
        }
        if (c.type === 'echeance') {
          const date = String((c.props as { date?: string } | undefined)?.date ?? '');
          return date ? (
            <span
              key={i}
              className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 text-[0.9em] leading-4 font-semibold whitespace-nowrap text-primary ring-1 ring-primary/15 ring-inset"
            >
              <Icon name="event" size={13} />
              {dateCourte(date)}
            </span>
          ) : null;
        }
        return null;
      })}
    </>
  );
}

// ———————————————————————————— le statut d'un objectif

/**
 * Chaque statut, sa couleur et son signe : à plein dans la case (comme dans
 * la fiche), en léger sur les badges — un aplat pâle, le texte à la couleur.
 */
const DESSIN_STATUT: Record<
  StatutObjectif,
  { aplat: string; texte: string; leger: string; point: string; signe: IconName }
> = {
  atteint: {
    aplat: 'border-primary bg-primary',
    texte: 'text-primary-ink',
    leger: 'border-primary/30 bg-primary-soft text-primary',
    point: 'bg-primary',
    signe: 'check',
  },
  partiel: {
    aplat: 'border-partiel-line bg-partiel',
    texte: 'text-partiel-ink',
    leger: 'border-partiel-line/35 bg-partiel-soft text-partiel-text',
    point: 'bg-partiel',
    signe: 'remove',
  },
  non_atteint: {
    aplat: 'border-danger bg-danger',
    texte: 'text-primary-ink',
    leger: 'border-danger/25 bg-danger-soft text-danger',
    point: 'bg-danger',
    signe: 'close',
  },
};

/**
 * La case d'un objectif, dessinée comme celles de la fiche, à la couleur de
 * l'auto-évaluation. Elle ne barre pas le texte : ici, on rend compte.
 */
export function Case({ statut }: { statut?: StatutObjectif }) {
  const d = statut ? DESSIN_STATUT[statut] : null;
  return (
    <span
      role="img"
      aria-label={statut ? LIBELLES_STATUT[statut] : 'Sans statut'}
      className={cn(
        'mt-[2px] flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-150',
        d ? cn(d.aplat, d.texte) : 'border-ink-muted/40 bg-surface',
      )}
    >
      {d ? <Icon name={d.signe} size={13} weight={600} /> : null}
    </span>
  );
}

/** Le badge d'un statut : le bleu d'atteint, l'orange de partiel, le rouge de non atteint. */
const BADGE_STATUT: Record<StatutObjectif, BadgeTone> = {
  atteint: 'bleu',
  partiel: 'orange',
  non_atteint: 'rouge',
};

/** Le statut, en toutes lettres : un badge à sa couleur. */
function PastilleStatut({ statut }: { statut: StatutObjectif }) {
  return (
    <Badge tone={BADGE_STATUT[statut]} size="sm" className="normal-case">
      <Icon name={DESSIN_STATUT[statut].signe} size={11} weight={600} />
      {LIBELLES_STATUT[statut]}
    </Badge>
  );
}

/** Atteint, Partiellement, Non atteint : le choix de l'agent, ou celui du n+1, sous l'objectif. */
function ChoixStatut({
  objectif,
  valeur,
  onChange,
  intitule = 'Statut',
}: {
  objectif: string;
  valeur?: StatutObjectif;
  onChange: (s: StatutObjectif | null) => void;
  intitule?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${intitule} : ${objectif}`}
      className="flex flex-wrap items-center gap-1.5 max-sm:gap-1"
    >
      {STATUTS_OBJECTIF.map((s) => {
        const choisi = valeur === s;
        const d = DESSIN_STATUT[s];
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={choisi}
            // Le reprendre retire le choix : rien n'oblige à trancher tout de suite.
            onClick={() => onChange(choisi ? null : s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-controle-sm border py-[5px] pr-3 pl-2 text-[11.5px] font-semibold transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/35 max-sm:gap-1 max-sm:pr-2.5 max-sm:pl-1.5 max-sm:text-[11px]',
              choisi
                ? d.leger
                : 'border-line bg-surface text-ink hover:border-ink-muted/50 hover:bg-hover',
            )}
          >
            {choisi ? (
              <Icon name={d.signe} size={14} weight={600} />
            ) : (
              <span aria-hidden className={cn('mx-[3px] size-2 rounded-full', d.point)} />
            )}
            {LIBELLES_STATUT[s]}
          </button>
        );
      })}
    </div>
  );
}

// ———————————————————————————— l'objectif, commenté

/**
 * Ce qu'une personne a dit d'un objectif : son nom, le statut choisi, son
 * texte ; et, pour le n+1, l'année où l'objectif est reporté.
 */
function Propos({
  qui,
  texte,
  ton = 'neutre',
  statut,
  reporteA,
}: {
  qui: string;
  texte?: string;
  ton?: 'neutre' | 'n1';
  statut?: StatutObjectif;
  reporteA?: number;
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] px-3 py-2',
        ton === 'n1' ? 'bg-primary-soft/70' : 'bg-line-soft/70',
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10.5px] font-bold tracking-[0.06em] uppercase',
          ton === 'n1' ? 'text-primary' : 'text-ink-muted',
        )}
      >
        {qui}
        {statut || reporteA ? (
          <span className="flex flex-wrap items-center gap-1">
            {statut ? <PastilleStatut statut={statut} /> : null}
            {reporteA ? <Reporte annee={reporteA} /> : null}
          </span>
        ) : null}
      </div>
      {texte?.trim() ? (
        <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink">{texte}</p>
      ) : null}
    </div>
  );
}

/** Un objectif reporté à l'année suivante. */
function Reporte({ annee }: { annee: number }) {
  return (
    <Badge tone="gris" size="sm" className="normal-case">
      <Icon name="arrow_forward" size={11} weight={600} />
      Reporté à {annee}
    </Badge>
  );
}

/** « 3 atteints », « 1 partiellement atteint », « 2 non atteints ». */
const COMPTE: Record<StatutObjectif, (n: number) => string> = {
  atteint: (n) => `${n} atteint${n > 1 ? 's' : ''}`,
  partiel: (n) => `${n} partiellement atteint${n > 1 ? 's' : ''}`,
  non_atteint: (n) => `${n} non atteint${n > 1 ? 's' : ''}`,
};

/**
 * L'atteinte des objectifs, en nombres, à la couleur de chaque statut : la
 * note se lit avec elle.
 */
export function BilanAtteinte({
  atteintes,
  className,
}: {
  atteintes: readonly (StatutObjectif | null | undefined)[];
  className?: string;
}) {
  const bilan = bilanDesAtteintes(atteintes);
  return (
    <ul aria-label="Atteinte des objectifs" className={cn('flex flex-wrap gap-1.5', className)}>
      {STATUTS_OBJECTIF.filter((s) => bilan[s] > 0).map((s) => (
        <li
          key={s}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border py-[3px] pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap',
            DESSIN_STATUT[s].leger,
          )}
        >
          <Icon name={DESSIN_STATUT[s].signe} size={13} weight={600} />
          {COMPTE[s](bilan[s])}
        </li>
      ))}
    </ul>
  );
}

/** Une ligne d'objectif : la case, le texte et l'échéance, puis ce qui s'en dit dessous. */
function LigneObjectif({
  objectif,
  statut,
  annee,
  children,
}: {
  objectif: ObjectifDeLaFiche;
  statut?: StatutObjectif;
  /** L'année de la fiche : une échéance d'une autre année la dit. */
  annee: number;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-1">
      <div className="flex items-start gap-[11px]">
        <Case statut={statut} />
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-ink-strong">
          <TexteObjectif contenu={objectif.contenu} />
        </p>
        {objectif.echeance ? <Echeance date={objectif.echeance} annee={annee} /> : null}
      </div>
      {children ? <div className="flex flex-col gap-2 pl-[27px]">{children}</div> : null}
    </li>
  );
}

// ———————————————————————————— la note

/** Chaque note a sa couleur, du vert (A) au rouge (D) : un aplat pâle, un texte soutenu. */
const COULEUR_NOTE: Record<NoteGlobale, { fond: string; texte: string; filet: string }> = {
  A: { fond: 'bg-success-soft', texte: 'text-success', filet: 'border-success/40' },
  B: { fond: 'bg-note-b-soft', texte: 'text-note-b', filet: 'border-note-b/40' },
  C: { fond: 'bg-partiel-soft', texte: 'text-partiel-text', filet: 'border-partiel-line/45' },
  D: { fond: 'bg-danger-soft', texte: 'text-danger', filet: 'border-danger/35' },
};

/** La lettre d'une note, dans sa pastille de couleur. */
function LettreNote({ note, grande = false }: { note: NoteGlobale; grande?: boolean }) {
  const c = COULEUR_NOTE[note];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-extrabold ring-1 ring-current/20 ring-inset',
        grande ? 'size-9 text-[16px]' : 'size-6 text-[12px]',
        c.fond,
        c.texte,
      )}
    >
      {note}
    </span>
  );
}

function ChoixNote({
  valeur,
  onChange,
}: {
  valeur: NoteGlobale | null;
  onChange: (n: NoteGlobale) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Appréciation globale"
      className="grid grid-cols-2 gap-2 lg:grid-cols-4"
    >
      {NOTES_GLOBALES.map((n) => {
        const choisie = valeur === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={choisie}
            onClick={() => onChange(n)}
            className={cn(
              'flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition-all duration-150',
              choisie
                ? cn(COULEUR_NOTE[n].filet, COULEUR_NOTE[n].fond)
                : 'border-line hover:border-ink-muted/40 hover:bg-hover',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold transition-colors duration-150',
                choisie
                  ? cn('bg-surface ring-1 ring-current/25', COULEUR_NOTE[n].texte)
                  : 'bg-line-soft text-ink-strong',
              )}
            >
              {n}
            </span>
            <span
              className={cn(
                'text-[12px] leading-tight font-semibold',
                choisie ? COULEUR_NOTE[n].texte : 'text-ink',
              )}
            >
              {LIBELLES_NOTE[n]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NoteDonnee({ note }: { note: NoteGlobale }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LettreNote note={note} grande />
      <span className="text-[13px] font-semibold text-ink-strong">{LIBELLES_NOTE[note]}</span>
    </span>
  );
}

function Intitule({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
      {children}
    </h4>
  );
}

// ———————————————————————————— outils

/**
 * Une zone de commentaire qui grandit avec ce qu'on y écrit — on relit tout
 * son texte sans faire défiler une petite boîte.
 */
function ZoneCommentaire({ className, ...props }: ComponentProps<typeof Textarea>) {
  const cadre = useRef<HTMLDivElement>(null);
  const ajuster = useCallback(() => {
    const zone = cadre.current?.querySelector('textarea');
    if (!zone) return;
    zone.style.height = 'auto';
    // La hauteur du texte, plus les deux filets du cadre.
    zone.style.height = `${zone.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(ajuster, [props.value, ajuster]);
  // Plus étroite, la zone remet ses lignes à la ligne : elle se remesure.
  useEffect(() => {
    window.addEventListener('resize', ajuster);
    return () => window.removeEventListener('resize', ajuster);
  }, [ajuster]);
  return (
    <div ref={cadre}>
      <Textarea
        rows={2}
        className={cn('min-h-[54px] resize-none overflow-hidden text-[12.5px]', className)}
        {...props}
      />
    </div>
  );
}

/** Enregistrer puis, peut-être, envoyer : l'état d'un brouillon qu'on garde à la main. */
function useBrouillon<T>(depart: T) {
  const [valeur, setValeur] = useState(depart);
  const [modifie, setModifie] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  // Quitter avec un brouillon non enregistré : le navigateur le rappelle.
  useEffect(() => {
    if (!modifie) return;
    const avant = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avant);
    return () => window.removeEventListener('beforeunload', avant);
  }, [modifie]);
  useEffect(() => {
    if (!enregistre) return;
    const t = setTimeout(() => setEnregistre(false), 2200);
    return () => clearTimeout(t);
  }, [enregistre]);
  const changer = useCallback((v: T) => {
    setValeur(v);
    setModifie(true);
    setEnregistre(false);
  }, []);
  return { valeur, changer, modifie, setModifie, enregistre, setEnregistre };
}

function useAction() {
  const [enCours, setEnCours] = useState<null | 'enregistrer' | 'envoyer'>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const lancer = useCallback(
    async (quoi: 'enregistrer' | 'envoyer', geste: () => Promise<unknown>) => {
      setEnCours(quoi);
      setErreur(null);
      try {
        await geste();
        return true;
      } catch (e) {
        setErreur(e instanceof ApiError ? e.message : 'Action impossible, réessayez.');
        return false;
      } finally {
        setEnCours(null);
      }
    },
    [],
  );
  return { enCours, erreur, setErreur, lancer };
}

function Confirmation({
  ouverte,
  titre,
  action,
  enCours,
  erreur,
  onConfirmer,
  onFermer,
  children,
}: {
  ouverte: boolean;
  titre: string;
  action: string;
  enCours: boolean;
  erreur: string | null;
  onConfirmer: () => void;
  onFermer: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open={ouverte}
      onClose={onFermer}
      title={titre}
      maxWidth="max-w-md"
      footer={
        <>
          {erreur ? (
            <p role="alert" className="min-w-0 flex-1 text-[12px] font-semibold text-danger">
              {erreur}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onFermer}>
            Annuler
          </Button>
          <Button loading={enCours} onClick={onConfirmer}>
            {action}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink">{children}</p>
    </Modal>
  );
}

function BoutonEnregistrer({
  modifie,
  enregistre,
  enCours,
  onClick,
}: {
  modifie: boolean;
  enregistre: boolean;
  enCours: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={!modifie} loading={enCours} onClick={onClick}>
      {enregistre && !modifie ? (
        <>
          <Icon name="check" size={15} className="text-success" />
          Enregistré
        </>
      ) : (
        'Enregistrer'
      )}
    </Button>
  );
}

// ———————————————————————————— le bouton « Auto-évaluation »

/**
 * En bas à droite de la fiche : le passage à l'auto-évaluation — et, d'un
 * coup d'œil, où elle en est.
 */
export function BoutonAutoEvaluation({
  fiche,
  actif,
  onClick,
}: {
  fiche: FicheObjectifs;
  actif: boolean;
  onClick: () => void;
}) {
  const ev = fiche.evaluation;
  // Ce que l'agent évalue lui-même : les cases. Une formation a son statut.
  const cases = objectifsDeLaFiche(fiche.contenu).filter((o) => !o.formation);
  const faits = cases.filter((o) => fiche.statuts[o.id]).length;
  const etat = ev.valideeLe
    ? `Évaluation · ${ev.note}`
    : ev.envoyesLe
      ? 'Auto-évaluation envoyée'
      : faits > 0
        ? `Auto-évaluation · ${faits}/${cases.length}`
        : 'Auto-évaluation';
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-controle-sm border px-3 py-[6px] text-[11.5px] font-semibold transition-colors duration-150',
        actif
          ? 'border-primary bg-primary text-primary-ink'
          : ev.valideeLe || ev.envoyesLe
            ? 'border-success/30 bg-success-soft text-success hover:border-success/50'
            : 'border-line bg-surface text-ink hover:border-primary/40 hover:text-primary',
      )}
    >
      <Icon name={ev.envoyesLe && !actif ? 'check_circle' : 'checklist'} size={15} />
      {etat}
    </button>
  );
}

// ———————————————————————————— côté agent

/**
 * L'auto-évaluation de l'agent, sous chacun de ses objectifs : son statut,
 * qui se voit aussitôt, sans commentaire (ADR-0079), puis l'envoi ; et, une
 * fois l'évaluation validée, ce qu'en dit son n+1.
 */
export function AutoEvaluationAgent({
  fiche,
  statuts,
  onStatuer,
  erreurStatut,
  bascule,
}: {
  fiche: FicheObjectifs;
  /** Les statuts tels que l'agent vient de les choisir — avant même la réponse du serveur. */
  statuts: Record<string, StatutObjectif>;
  onStatuer: (id: string, statut: StatutObjectif | null) => void;
  erreurStatut: string | null;
  /** Le bouton « Auto-évaluation », rangé au bout de la barre d'actions. */
  bascule: ReactNode;
}) {
  const queryClient = useQueryClient();
  const ev = fiche.evaluation;
  const envoyes = Boolean(ev.envoyesLe);
  const objectifs = useMemo(() => objectifsDeLaFiche(fiche.contenu), [fiche.contenu]);
  const action = useAction();
  const [confirmer, setConfirmer] = useState(false);
  const cle = [...CLE_OBJECTIFS, 'moi'];

  // Une formation a le statut que lui donne l'Academy : chaque autre
  // objectif attend le sien.
  const incomplet = objectifs.some((o) => !o.formation && !statuts[o.id]);
  const erreur = action.erreur ?? erreurStatut;

  const envoyer = async () => {
    const ok = await action.lancer('envoyer', async () => {
      await api(`/objectifs/moi/fiches/${fiche.annee}/commentaires/envoi`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: cle });
    });
    if (ok) setConfirmer(false);
  };

  // Validée, l'atteinte que retient le n+1 colore les cases ; celle d'une
  // formation vient de l'Academy.
  const atteinteN1 = (o: ObjectifDeLaFiche) => (o.formation ? statuts[o.id] : ev.atteintesN1[o.id]);

  return (
    <div className="flex flex-col gap-5 px-5 pt-3 pb-4">
      <ol className="flex flex-col divide-y divide-line-soft">
        {objectifs.map((o) => (
          <LigneObjectif
            key={o.id}
            objectif={o}
            statut={(ev.valideeLe ? atteinteN1(o) : undefined) ?? statuts[o.id]}
            annee={fiche.annee}
          >
            {envoyes ? (
              <>
                {/* Ce que l'agent en a dit : le statut ; le commentaire d'une
                    auto-évaluation d'avant l'ADR-0079, s'il y en a un. */}
                {(!o.formation && statuts[o.id]) || ev.commentairesAgent[o.id]?.trim() ? (
                  <Propos qui="Vous" texte={ev.commentairesAgent[o.id]} statut={statuts[o.id]} />
                ) : null}
                {ev.valideeLe &&
                (ev.atteintesN1[o.id] ||
                  ev.commentairesN1[o.id]?.trim() ||
                  ev.reportes.includes(o.id)) ? (
                  <Propos
                    qui={ev.evaluateur ?? 'Votre N+1'}
                    texte={ev.commentairesN1[o.id]}
                    ton="n1"
                    statut={atteinteN1(o)}
                    reporteA={ev.reportes.includes(o.id) ? fiche.annee + 1 : undefined}
                  />
                ) : null}
              </>
            ) : (
              <>
                {fiche.statutsCaducs.includes(o.id) && !statuts[o.id] ? (
                  // Réécrit par le n+1 depuis le statut donné : il attend un
                  // nouveau statut.
                  <Badge tone="orange" className="self-start">
                    Modifié par votre N+1
                  </Badge>
                ) : null}
                {/* Une formation : sa case dit le statut que lui donne
                    l'Academy, rien à choisir. */}
                {o.formation ? null : (
                  <ChoixStatut
                    objectif={o.texte}
                    valeur={statuts[o.id]}
                    onChange={(statut) => onStatuer(o.id, statut)}
                  />
                )}
              </>
            )}
          </LigneObjectif>
        ))}
      </ol>

      {ev.valideeLe && ev.note ? (
        <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
          <Intitule>Appréciation de votre N+1</Intitule>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NoteDonnee note={ev.note} />
            {objectifs.every((o) => atteinteN1(o)) ? (
              <BilanAtteinte atteintes={objectifs.map(atteinteN1)} />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {erreur && !confirmer ? (
          <p role="alert" className="mr-auto text-[12px] font-semibold text-danger">
            {erreur}
          </p>
        ) : envoyes ? (
          <p className="mr-auto text-[11.5px] text-ink-muted">
            {ev.valideeLe
              ? `Évaluation validée le ${dateLongue(ev.valideeLe)}${ev.evaluateur ? ` par ${ev.evaluateur}` : ''}`
              : `Envoyée le ${dateLongue(ev.envoyesLe!)}`}
          </p>
        ) : null}
        {envoyes ? null : (
          <Button
            size="sm"
            disabled={incomplet || objectifs.length === 0}
            onClick={() => setConfirmer(true)}
          >
            Envoyer à mon N+1
          </Button>
        )}
        {bascule}
      </div>

      <Confirmation
        ouverte={confirmer}
        titre="Envoyer votre auto-évaluation"
        action="Envoyer"
        enCours={action.enCours === 'envoyer'}
        erreur={action.erreur}
        onFermer={() => {
          setConfirmer(false);
          action.setErreur(null);
        }}
        onConfirmer={() => void envoyer()}
      >
        Une fois envoyée, votre manager procédera à l’évaluation en fonction des objectifs fixés.
        Vous ne serez plus en mesure de modifier votre auto-évaluation après soumission.
      </Confirmation>
    </div>
  );
}

// ———————————————————————————— côté n+1

/**
 * L'évaluation de l'année, vue par le n+1 : chaque objectif, ce qu'en dit
 * l'agent, puis son atteinte aux yeux du n+1 (ADR-0076), le report à
 * l'année suivante de ce qui n'est pas atteint, son commentaire ; enfin
 * l'appréciation globale, qui se lit avec l'atteinte de chaque objectif.
 */
export function EvaluationAnnuelle({
  employeeId,
  prenom,
  fiche,
  reportable = true,
}: {
  employeeId: string;
  prenom: string;
  fiche: FicheObjectifs;
  /** Un agent parti n'a pas d'année suivante où reporter. */
  reportable?: boolean;
}) {
  const queryClient = useQueryClient();
  const ev = fiche.evaluation;
  const objectifs = useMemo(() => objectifsDeLaFiche(fiche.contenu), [fiche.contenu]);
  const brouillon = useBrouillon<{
    commentaires: Record<string, string>;
    atteintes: Record<string, StatutObjectif>;
    reportes: string[];
    note: NoteGlobale | null;
  }>({
    commentaires: ev.commentairesN1,
    atteintes: ev.atteintesN1,
    reportes: ev.reportes,
    note: ev.note,
  });
  const action = useAction();
  const [confirmer, setConfirmer] = useState(false);
  const base = `/objectifs/equipe/${employeeId}/fiches/${fiche.annee}/evaluation`;
  const cle = [...CLE_OBJECTIFS, 'equipe', employeeId];
  const envoyes = Boolean(ev.envoyesLe);
  const validee = Boolean(ev.valideeLe);
  const suivante = fiche.annee + 1;
  // L'atteinte d'une case est celle que le n+1 lui donne ; d'une formation,
  // celle de l'Academy.
  const atteintes = validee ? ev.atteintesN1 : brouillon.valeur.atteintes;
  const reportes = validee ? ev.reportes : brouillon.valeur.reportes;
  const atteinte = (o: ObjectifDeLaFiche) => (o.formation ? fiche.statuts[o.id] : atteintes[o.id]);
  const aMarquer = objectifs.filter((o) => !o.formation && !atteintes[o.id]).length;

  const marquer = (id: string, s: StatutObjectif | null) => {
    const suite = { ...brouillon.valeur.atteintes };
    if (s) suite[id] = s;
    else delete suite[id];
    // Atteint, ou sans atteinte : l'objectif ne se reporte plus.
    const garde = s && s !== 'atteint';
    brouillon.changer({
      ...brouillon.valeur,
      atteintes: suite,
      reportes: garde
        ? brouillon.valeur.reportes
        : brouillon.valeur.reportes.filter((r) => r !== id),
    });
  };
  const reporter = (id: string, oui: boolean) =>
    brouillon.changer({
      ...brouillon.valeur,
      reportes: oui
        ? [...brouillon.valeur.reportes.filter((r) => r !== id), id]
        : brouillon.valeur.reportes.filter((r) => r !== id),
    });

  const enregistrer = () =>
    action.lancer('enregistrer', async () => {
      await api(base, { method: 'PUT', body: brouillon.valeur });
      brouillon.setModifie(false);
      brouillon.setEnregistre(true);
      await queryClient.invalidateQueries({ queryKey: cle });
    });

  const valider = async () => {
    const ok = await action.lancer('envoyer', async () => {
      if (brouillon.modifie) {
        await api(base, { method: 'PUT', body: brouillon.valeur });
        brouillon.setModifie(false);
      }
      await api(`${base}/validation`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: cle });
      // Validée, elle entre au dossier de l'agent.
      void queryClient.invalidateQueries({ queryKey: [...CLE_OBJECTIFS, 'dossier', employeeId] });
    });
    if (ok) setConfirmer(false);
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-3 pb-4">
      <ol className="flex flex-col divide-y divide-line-soft">
        {objectifs.map((o) => {
          const a = atteinte(o);
          return (
            <LigneObjectif
              key={o.id}
              objectif={o}
              statut={(validee ? a : undefined) ?? fiche.statuts[o.id]}
              annee={fiche.annee}
            >
              {envoyes &&
              ((!o.formation && fiche.statuts[o.id]) || ev.commentairesAgent[o.id]?.trim()) ? (
                <Propos
                  qui={prenom}
                  texte={ev.commentairesAgent[o.id]}
                  statut={fiche.statuts[o.id]}
                />
              ) : null}
              {envoyes && !validee ? (
                <>
                  {o.formation ? null : (
                    <ChoixStatut
                      objectif={o.texte}
                      intitule="Atteinte"
                      valeur={atteintes[o.id]}
                      onChange={(s) => marquer(o.id, s)}
                    />
                  )}
                  {reportable && a && a !== 'atteint' ? (
                    <label className="inline-flex cursor-pointer items-center gap-2 self-start text-[12px] font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={reportes.includes(o.id)}
                        onChange={(e) => reporter(o.id, e.target.checked)}
                        className="size-4 accent-primary"
                      />
                      Reporter à {suivante}
                    </label>
                  ) : null}
                  {o.formation ? null : (
                    <ZoneCommentaire
                      aria-label={`Votre commentaire : ${o.texte}`}
                      placeholder="Votre commentaire"
                      value={brouillon.valeur.commentaires[o.id] ?? ''}
                      onChange={(e) =>
                        brouillon.changer({
                          ...brouillon.valeur,
                          commentaires: {
                            ...brouillon.valeur.commentaires,
                            [o.id]: e.target.value,
                          },
                        })
                      }
                    />
                  )}
                </>
              ) : null}
              {validee &&
              (ev.atteintesN1[o.id] ||
                ev.commentairesN1[o.id]?.trim() ||
                reportes.includes(o.id)) ? (
                <Propos
                  qui="Vous"
                  texte={ev.commentairesN1[o.id]}
                  ton="n1"
                  statut={a}
                  reporteA={reportes.includes(o.id) ? suivante : undefined}
                />
              ) : null}
            </LigneObjectif>
          );
        })}
      </ol>

      {!envoyes ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <Icon name="schedule" size={15} />
          {prenom} n’a pas encore envoyé son auto-évaluation.
        </p>
      ) : validee ? (
        <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
          <Intitule>Votre appréciation</Intitule>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NoteDonnee note={ev.note!} />
            {objectifs.every((o) => atteinte(o)) ? (
              <BilanAtteinte atteintes={objectifs.map(atteinte)} />
            ) : null}
          </div>
          <span className="text-[11.5px] text-ink-muted">
            Validée le {dateLongue(ev.valideeLe!)}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Intitule>Appréciation globale</Intitule>
              <BilanAtteinte atteintes={objectifs.map(atteinte)} />
            </div>
            <ChoixNote
              valeur={brouillon.valeur.note}
              onChange={(note) => brouillon.changer({ ...brouillon.valeur, note })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {action.erreur && !confirmer ? (
              <p role="alert" className="mr-auto text-[12px] font-semibold text-danger">
                {action.erreur}
              </p>
            ) : null}
            <BoutonEnregistrer
              modifie={brouillon.modifie}
              enregistre={brouillon.enregistre}
              enCours={action.enCours === 'enregistrer'}
              onClick={() => void enregistrer()}
            />
            <Button
              size="sm"
              disabled={!brouillon.valeur.note || aMarquer > 0}
              onClick={() => setConfirmer(true)}
            >
              <Icon name="task_alt" size={15} />
              Valider l’évaluation
            </Button>
          </div>
        </>
      )}

      <Confirmation
        ouverte={confirmer}
        titre="Valider l’évaluation"
        action="Valider"
        enCours={action.enCours === 'envoyer'}
        erreur={action.erreur}
        onFermer={() => {
          setConfirmer(false);
          action.setErreur(null);
        }}
        onConfirmer={() => void valider()}
      >
        Votre évaluation et vos observations seront transmises à la DCH et à {prenom}. Vous ne serez
        plus en mesure de les modifier.
      </Confirmation>
    </div>
  );
}

// ———————————————————————————— dans le dossier de l'agent

/**
 * La section « Évaluation » du dossier, année par année : l'année en cours
 * d'abord, les précédentes d'une flèche. L'évaluation de l'année, dès que le
 * n+1 la valide, avec qui l'a évaluée, la note et son appréciation ; et
 * dessous les résultats obtenus, pour que la note ne se lise jamais seule
 * (ADR-0077).
 */
export function CarteEvaluationsAgent({ employeeId }: { employeeId: string }) {
  const evaluations = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'dossier', employeeId],
    queryFn: () => api<EvaluationValidee[]>(`/objectifs/dossiers/${employeeId}/evaluations`),
  });
  const courante = new Date().getFullYear();
  const [annee, setAnnee] = useState(courante);
  const toutes = evaluations.data ?? [];
  // On remonte jusqu'à la première année évaluée ; on ne va pas au-delà de l'année en cours.
  const premiere = Math.min(courante, ...toutes.map((e) => e.annee));
  const liste = toutes.filter((e) => e.annee === annee);
  const fleche =
    'flex size-6 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-primary disabled:pointer-events-none disabled:opacity-30';
  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <CardTitle>Évaluation</CardTitle>
        <div className="flex items-center" role="group" aria-label="Année">
          <button
            type="button"
            aria-label="Année précédente"
            disabled={annee <= premiere}
            onClick={() => setAnnee((a) => a - 1)}
            className={fleche}
          >
            <Icon name="chevron_left" size={18} />
          </button>
          <span
            aria-live="polite"
            className="min-w-[38px] text-center text-[10.5px] font-extrabold tracking-[0.14em] text-primary tabular-nums"
          >
            {annee}
          </span>
          <button
            type="button"
            aria-label="Année suivante"
            disabled={annee >= courante}
            onClick={() => setAnnee((a) => a + 1)}
            className={fleche}
          >
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
      </CardHeader>
      {evaluations.isPending ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : liste.length === 0 ? (
        <CardContent>
          <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune évaluation validée en {annee}.
          </p>
        </CardContent>
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                {/* Sur un petit écran, l'année se lit dans l'en-tête : sa colonne
                    laisse la place à l'appréciation. */}
                <Th className="max-sm:hidden">Année</Th>
                <Th>Manager</Th>
                <Th>Note</Th>
                <Th>Appréciation</Th>
              </tr>
            </THead>
            <TBody>
              {liste.map((e) => (
                <Tr key={e.annee}>
                  <Td className="font-medium text-ink-strong tabular-nums max-sm:hidden">
                    {e.annee}
                  </Td>
                  <Td>{e.manager}</Td>
                  <Td>
                    <LettreNote note={e.note} />
                  </Td>
                  <Td className={cn('font-semibold', COULEUR_NOTE[e.note].texte)}>
                    {LIBELLES_NOTE[e.note]}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {liste.map((e) =>
            e.objectifs.length ? <ResultatsObtenus key={e.annee} evaluation={e} /> : null,
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Les résultats de l'année évaluée (ADR-0077) : chaque objectif, sa case à la
 * couleur et au signe du résultat obtenu.
 */
function ResultatsObtenus({ evaluation: e }: { evaluation: EvaluationValidee }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft px-5 pt-4 pb-5">
      <Intitule>Résultats obtenus</Intitule>
      <ul className="flex flex-col gap-2.5">
        {e.objectifs.map((o) => (
          <li key={o.id} className="flex items-start gap-[11px]">
            <Case statut={o.atteinte ?? undefined} />
            <p className="min-w-0 flex-1 text-[12.5px] leading-[1.5] break-words text-ink-strong">
              {o.texte}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
