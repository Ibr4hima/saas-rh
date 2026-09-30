'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  EVALUATIONS_OBJECTIF,
  LIBELLES_EVALUATION,
  LIBELLES_NOTE,
  NOTES_GLOBALES,
  objectifsDeLaFiche,
  type AutoEvaluationObjectif,
  type EvaluationObjectif,
  type FicheObjectifs,
  type NoteGlobale,
} from '@teranga/contracts';
import { Button, cn, Textarea } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { CLE_OBJECTIFS } from './objectifs';

/* ————————————————————————————————————————————————————————————————
   L'évaluation d'un semestre, en trois temps :
   1. l'agent s'auto-évalue — objectif par objectif, un commentaire
      d'ensemble, l'appréciation qu'il se donne — puis l'envoie ;
   2. le n+1 lit cette auto-évaluation, donne la note globale (A à D) et son
      commentaire, puis valide ;
   3. l'agent prend connaissance de son évaluation.
   Chacun écrit au brouillon, enregistré à chaque pause : rien ne passe de
   l'autre côté avant l'envoi ou la validation.
   ———————————————————————————————————————————————————————————————— */

export type Onglet = 'objectifs' | 'evaluation';

/** Où en est l'évaluation d'une fiche, dite par qui la regarde. */
export function StatutEvaluation({
  fiche,
  vue,
  prenom,
}: {
  fiche: FicheObjectifs;
  vue: 'agent' | 'n1';
  /** Le prénom de l'agent, côté n+1. */
  prenom?: string;
}) {
  const envoyee = Boolean(fiche.autoEvaluation?.envoyeeLe);
  const validee = fiche.evaluation?.valideeLe ? fiche.evaluation : null;
  let ton: 'attente' | 'neutre' | 'marque' | 'succes';
  let icone: IconName;
  let texte: string;
  if (validee) {
    const signee = Boolean(validee.signeeLe);
    ton = signee ? 'succes' : vue === 'agent' ? 'attente' : 'marque';
    icone = signee ? 'verified' : vue === 'agent' ? 'schedule' : 'task_alt';
    texte =
      signee || vue === 'n1' ? `Évaluée · ${validee.note}` : `Évaluée · ${validee.note} — à signer`;
  } else if (envoyee) {
    ton = vue === 'n1' ? 'attente' : 'marque';
    icone = vue === 'n1' ? 'rate_review' : 'task_alt';
    texte = vue === 'n1' ? 'À évaluer' : 'Envoyée à votre N+1';
  } else {
    ton = vue === 'agent' ? 'attente' : 'neutre';
    icone = 'schedule';
    texte =
      vue === 'agent' ? 'À auto-évaluer' : `Auto-évaluation de ${prenom ?? 'l’agent'} attendue`;
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        ton === 'attente' && 'bg-accent-soft text-accent-text',
        ton === 'neutre' && 'bg-line-soft text-ink-muted',
        ton === 'marque' && 'bg-primary-soft text-primary',
        ton === 'succes' && 'bg-success-soft text-success',
      )}
    >
      <Icon name={icone} size={14} className="shrink-0" />
      <span className="truncate">{texte}</span>
    </span>
  );
}

