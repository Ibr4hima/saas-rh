'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LIBELLES_NOTE,
  NOTES_GLOBALES,
  objectifsDeLaFiche,
  type FicheObjectifs,
  type NoteGlobale,
  type ObjectifDeLaFiche,
} from '@teranga/contracts';
import { Button, cn, Textarea } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { Icon } from './icons';
import { Modal } from './modal';
import { CLE_OBJECTIFS } from './objectifs';

/* ————————————————————————————————————————————————————————————————
   Ce que l'agent fait de ses objectifs, et ce que son n+1 en dit.

   L'agent coche ce qu'il a atteint, puis commente chaque objectif — ce
   qu'il a fait, ce qui manque et pourquoi —, enregistre autant de fois qu'il
   veut et envoie à son n+1 quand tout est commenté. Le n+1 lit, commente à
   son tour sous chaque objectif, donne l'appréciation globale et valide.
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

/**
 * La case d'un objectif, dessinée comme celles de la fiche. Cochée, elle ne
 * barre pas le texte : ici, on rend compte de ce qui a été fait.
 */
function Case({ coche, onClick }: { coche: boolean; onClick?: () => void }) {
  const dessin = (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-150',
        coche ? 'border-primary bg-primary text-primary-ink' : 'border-ink-muted/40 bg-surface',
        onClick && !coche && 'group-hover:border-primary',
      )}
    >
      {coche ? <Icon name="check" size={13} weight={600} /> : null}
    </span>
  );
  if (!onClick) return <span className="mt-[2px] flex">{dessin}</span>;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={coche}
      onClick={onClick}
      className="group mt-[2px] flex rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {dessin}
    </button>
  );
}

/** Ce qu'une personne a écrit d'un objectif : son nom, son texte. */
function Propos({
  qui,
  texte,
  ton = 'neutre',
}: {
  qui: string;
  texte: string;
  ton?: 'neutre' | 'n1';
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
          'text-[10.5px] font-bold tracking-[0.06em] uppercase',
          ton === 'n1' ? 'text-primary' : 'text-ink-muted',
        )}
      >
        {qui}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink">{texte}</p>
    </div>
  );
}

/** Une ligne d'objectif : la case, le texte, puis ce qui s'en dit dessous. */
function LigneObjectif({
  objectif,
  coche,
  onCocher,
  children,
}: {
  objectif: ObjectifDeLaFiche;
  coche: boolean;
  onCocher?: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-1">
      <div className="flex items-start gap-[11px]">
        <Case coche={coche} onClick={onCocher} />
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

// ———————————————————————————— le bouton « Commentaires »

/**
 * En bas à droite de la fiche : le passage aux commentaires — et, d'un
 * coup d'œil, où ils en sont.
 */
export function BoutonCommentaires({
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
  const commentes = objectifs.filter((o) => ev.commentairesAgent[o.id]?.trim()).length;
  const etat = ev.valideeLe
    ? `Évaluation · ${ev.note}`
    : ev.envoyesLe
      ? 'Commentaires envoyés'
      : commentes > 0
        ? `Commentaires · ${commentes}/${objectifs.length}`
        : 'Commentaires';
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
      <Icon name={ev.envoyesLe && !actif ? 'check_circle' : 'chat_bubble'} size={15} />
      {etat}
    </button>
  );
}

// ———————————————————————————— côté agent

/**
 * Les commentaires de l'agent, sous chacun de ses objectifs — à écrire, puis
 * envoyés ; et, une fois l'évaluation validée, ce qu'en dit son n+1.
 */
export function CommentairesAgent({
  fiche,
  coches,
  onCocher,
  bascule,
}: {
  fiche: FicheObjectifs;
  coches: string[];
  onCocher: (id: string, coche: boolean) => void;
  /** Le bouton « Commentaires », rangé au bout de la barre d'actions. */
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

  const manquants = objectifs.filter((o) => !brouillon.valeur[o.id]?.trim()).length;

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
          <LigneObjectif
            key={o.id}
            objectif={o}
            coche={coches.includes(o.id)}
            onCocher={envoyes ? undefined : () => onCocher(o.id, !coches.includes(o.id))}
          >
            {envoyes ? (
              <>
                {ev.commentairesAgent[o.id] ? (
                  <Propos qui="Vous" texte={ev.commentairesAgent[o.id]!} />
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
              <Textarea
                aria-label={`Commentaire — ${o.texte}`}
                placeholder="Ce que vous avez fait, ce qui reste…"
                rows={2}
                className="min-h-[54px] text-[12.5px]"
                value={brouillon.valeur[o.id] ?? ''}
                onChange={(e) => brouillon.changer({ ...brouillon.valeur, [o.id]: e.target.value })}
              />
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
        {action.erreur && !confirmer ? (
          <p role="alert" className="mr-auto text-[12px] font-semibold text-danger">
            {action.erreur}
          </p>
        ) : envoyes ? (
          <p className="mr-auto text-[11.5px] text-ink-muted">
            {ev.valideeLe
              ? `Évaluation validée le ${dateLongue(ev.valideeLe)}${ev.evaluateur ? ` par ${ev.evaluateur}` : ''}`
              : `Envoyés le ${dateLongue(ev.envoyesLe!)}`}
          </p>
        ) : manquants > 0 ? (
          <p className="mr-auto text-[11.5px] text-ink-muted">
            {manquants > 1
              ? `${manquants} objectifs sans commentaire`
              : '1 objectif sans commentaire'}
          </p>
        ) : null}
        {envoyes ? null : (
          <>
            <BoutonEnregistrer
              modifie={brouillon.modifie}
              enregistre={brouillon.enregistre}
              enCours={action.enCours === 'enregistrer'}
              onClick={() => void enregistrer()}
            />
            <Button size="sm" disabled={manquants > 0} onClick={() => setConfirmer(true)}>
              <Icon name="send" size={15} />
              Envoyer à mon N+1
            </Button>
          </>
        )}
        {bascule}
      </div>

      <Confirmation
        ouverte={confirmer}
        titre="Envoyer vos commentaires"
        action="Envoyer"
        enCours={action.enCours === 'envoyer'}
        erreur={action.erreur}
        onFermer={() => {
          setConfirmer(false);
          action.setErreur(null);
        }}
        onConfirmer={() => void envoyer()}
      >
        Une fois envoyés, vos commentaires et vos objectifs cochés ne se modifient plus.
      </Confirmation>
    </div>
  );
}

// ———————————————————————————— côté n+1

/**
 * L'évaluation d'un semestre, vue par le n+1 : chaque objectif — coché ou
 * non par l'agent —, ce qu'en dit l'agent, et dessous son propre commentaire ;
 * puis l'appréciation globale.
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
    });
    if (ok) setConfirmer(false);
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-3 pb-4">
      <ol className="flex flex-col divide-y divide-line-soft">
        {objectifs.map((o) => (
          <LigneObjectif key={o.id} objectif={o} coche={fiche.coches.includes(o.id)}>
            {envoyes && ev.commentairesAgent[o.id] ? (
              <Propos qui={prenom} texte={ev.commentairesAgent[o.id]!} />
            ) : null}
            {envoyes && !validee ? (
              <Textarea
                aria-label={`Votre commentaire — ${o.texte}`}
                placeholder="Votre commentaire"
                rows={2}
                className="min-h-[54px] text-[12.5px]"
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
          {prenom} n’a pas encore envoyé ses commentaires.
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
