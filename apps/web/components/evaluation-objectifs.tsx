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
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { CLE_OBJECTIFS } from './objectifs';

/* ————————————————————————————————————————————————————————————————
   Ce que l'agent fait de ses objectifs, et ce que son n+1 en dit.

   L'agent s'auto-évalue : sous chaque objectif, il dit où il en est —
   atteint, partiellement, non atteint ; la case en prend la couleur — et ce
   qu'il a fait, ce qui manque et pourquoi. Il enregistre autant de fois qu'il
   veut et envoie à son n+1 quand chaque objectif a son statut et son
   commentaire. Le n+1 lit, commente à son tour sous chaque objectif, donne
   l'appréciation globale et valide.
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
function Case({ statut }: { statut?: StatutObjectif }) {
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

/** Le statut, en toutes lettres : une pastille à sa couleur. */
function PastilleStatut({ statut }: { statut: StatutObjectif }) {
  const d = DESSIN_STATUT[statut];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10.5px] font-bold tracking-normal normal-case',
        d.leger,
      )}
    >
      <Icon name={d.signe} size={12} weight={600} />
      {LIBELLES_STATUT[statut]}
    </span>
  );
}

/** Atteint, Partiellement, Non atteint : le choix de l'agent, sous l'objectif. */
function ChoixStatut({
  objectif,
  valeur,
  onChange,
}: {
  objectif: string;
  valeur?: StatutObjectif;
  onChange: (s: StatutObjectif | null) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Statut — ${objectif}`}
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
              'inline-flex items-center gap-1.5 rounded-full border py-[5px] pr-3 pl-2 text-[11.5px] font-semibold transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/35 max-sm:gap-1 max-sm:pr-2.5 max-sm:pl-1.5 max-sm:text-[11px]',
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

/** Ce qu'une personne a écrit d'un objectif : son nom, son texte — et le statut qu'elle a donné. */
function Propos({
  qui,
  texte,
  ton = 'neutre',
  statut,
}: {
  qui: string;
  texte: string;
  ton?: 'neutre' | 'n1';
  statut?: StatutObjectif;
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] px-3 py-2',
        ton === 'n1' ? 'bg-primary-soft/70' : 'bg-line-soft/70',
      )}
    >
      <p
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10.5px] font-bold tracking-[0.06em] uppercase',
          ton === 'n1' ? 'text-primary' : 'text-ink-muted',
        )}
      >
        {qui}
        {statut ? <PastilleStatut statut={statut} /> : null}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink">{texte}</p>
    </div>
  );
}

/** Une ligne d'objectif : la case, le texte, puis ce qui s'en dit dessous. */
function LigneObjectif({
  objectif,
  statut,
  children,
}: {
  objectif: ObjectifDeLaFiche;
  statut?: StatutObjectif;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-1">
      <div className="flex items-start gap-[11px]">
        <Case statut={statut} />
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-ink-strong">
          <TexteObjectif contenu={objectif.contenu} />
        </p>
      </div>
      {children ? <div className="flex flex-col gap-2 pl-[27px]">{children}</div> : null}
    </li>
  );
}

// ———————————————————————————— la note

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
                ? 'border-primary bg-primary-soft shadow-[0_0_0_3px_rgb(0_79_145/0.08)]'
                : 'border-line hover:border-primary/40 hover:bg-hover',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold transition-colors duration-150',
                choisie ? 'bg-primary text-primary-ink' : 'bg-line-soft text-ink-strong',
              )}
            >
              {n}
            </span>
            <span
              className={cn(
                'text-[12px] leading-tight font-semibold',
                choisie ? 'text-primary' : 'text-ink',
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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[16px] font-extrabold text-primary-ink">
        {note}
      </span>
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
        setErreur(e instanceof ApiError ? e.message : 'Action impossible — réessayez.');
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

/** Les objectifs que l'agent a entièrement auto-évalués : un statut et un commentaire. */
function evalues(
  objectifs: ObjectifDeLaFiche[],
  statuts: Record<string, StatutObjectif>,
  commentaires: Record<string, string>,
): number {
  return objectifs.filter((o) => statuts[o.id] && commentaires[o.id]?.trim()).length;
}

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
  const objectifs = objectifsDeLaFiche(fiche.contenu);
  const faits = evalues(objectifs, fiche.statuts, ev.commentairesAgent);
  const etat = ev.valideeLe
    ? `Évaluation · ${ev.note}`
    : ev.envoyesLe
      ? 'Auto-évaluation envoyée'
      : faits > 0
        ? `Auto-évaluation · ${faits}/${objectifs.length}`
        : 'Auto-évaluation';
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-[6px] text-[11.5px] font-semibold transition-colors duration-150',
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
 * L'auto-évaluation de l'agent, sous chacun de ses objectifs — son statut,
 * qui se voit aussitôt, et son commentaire, à enregistrer puis à envoyer ; et,
 * une fois l'évaluation validée, ce qu'en dit son n+1.
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
  const brouillon = useBrouillon<Record<string, string>>(ev.commentairesAgent);
  const action = useAction();
  const [confirmer, setConfirmer] = useState(false);
  const base = `/objectifs/moi/fiches/${fiche.annee}/${fiche.semestre}/commentaires`;
  const cle = [...CLE_OBJECTIFS, 'moi'];

  const sansStatut = objectifs.filter((o) => !statuts[o.id]).length;
  const sansCommentaire = objectifs.filter((o) => !brouillon.valeur[o.id]?.trim()).length;
  const reste = [
    sansStatut ? `${sansStatut} statut${sansStatut > 1 ? 's' : ''} à choisir` : null,
    sansCommentaire
      ? `${sansCommentaire} commentaire${sansCommentaire > 1 ? 's' : ''} à écrire`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const erreur = action.erreur ?? erreurStatut;

  const enregistrer = () =>
    action.lancer('enregistrer', async () => {
      await api(base, { method: 'PUT', body: { commentaires: brouillon.valeur } });
      brouillon.setModifie(false);
      brouillon.setEnregistre(true);
      await queryClient.invalidateQueries({ queryKey: cle });
    });

  const envoyer = async () => {
    const ok = await action.lancer('envoyer', async () => {
      if (brouillon.modifie) {
        await api(base, { method: 'PUT', body: { commentaires: brouillon.valeur } });
        brouillon.setModifie(false);
      }
      await api(`${base}/envoi`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: cle });
    });
    if (ok) setConfirmer(false);
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-3 pb-4">
      <ol className="flex flex-col divide-y divide-line-soft">
        {objectifs.map((o) => (
          <LigneObjectif key={o.id} objectif={o} statut={statuts[o.id]}>
            {envoyes ? (
              <>
                {ev.commentairesAgent[o.id] ? (
                  <Propos qui="Vous" texte={ev.commentairesAgent[o.id]!} statut={statuts[o.id]} />
                ) : null}
                {ev.valideeLe && ev.commentairesN1[o.id]?.trim() ? (
                  <Propos
                    qui={ev.evaluateur ?? 'Votre N+1'}
                    texte={ev.commentairesN1[o.id]!}
                    ton="n1"
                  />
                ) : null}
              </>
            ) : (
              <>
                <ChoixStatut
                  objectif={o.texte}
                  valeur={statuts[o.id]}
                  onChange={(statut) => onStatuer(o.id, statut)}
                />
                <ZoneCommentaire
                  aria-label={`Commentaire — ${o.texte}`}
                  placeholder="Ce que vous avez fait, ce qui reste…"
                  value={brouillon.valeur[o.id] ?? ''}
                  onChange={(e) =>
                    brouillon.changer({ ...brouillon.valeur, [o.id]: e.target.value })
                  }
                />
              </>
            )}
          </LigneObjectif>
        ))}
      </ol>

      {ev.valideeLe && ev.note ? (
        <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
          <Intitule>Appréciation de votre N+1</Intitule>
          <NoteDonnee note={ev.note} />
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
        ) : reste ? (
          <p className="mr-auto text-[11.5px] text-ink-muted">{reste}</p>
        ) : null}
        {envoyes ? null : (
          <>
            <BoutonEnregistrer
              modifie={brouillon.modifie}
              enregistre={brouillon.enregistre}
              enCours={action.enCours === 'enregistrer'}
              onClick={() => void enregistrer()}
            />
            <Button size="sm" disabled={Boolean(reste)} onClick={() => setConfirmer(true)}>
              Envoyer à mon N+1
            </Button>
          </>
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
 * L'évaluation d'un semestre, vue par le n+1 : chaque objectif, à la couleur
 * du statut que l'agent lui donne, ce qu'en dit l'agent, et dessous son propre
 * commentaire ; puis l'appréciation globale.
 */
export function EvaluationSemestre({
  employeeId,
  prenom,
  fiche,
}: {
  employeeId: string;
  prenom: string;
  fiche: FicheObjectifs;
}) {
  const queryClient = useQueryClient();
  const ev = fiche.evaluation;
  const objectifs = useMemo(() => objectifsDeLaFiche(fiche.contenu), [fiche.contenu]);
  const brouillon = useBrouillon<{
    commentaires: Record<string, string>;
    note: NoteGlobale | null;
  }>({
    commentaires: ev.commentairesN1,
    note: ev.note,
  });
  const action = useAction();
  const [confirmer, setConfirmer] = useState(false);
  const base = `/objectifs/equipe/${employeeId}/fiches/${fiche.annee}/${fiche.semestre}/evaluation`;
  const cle = [...CLE_OBJECTIFS, 'equipe', employeeId];
  const envoyes = Boolean(ev.envoyesLe);
  const validee = Boolean(ev.valideeLe);

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
        {objectifs.map((o) => (
          <LigneObjectif key={o.id} objectif={o} statut={fiche.statuts[o.id]}>
            {envoyes && ev.commentairesAgent[o.id] ? (
              <Propos
                qui={prenom}
                texte={ev.commentairesAgent[o.id]!}
                statut={fiche.statuts[o.id]}
              />
            ) : null}
            {envoyes && !validee ? (
              <ZoneCommentaire
                aria-label={`Votre commentaire — ${o.texte}`}
                placeholder="Votre commentaire"
                value={brouillon.valeur.commentaires[o.id] ?? ''}
                onChange={(e) =>
                  brouillon.changer({
                    ...brouillon.valeur,
                    commentaires: { ...brouillon.valeur.commentaires, [o.id]: e.target.value },
                  })
                }
              />
            ) : null}
            {validee && ev.commentairesN1[o.id]?.trim() ? (
              <Propos qui="Vous" texte={ev.commentairesN1[o.id]!} ton="n1" />
            ) : null}
          </LigneObjectif>
        ))}
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
            <span className="text-[11.5px] text-ink-muted">
              Validée le {dateLongue(ev.valideeLe!)}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
            <Intitule>Appréciation globale</Intitule>
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
            <Button size="sm" disabled={!brouillon.valeur.note} onClick={() => setConfirmer(true)}>
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
        {prenom} verra vos commentaires et votre appréciation. L’évaluation ne se modifie plus.
      </Confirmation>
    </div>
  );
}

// ———————————————————————————— dans le dossier de l'agent

/**
 * La section « Évaluation » du dossier : une ligne par semestre évalué — dès
 * que le n+1 valide —, avec qui l'a évalué et la note.
 */
export function CarteEvaluationsAgent({ employeeId }: { employeeId: string }) {
  const evaluations = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'dossier', employeeId],
    queryFn: () => api<EvaluationValidee[]>(`/objectifs/dossiers/${employeeId}/evaluations`),
  });
  const liste = evaluations.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Évaluation</CardTitle>
      </CardHeader>
      {evaluations.isPending ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : liste.length === 0 ? (
        <CardContent>
          <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune évaluation validée pour l’instant.
          </p>
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Année</Th>
              <Th>Période</Th>
              <Th>Manager</Th>
              <Th>Note</Th>
            </tr>
          </THead>
          <TBody>
            {liste.map((e) => (
              <Tr key={`${e.annee}-${e.semestre}`}>
                <Td className="font-medium text-ink-strong tabular-nums">{e.annee}</Td>
                <Td>Semestre {e.semestre}</Td>
                <Td>{e.manager ?? '—'}</Td>
                <Td>
                  <span className="inline-flex items-center gap-2" title={LIBELLES_NOTE[e.note]}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12px] font-extrabold text-primary">
                      {e.note}
                    </span>
                    <span className="text-[12px] text-ink-muted max-sm:hidden">
                      {LIBELLES_NOTE[e.note]}
                    </span>
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