/** La barre d'une fiche : où en est l'évaluation, et les deux faces — Objectifs, Évaluation. */
export function BarreFiche({
  statut,
  onglet,
  onOnglet,
}: {
  statut: ReactNode;
  onglet: Onglet;
  onOnglet: (o: Onglet) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-3.5">
      {statut}
      <div role="tablist" className="ml-auto inline-flex rounded-full bg-line-soft p-[3px]">
        {(['objectifs', 'evaluation'] as const).map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={onglet === o}
            onClick={() => onOnglet(o)}
            className={cn(
              'rounded-full px-3.5 py-[5px] text-[11.5px] font-semibold transition-all duration-150',
              onglet === o
                ? 'bg-surface text-ink-strong shadow-[0_1px_3px_rgb(0_0_0/0.08)]'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {o === 'objectifs' ? 'Objectifs' : 'Évaluation'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ———————————————————————————— pièces communes

/** Un intitulé de partie, dans la voix des cartes. */
function Partie({
  titre,
  note,
  children,
}: {
  titre: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          {titre}
        </h4>
        {note ? <span className="text-[11px] text-ink-muted">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

const TONS_STATUT: Record<EvaluationObjectif, string> = {
  atteint: 'border-success/35 bg-success-soft text-success',
  partiel: 'border-primary/30 bg-primary-soft text-primary',
  non_atteint: 'border-danger/30 bg-danger-soft text-danger',
};
const COURTS: Record<EvaluationObjectif, string> = {
  atteint: 'Atteint',
  partiel: 'Partiellement',
  non_atteint: 'Non atteint',
};

function PastilleStatut({ statut }: { statut: EvaluationObjectif | null }) {
  if (!statut) return <span className="text-[11px] text-ink-muted">—</span>;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-[3px] text-[11px] font-semibold',
        TONS_STATUT[statut],
      )}
    >
      {LIBELLES_EVALUATION[statut]}
    </span>
  );
}

/** Atteint, partiellement, non atteint : trois pastilles, une seule allumée. */
function ChoixStatut({
  valeur,
  onChange,
}: {
  valeur: EvaluationObjectif | null;
  onChange: (s: EvaluationObjectif) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {EVALUATIONS_OBJECTIF.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={valeur === s}
          onClick={() => onChange(s)}
          className={cn(
            'rounded-full border px-3 py-[5px] text-[11.5px] font-semibold transition-colors duration-150',
            valeur === s
              ? TONS_STATUT[s]
              : 'border-line text-ink-muted hover:border-ink-muted/40 hover:text-ink',
          )}
        >
          {COURTS[s]}
        </button>
      ))}
    </div>
  );
}

/** A, B, C, D : quatre tuiles, la lettre et ce qu'elle veut dire. */
function ChoixNote({
  valeur,
  onChange,
}: {
  valeur: NoteGlobale | null;
  onChange: (n: NoteGlobale) => void;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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

/** Une note donnée : la lettre dans son rond, ce qu'elle veut dire. */
function NoteDonnee({
  note,
  taille = 'grande',
}: {
  note: NoteGlobale;
  taille?: 'grande' | 'petite';
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-primary font-extrabold text-primary-ink',
          taille === 'grande' ? 'size-10 text-[18px]' : 'size-7 text-[13px]',
        )}
      >
        {note}
      </span>
      <span
        className={cn(
          'font-semibold text-ink-strong',
          taille === 'grande' ? 'text-[14px]' : 'text-[12.5px]',
        )}
      >
        {LIBELLES_NOTE[note]}
      </span>
    </span>
  );
}

function Citation({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-line pl-3 text-[12.5px] leading-relaxed whitespace-pre-line text-ink">
      {children}
    </p>
  );
}

function dateLongue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Un brouillon qui s'enregistre à chaque pause — et, quitté en cours de
 * frappe, avant de partir. `vider` l'écrit sur-le-champ (avant un envoi).
 */
function useBrouillon<T>(enregistrer: (valeur: T) => Promise<unknown>) {
  const [echec, setEchec] = useState(false);
  const enAttente = useRef<T | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const file = useRef<Promise<void>>(Promise.resolve());
  const fonction = useRef(enregistrer);
  fonction.current = enregistrer;

  const vider = useCallback(() => {
    clearTimeout(minuterie.current);
    file.current = file.current.then(async () => {
      const valeur = enAttente.current;
      if (valeur === null) return;
      enAttente.current = null;
      try {
        await fonction.current(valeur);
        setEchec(false);
      } catch {
        enAttente.current = enAttente.current ?? valeur;
        setEchec(true);
      }
    });
    return file.current;
  }, []);

  const planifier = useCallback(
    (valeur: T) => {
      enAttente.current = valeur;
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void vider(), 700);
    },
    [vider],
  );

  useEffect(() => () => void vider(), [vider]);
  return { planifier, vider, echec };
}

function NonEnregistre({ onReessayer }: { onReessayer: () => void }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-[11.5px] font-semibold text-danger">
      <Icon name="error" size={14} />
      Non enregistré
      <button type="button" onClick={onReessayer} className="underline">
        Réessayer
      </button>
    </p>
  );
}

/** Une confirmation avant ce qui ne se reprend pas. */
function Confirmation({
  ouverte,
  titre,
  children,
  action,
  enCours,
  erreur,
  onConfirmer,
  onFermer,
}: {
  ouverte: boolean;
  titre: string;
  children: ReactNode;
  action: string;
  enCours: boolean;
  erreur: string | null;
  onConfirmer: () => void;
  onFermer: () => void;
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

/** Une action qui part au serveur, avec son erreur à dire. */
function useGeste(chemin: string, cle: readonly unknown[]) {
  const queryClient = useQueryClient();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const lancer = useCallback(
    async (avant?: () => Promise<unknown>) => {
      setEnCours(true);
      setErreur(null);
      try {
        await avant?.();
        await api(chemin, { method: 'POST' });
        await queryClient.invalidateQueries({ queryKey: cle });
        return true;
      } catch (e) {
        setErreur(e instanceof ApiError ? e.message : 'Action impossible — réessayez.');
        return false;
      } finally {
        setEnCours(false);
      }
    },
    [chemin, cle, queryClient],
  );
  return { lancer, enCours, erreur, setErreur };
}

// ———————————————————————————— l'auto-évaluation, lue

function AutoEvaluationLue({ fiche }: { fiche: FicheObjectifs }) {
  const auto = fiche.autoEvaluation!;
  return (
    <div className="flex flex-col gap-4">
      {auto.objectifs.length ? (
        <ol className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-card-line">
          {auto.objectifs.map((o) => (
            <li key={o.id} className="flex flex-col gap-1.5 px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <span className="min-w-0 flex-1 basis-60 text-[12.5px] font-semibold text-ink-strong">
                  {o.texte}
                </span>
                <PastilleStatut statut={o.statut} />
              </div>
              {o.commentaire ? (
                <p className="text-[12px] leading-relaxed whitespace-pre-line text-ink-muted">
                  {o.commentaire}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {auto.commentaire || auto.note ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-8">
          {auto.commentaire ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-ink-muted">Commentaire général</span>
              <Citation>{auto.commentaire}</Citation>
            </div>
          ) : (
            <span />
          )}
          {auto.note ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-ink-muted">
                Appréciation proposée
              </span>
              <NoteDonnee note={auto.note} taille="petite" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ———————————————————————————— côté agent

/**
 * L'évaluation, vue par l'agent : son auto-évaluation — à rédiger, puis
 * envoyée —, et l'évaluation de son n+1 une fois validée, dont il prend
 * connaissance.
 */
export function EvaluationAgent({ fiche }: { fiche: FicheObjectifs }) {
  const cle = [...CLE_OBJECTIFS, 'moi'] as const;
  const base = `/objectifs/moi/fiches/${fiche.annee}/${fiche.semestre}`;
  const envoyee = Boolean(fiche.autoEvaluation?.envoyeeLe);
  const evaluation = fiche.evaluation?.valideeLe ? fiche.evaluation : null;
  const signature = useGeste(`${base}/signature`, cle);

  return (
    <div className="flex flex-col gap-7 px-5 pt-5 pb-5">
      {evaluation ? (
        <Partie
          titre="Évaluation de votre N+1"
          note={`${evaluation.evaluateur ? `${evaluation.evaluateur} · ` : ''}validée le ${dateLongue(evaluation.valideeLe!)}`}
        >
          <NoteDonnee note={evaluation.note!} />
          {evaluation.commentaire ? <Citation>{evaluation.commentaire}</Citation> : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {signature.erreur ? (
              <p role="alert" className="mr-auto text-[12px] font-semibold text-danger">
                {signature.erreur}
              </p>
            ) : null}
            {evaluation.signeeLe ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
                <Icon name="verified" size={16} />
                Prise de connaissance le {dateLongue(evaluation.signeeLe)}
              </span>
            ) : (
              <Button loading={signature.enCours} onClick={() => void signature.lancer()}>
                <Icon name="check" size={16} />
                J’ai pris connaissance
              </Button>
            )}
          </div>
        </Partie>
      ) : null}

      {envoyee || evaluation ? (
        <Partie
          titre="Mon auto-évaluation"
          note={
            fiche.autoEvaluation?.envoyeeLe
              ? `envoyée le ${dateLongue(fiche.autoEvaluation.envoyeeLe)}`
              : 'non envoyée'
          }
        >
          {fiche.autoEvaluation ? (
            <AutoEvaluationLue fiche={fiche} />
          ) : (
            <p className="text-[12.5px] text-ink-muted">—</p>
          )}
        </Partie>
      ) : (
        <FormulaireAutoEvaluation fiche={fiche} base={base} cle={cle} />
      )}
    </div>
  );
}

function FormulaireAutoEvaluation({
  fiche,
  base,
  cle,
}: {
  fiche: FicheObjectifs;
  base: string;
  cle: readonly unknown[];
}) {
  // Les objectifs du jour — ceux de la fiche —, avec ce qu'en disait le brouillon.
  const depart = useMemo(() => {
    const dits = new Map((fiche.autoEvaluation?.objectifs ?? []).map((o) => [o.id, o]));
    return objectifsDeLaFiche(fiche.contenu).map<AutoEvaluationObjectif>((o) => ({
      id: o.id,
      texte: o.texte,
      statut: dits.get(o.id)?.statut ?? null,
      commentaire: dits.get(o.id)?.commentaire ?? '',
    }));
    // Au montage seulement : la saisie ne doit pas être écrasée par un rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [objectifs, setObjectifs] = useState(depart);
  const [commentaire, setCommentaire] = useState(fiche.autoEvaluation?.commentaire ?? '');
  const [note, setNote] = useState<NoteGlobale | null>(fiche.autoEvaluation?.note ?? null);
  const [confirmer, setConfirmer] = useState(false);

  const brouillon = useBrouillon(
    (v: { objectifs: AutoEvaluationObjectif[]; commentaire: string; note: NoteGlobale | null }) =>
      api(`${base}/auto-evaluation`, { method: 'PUT', body: v }),
  );
  const envoi = useGeste(`${base}/auto-evaluation/envoi`, cle);

  const changer = (patch: {
    objectifs?: AutoEvaluationObjectif[];
    commentaire?: string;
    note?: NoteGlobale | null;
  }) => {
    const suivant = {
      objectifs: patch.objectifs ?? objectifs,
      commentaire: patch.commentaire ?? commentaire,
      note: patch.note !== undefined ? patch.note : note,
    };
    if (patch.objectifs) setObjectifs(patch.objectifs);
    if (patch.commentaire !== undefined) setCommentaire(patch.commentaire);
    if (patch.note !== undefined) setNote(patch.note);
    brouillon.planifier(suivant);
  };
  const changerObjectif = (id: string, patch: Partial<AutoEvaluationObjectif>) =>
    changer({ objectifs: objectifs.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const restants = objectifs.filter((o) => !o.statut).length;
  const pret = restants === 0 && note !== null;

  return (
    <>
      <Partie titre="Mon auto-évaluation">
        {objectifs.length ? (
          <ol className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-card-line">
            {objectifs.map((o, i) => (
              <li key={o.id} className="flex flex-col gap-2.5 px-3.5 py-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-line-soft text-[10.5px] font-bold text-ink-muted tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed font-semibold text-ink-strong">
                    {o.texte}
                  </span>
                </div>
                <div className="flex flex-col gap-2 pl-[30px]">
                  <ChoixStatut
                    valeur={o.statut}
                    onChange={(statut) => changerObjectif(o.id, { statut })}
                  />
                  <Textarea
                    aria-label={`Commentaire — ${o.texte}`}
                    placeholder="Commentaire (facultatif)"
                    rows={1}
                    className="min-h-[38px] text-[12.5px]"
                    value={o.commentaire}
                    onChange={(e) => changerObjectif(o.id, { commentaire: e.target.value })}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </Partie>

      <Partie titre="Commentaire général">
        <Textarea
          aria-label="Commentaire général"
          placeholder="Le semestre en quelques lignes"
          rows={3}
          className="text-[12.5px]"
          value={commentaire}
          onChange={(e) => changer({ commentaire: e.target.value })}
        />
      </Partie>

      <Partie titre="Mon appréciation globale">
        <ChoixNote valeur={note} onChange={(n) => changer({ note: n })} />
      </Partie>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {brouillon.echec ? <NonEnregistre onReessayer={() => void brouillon.vider()} /> : null}
        {!pret ? (
          <span className="mr-auto text-[11.5px] text-ink-muted">
            {restants > 0
              ? `${restants} objectif${restants > 1 ? 's' : ''} sans statut`
              : 'Appréciation globale à donner'}
          </span>
        ) : null}
        <Button disabled={!pret} onClick={() => setConfirmer(true)}>
          <Icon name="task_alt" size={16} />
          Envoyer à mon N+1
        </Button>
      </div>

      <Confirmation
        ouverte={confirmer}
        titre="Envoyer votre auto-évaluation"
        action="Envoyer"
        enCours={envoi.enCours}
        erreur={envoi.erreur}
        onFermer={() => {
          setConfirmer(false);
          envoi.setErreur(null);
        }}
        onConfirmer={async () => {
          if (await envoi.lancer(brouillon.vider)) setConfirmer(false);
        }}
      >
        Une fois envoyée, elle ne se modifie plus.
      </Confirmation>
    </>
  );
}

// ———————————————————————————— côté n+1

/**
 * L'évaluation, vue par le n+1 : l'auto-évaluation de l'agent, une fois
 * envoyée — objectif par objectif —, puis sa propre évaluation : la note
 * globale et son commentaire, au brouillon jusqu'à la validation.
 */
export function EvaluationN1({
  employeeId,
  prenom,
  fiche,
}: {
  employeeId: string;
  prenom: string;
  fiche: FicheObjectifs;
}) {
  const cle = [...CLE_OBJECTIFS, 'equipe', employeeId] as const;
  const base = `/objectifs/equipe/${employeeId}/fiches/${fiche.annee}/${fiche.semestre}/evaluation`;
  const validee = fiche.evaluation?.valideeLe ? fiche.evaluation : null;
  const auto = fiche.autoEvaluation?.envoyeeLe ? fiche.autoEvaluation : null;

  return (
    <div className="flex flex-col gap-7 px-5 pt-5 pb-5">
      <Partie
        titre={`Auto-évaluation de ${prenom}`}
        note={auto ? `envoyée le ${dateLongue(auto.envoyeeLe!)}` : undefined}
      >
        {auto ? (
          <AutoEvaluationLue fiche={fiche} />
        ) : (
          <p className="text-[12.5px] text-ink-muted">Pas encore envoyée.</p>
        )}
      </Partie>

      {validee ? (
        <Partie titre="Votre évaluation" note={`validée le ${dateLongue(validee.valideeLe!)}`}>
          <NoteDonnee note={validee.note!} />
          {validee.commentaire ? <Citation>{validee.commentaire}</Citation> : null}
          <p
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-semibold',
              validee.signeeLe ? 'text-success' : 'text-ink-muted',
            )}
          >
            <Icon name={validee.signeeLe ? 'verified' : 'schedule'} size={16} />
            {validee.signeeLe
              ? `${prenom} en a pris connaissance le ${dateLongue(validee.signeeLe)}`
              : `En attente de la prise de connaissance de ${prenom}`}
          </p>
        </Partie>
      ) : (
        <FormulaireEvaluation fiche={fiche} base={base} cle={cle} />
      )}
    </div>
  );
}

function FormulaireEvaluation({
  fiche,
  base,
  cle,
}: {
  fiche: FicheObjectifs;
  base: string;
  cle: readonly unknown[];
}) {
  const [note, setNote] = useState<NoteGlobale | null>(fiche.evaluation?.note ?? null);
  const [commentaire, setCommentaire] = useState(fiche.evaluation?.commentaire ?? '');
  const [confirmer, setConfirmer] = useState(false);
  const brouillon = useBrouillon((v: { note: NoteGlobale | null; commentaire: string }) =>
    api(base, { method: 'PUT', body: v }),
  );
  const validation = useGeste(`${base}/validation`, cle);

  return (
    <>
      <Partie titre="Note globale">
        <ChoixNote
          valeur={note}
          onChange={(n) => {
            setNote(n);
            brouillon.planifier({ note: n, commentaire });
          }}
        />
      </Partie>
      <Partie titre="Commentaire">
        <Textarea
          aria-label="Commentaire de l'évaluation"
          placeholder="Points forts, axes de progrès…"
          rows={4}
          className="text-[12.5px]"
          value={commentaire}
          onChange={(e) => {
            setCommentaire(e.target.value);
            brouillon.planifier({ note, commentaire: e.target.value });
          }}
        />
      </Partie>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {brouillon.echec ? <NonEnregistre onReessayer={() => void brouillon.vider()} /> : null}
        <Button disabled={!note} onClick={() => setConfirmer(true)}>
          <Icon name="task_alt" size={16} />
          Valider l’évaluation
        </Button>
      </div>

      <Confirmation
        ouverte={confirmer}
        titre="Valider l’évaluation"
        action="Valider"
        enCours={validation.enCours}
        erreur={validation.erreur}
        onFermer={() => {
          setConfirmer(false);
          validation.setErreur(null);
        }}
        onConfirmer={async () => {
          if (await validation.lancer(brouillon.vider)) setConfirmer(false);
        }}
      >
        Une fois validée, la fiche et son évaluation ne se modifient plus.
      </Confirmation>
    </>
  );
}
