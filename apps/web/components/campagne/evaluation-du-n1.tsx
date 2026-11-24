'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import {
  competencesDe,
  dateEnLettres,
  LONGUEURS_DE_LA_FICHE,
  MAXIMUMS_DE_LA_FICHE,
  NIVEAUX,
  NIVEAUX_DE_COMPETENCE,
  sansLignesVides,
  SYNTHESE_GENERALE,
  type ActionDuPlan,
  type AppreciationDuN1,
  type AutoEvaluation,
  type EcritureDeLEvaluation,
  type EvaluationDuN1,
  type FormationSouhaitee,
  type Niveau,
  type ObjectifEvalue,
  type PartieReservee,
  type PersonneDeLaCampagne,
  type PersonnelDeLaFiche,
} from '@teranga/contracts';
import { Card, Checkbox, cn, DateInput, Field, Input } from '@teranga/ui';
import { BoutonAjouter } from '../bouton-ajouter';
import { ChoixDeNiveau, NiveauDonne, ZoneDeTexte } from '../grille-evaluation';
import { Icon } from '../icons';
import {
  AppreciationDeLAgentEnLecture,
  AucunObjectif,
  AutresRealisationsEnLecture,
  CarteDeLaFiche,
  DeuxParDeux,
  EnTeteDeLObjectif,
  LIBELLES_D_ATTEINTE,
  PAR_L_AGENT,
  PAR_LE_N1,
  Question,
  QuestionEnPuces,
  RecapitulatifEnLecture,
  Reponse,
  SouhaitsEnLecture,
} from './auto-evaluation';
import type { Changement } from './enregistrement';

/* ────────────────────────────────────────────────────────────────
   L'évaluation par le N+1, sur la fiche S1/EN05 (ADR-0216) : la fiche
   entière, dans son ordre, les parties de l'agent en lecture, celles du N+1
   à remplir. Pour chaque objectif, l'auto-évaluation de l'agent et
   l'appréciation du N+1 côte à côte sur un grand écran. Puis les
   compétences, la synthèse et le plan d'action, les besoins de formation
   (ADR-0272), les préoccupations et les souhaits de l'agent, et la partie
   réservée à la hiérarchie. Les intitulés sont ceux de la fiche de la DCH.
   Transmise, la même fiche se lit.
   ──────────────────────────────────────────────────────────────── */

/** Une modification de l'évaluation, hors de la partie réservée. */
type MiseAJour = (maj: (e: EvaluationDuN1) => EvaluationDuN1) => void;

const appreciationVide = (): AppreciationDuN1 => ({ niveau: null, commentaire: '' });

/**
 * La fiche du N+1. Obligatoires, et marqués d'un astérisque : l'appréciation
 * de chaque objectif, chaque compétence (sauf le management, s'il y a lieu),
 * les points forts, les axes de développement, puis la compréhension et la
 * tenue du poste. Sans `onChange`, la fiche se lit ; sans `reservee`, c'est
 * celle de l'agent, qui s'arrête avant la partie réservée (ADR-0217). Les
 * commentaires du N+2, en lecture ou à écrire, ferment la partie réservée
 * (ADR-0218).
 */
export function FicheDuN1({
  annee,
  objectifs,
  personnel,
  auto,
  evaluation: ecrite,
  reservee,
  commentairesDuN2,
  entretien,
  onChange,
}: {
  annee: number;
  objectifs: readonly ObjectifEvalue[];
  personnel: PersonnelDeLaFiche;
  auto: AutoEvaluation;
  evaluation: EvaluationDuN1;
  reservee: PartieReservee | null;
  commentairesDuN2?: ReactNode;
  /**
   * Pendant la saisie : l'agent reçu en entretien, et les bornes de la date
   * de l'entretien, de la transmission de l'auto-évaluation à aujourd'hui
   * (ADR-0265).
   */
  entretien?: { agent: string; du: string | null; au: string };
  onChange?: Changement<EcritureDeLEvaluation>;
}) {
  // En lecture, les lignes laissées vides d'un tableau ne se montrent pas.
  const evaluation = onChange ? ecrite : sansLignesVides(ecrite);
  const changer: MiseAJour | undefined = onChange
    ? (maj) => onChange((x) => ({ ...x, evaluation: maj(x.evaluation) }))
    : undefined;
  const reserver = onChange
    ? (maj: Partial<PartieReservee>) =>
        onChange((x) => ({ ...x, reservee: { ...x.reservee, ...maj } }))
    : undefined;

  return (
    <>
      <RecapitulatifEnLecture auto={auto} qui={PAR_L_AGENT} />
      <Resultats
        annee={annee}
        objectifs={objectifs}
        auto={auto}
        evaluation={evaluation}
        onChange={changer}
      />
      <Competences personnel={personnel} evaluation={evaluation} onChange={changer} />
      <Synthese evaluation={evaluation} onChange={changer} />
      <Formations evaluation={evaluation} onChange={changer} />
      <SouhaitsEnLecture auto={auto} qui={PAR_L_AGENT} />
      {reservee ? (
        <Reservee reservee={reservee} commentairesDuN2={commentairesDuN2} onChange={reserver} />
      ) : null}
      <Entretien evaluation={evaluation} saisie={entretien} onChange={changer} />
    </>
  );
}

/**
 * L'entretien avec l'agent, au bout de la fiche (ADR-0265). Pendant la
 * saisie, le N+1 confirme l'avoir tenu, puis en donne la date, entre la
 * transmission de l'auto-évaluation et le jour même : sans les deux, ni
 * « Valider » ni « Transmettre ». En lecture, la date seule, s'il y en a une.
 */
function Entretien({
  evaluation: e,
  saisie,
  onChange,
}: {
  evaluation: EvaluationDuN1;
  saisie?: { agent: string; du: string | null; au: string };
  onChange?: MiseAJour;
}) {
  const id = useId();
  if (!onChange || !saisie) {
    return e.dateDeLEntretien ? (
      <Card className="mt-5 px-5 py-4">
        <LibelleLu>Date de l’entretien</LibelleLu>
        <p className="text-[13.5px] font-semibold text-ink-strong">
          {dateEnLettres(e.dateDeLEntretien)}
        </p>
      </Card>
    ) : null;
  }
  return (
    <Card className="mt-5 flex flex-col gap-4 px-5 py-5">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          className="mt-[3px]"
          checked={e.entretienConfirme}
          onChange={(ev) => {
            const coche = ev.target.checked;
            // Décochée, la case emporte la date avec elle.
            onChange((x) => ({
              ...x,
              entretienConfirme: coche,
              dateDeLEntretien: coche ? x.dateDeLEntretien : null,
            }));
          }}
        />
        <span className="text-sm leading-relaxed font-medium text-ink-strong">
          Je confirme avoir eu un entretien avec {saisie.agent} pour échanger sur son
          auto-évaluation et ses objectifs.
          <span className="text-danger"> *</span>
        </span>
      </label>
      {e.entretienConfirme ? (
        <Field label="Date de l’entretien" htmlFor={id} required className="max-w-xs">
          <DateInput
            id={id}
            value={e.dateDeLEntretien ?? ''}
            min={saisie.du ?? undefined}
            max={saisie.au}
            onChange={(ev) => {
              const le = ev.target.value || null;
              onChange((x) => ({ ...x, dateDeLEntretien: le }));
            }}
          />
        </Field>
      ) : null}
    </Card>
  );
}

// ──────────────────────────────────────────────── les pièces

/** L'intitulé d'un choix, au-dessus de lui, comme celui d'un champ. */
function Libelle({ children, requise = false }: { children: ReactNode; requise?: boolean }) {
  return (
    <p className="mb-1.5 text-sm font-medium text-ink-strong">
      {children}
      {requise ? <span className="text-danger"> *</span> : null}
    </p>
  );
}

/** L'intitulé d'une valeur en lecture, petit et gris. */
function LibelleLu({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">{children}</p>;
}

/** Un texte en lecture, sans intitulé. */
function TexteLu({ texte }: { texte: string }) {
  return texte.trim() ? (
    <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
      {texte.trim()}
    </p>
  ) : (
    <p className="text-[13px] text-ink-muted/70">Non renseigné</p>
  );
}

/** Une partie d'une carte, sous son titre, séparée de la suivante par un filet. */
function SousPartie({
  titre,
  chapeau,
  requise = false,
  children,
}: {
  titre: string;
  chapeau?: string;
  /** Marquée d'un astérisque, comme un champ obligatoire. */
  requise?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line-soft last:border-b-0">
      <div className="px-5 pt-5">
        <h3 className="text-[13.5px] leading-snug font-bold text-ink-strong">
          {titre}
          {requise ? <span className="text-danger"> *</span> : null}
        </h3>
        {chapeau ? <p className="mt-1 text-[12.5px] text-ink-muted">{chapeau}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Un volet de l'évaluation d'un objectif : celui de l'agent, en lecture, sur
 * le fond des données lues ; celui du N+1, à côté.
 */
function Volet({
  titre,
  lecture = false,
  children,
}: {
  titre: string;
  lecture?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-bloc border p-4',
        lecture ? 'border-bloc-line bg-bloc' : 'border-line-soft bg-surface',
      )}
    >
      <h3 className="-mb-1 text-[9.5px] font-bold tracking-[0.11em] text-ink-muted uppercase">
        {titre}
      </h3>
      {children}
    </section>
  );
}

// ──────────────────────────────────────────────── 2. les résultats

function Resultats({
  annee,
  objectifs,
  auto,
  evaluation: e,
  onChange,
}: {
  annee: number;
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
  evaluation: EvaluationDuN1;
  onChange?: MiseAJour;
}) {
  const changer = (id: string, maj: Partial<AppreciationDuN1>) =>
    onChange?.((x) => ({
      ...x,
      objectifs: { ...x.objectifs, [id]: { ...appreciationVide(), ...x.objectifs[id], ...maj } },
    }));
  return (
    <CarteDeLaFiche
      titre="Évaluation des résultats"
      chapeau={`L’atteinte des objectifs fixés pour ${annee}.`}
    >
      {objectifs.length === 0 ? (
        <AucunObjectif />
      ) : (
        <ol>
          {objectifs.map((o, i) => {
            const n1 = e.objectifs[o.id] ?? appreciationVide();
            return (
              <li key={o.id} className="flex flex-col gap-4 border-b border-line-soft px-5 py-5">
                <EnTeteDeLObjectif objectif={o} rang={i + 1} />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Volet titre="Auto-évaluation de l’agent" lecture>
                    <AppreciationDeLAgentEnLecture
                      appreciation={auto.objectifs[o.id]}
                      colonnes={false}
                    />
                  </Volet>
                  <Volet titre="Appréciation du N+1">
                    {onChange ? (
                      <>
                        <div>
                          <Libelle requise>Niveau</Libelle>
                          <ChoixDeNiveau
                            legende={`Appréciation de l’objectif ${i + 1}`}
                            valeur={n1.niveau}
                            libelles={LIBELLES_D_ATTEINTE}
                            court
                            onChange={(niveau) => changer(o.id, { niveau })}
                          />
                        </div>
                        <Question
                          question="Commentaire"
                          valeur={n1.commentaire}
                          onChange={(commentaire) => changer(o.id, { commentaire })}
                        />
                      </>
                    ) : (
                      <>
                        <div>
                          <LibelleLu>Niveau</LibelleLu>
                          <NiveauDonne
                            niveau={n1.niveau}
                            libelle={n1.niveau ? LIBELLES_D_ATTEINTE[n1.niveau] : undefined}
                          />
                        </div>
                        <Reponse question="Commentaire" texte={n1.commentaire} />
                      </>
                    )}
                  </Volet>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <AutresRealisationsEnLecture auto={auto} />
    </CarteDeLaFiche>
  );
}

// ──────────────────────────────────────────────── 3. les compétences

/** L'échelle des compétences, comme les colonnes de la fiche : « A Excellent »… */
function Echelle() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5">
      {NIVEAUX.map((n) => (
        <NiveauDonne key={n} niveau={n} libelle={NIVEAUX_DE_COMPETENCE[n]} />
      ))}
    </div>
  );
}

function Competences({
  personnel,
  evaluation: e,
  onChange,
}: {
  personnel: PersonnelDeLaFiche;
  evaluation: EvaluationDuN1;
  onChange?: MiseAJour;
}) {
  return (
    <CarteDeLaFiche
      titre="Évaluation des compétences et des performances"
      qui={PAR_LE_N1}
      chapeau={<Echelle />}
    >
      <ol>
        {competencesDe(personnel).map((c, i) => {
          const niveau = e.competences[c.cle] ?? null;
          return (
            <li
              key={c.cle}
              className={cn(
                'border-b border-line-soft px-5 last:border-b-0',
                // En lecture, la compétence à gauche et son niveau à droite,
                // comme une ligne du tableau de la fiche.
                onChange
                  ? 'py-5'
                  : 'grid grid-cols-1 gap-2 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-6',
              )}
            >
              <div className={cn(onChange && 'mb-3')}>
                <p className="text-[13.5px] leading-snug font-bold text-ink-strong">
                  <span className="mr-1.5 text-ink-muted tabular-nums">{i + 1}.</span>
                  {c.intitule}
                  {onChange && !c.cadres ? <span className="text-danger">{' '}*</span> : null}
                </p>
                {c.cadres ? (
                  <p className="mt-0.5 text-[12px] text-ink-muted">S’il y a lieu</p>
                ) : null}
              </div>
              {onChange ? (
                <ChoixDeNiveau
                  legende={c.intitule}
                  valeur={niveau}
                  libelles={c.niveaux}
                  onChange={(n) =>
                    onChange((x) => ({ ...x, competences: { ...x.competences, [c.cle]: n } }))
                  }
                />
              ) : c.cadres && !niveau ? (
                <p className="text-[12.5px] text-ink-muted">Sans objet</p>
              ) : (
                <NiveauDonne niveau={niveau} libelle={niveau ? c.niveaux[niveau] : undefined} />
              )}
            </li>
          );
        })}
      </ol>
    </CarteDeLaFiche>
  );
}

// ──────────────────────────────────────────────── 4. la synthèse

function Synthese({
  evaluation: e,
  onChange,
}: {
  evaluation: EvaluationDuN1;
  onChange?: MiseAJour;
}) {
  const bilan = [
    { cle: 'pointsForts', question: 'Points forts' },
    { cle: 'axesDeDeveloppement', question: 'Axes de développement' },
  ] as const;
  return (
    <CarteDeLaFiche titre="Synthèse de l’évaluation et axes d’amélioration" qui={PAR_LE_N1}>
      <SousPartie titre="Bilan global">
        <DeuxParDeux className="pt-4">
          {/* En puces, une par ligne, comme les réponses en puces de
              l'auto-évaluation (ADR-0251). */}
          {bilan.map((q) =>
            onChange ? (
              <QuestionEnPuces
                key={q.cle}
                question={q.question}
                requise
                valeur={e[q.cle]}
                onChange={(v) => onChange((x) => ({ ...x, [q.cle]: v }))}
              />
            ) : (
              <Reponse key={q.cle} question={q.question} texte={e[q.cle]} enPuces />
            ),
          )}
        </DeuxParDeux>
      </SousPartie>
      <SousPartie
        titre="Plan d’action pour développer les compétences"
        chapeau="Les actions concrètes à mettre en place pour développer les compétences à améliorer."
      >
        <Tableau<ActionDuPlan>
          nom="Action"
          leNom="l’action"
          colonnes={[
            'Action ou moyen (coaching, mentorat, délégation…)',
            'Délai',
            'Suivi ou justification',
          ]}
          gabarit="@[46rem]:grid-cols-[1.75rem_minmax(0,2.3fr)_minmax(0,1.05fr)_minmax(0,2.1fr)_1.75rem]"
          lignes={e.plan}
          max={MAXIMUMS_DE_LA_FICHE.actions}
          ajouter="Ajouter une action"
          vide={() => ({ action: '', delai: '', suivi: '' })}
          lecture={(a) => [a.action, a.delai, a.suivi]}
          saisie={(a, changer, attrs) => [
            <CelluleDeTexte
              key="action"
              {...attrs(0)}
              max={LONGUEURS_DE_LA_FICHE.ligne}
              valeur={a.action}
              onChange={(action) => changer({ action })}
            />,
            <Input
              key="delai"
              {...attrs(1)}
              maxLength={LONGUEURS_DE_LA_FICHE.delai}
              value={a.delai}
              onChange={(ev) => changer({ delai: ev.target.value })}
              className="text-[12.5px]"
            />,
            <CelluleDeTexte
              key="suivi"
              {...attrs(2)}
              max={LONGUEURS_DE_LA_FICHE.ligne}
              valeur={a.suivi}
              onChange={(suivi) => changer({ suivi })}
            />,
          ]}
          onChange={onChange ? (plan) => onChange((x) => ({ ...x, plan })) : undefined}
        />
      </SousPartie>
    </CarteDeLaFiche>
  );
}

// ──────────────────────────────────────────────── 5. les besoins de formation

/**
 * Les besoins et projets de formation, que remplit le N+1 (ADR-0272). Les
 * objectifs de l'année suivante ne se fixent plus pendant l'évaluation.
 */
function Formations({
  evaluation: e,
  onChange,
}: {
  evaluation: EvaluationDuN1;
  onChange?: MiseAJour;
}) {
  return (
    <CarteDeLaFiche
      titre="Besoins et projets de formation"
      chapeau="Les formations que le N+1 juge nécessaires."
      qui={PAR_LE_N1}
    >
      <div className="pt-2">
        <Tableau<FormationSouhaitee>
          nom="Formation"
          leNom="la formation"
          colonnes={['Formation souhaitée', 'Justification (lien avec le poste et les objectifs)']}
          gabarit="@[46rem]:grid-cols-[1.75rem_minmax(0,2.35fr)_minmax(0,3.2fr)_1.75rem]"
          lignes={e.formations}
          max={MAXIMUMS_DE_LA_FICHE.formations}
          ajouter="Ajouter une formation"
          vide={() => ({ intitule: '', justification: '' })}
          lecture={(f) => [f.intitule, f.justification]}
          saisie={(f, changer, attrs) => [
            <CelluleDeTexte
              key="intitule"
              {...attrs(0)}
              max={LONGUEURS_DE_LA_FICHE.ligne}
              valeur={f.intitule}
              onChange={(intitule) => changer({ intitule })}
            />,
            <CelluleDeTexte
              key="justification"
              {...attrs(1)}
              max={LONGUEURS_DE_LA_FICHE.ligne}
              valeur={f.justification}
              onChange={(justification) => changer({ justification })}
            />,
          ]}
          onChange={onChange ? (formations) => onChange((x) => ({ ...x, formations })) : undefined}
        />
      </div>
    </CarteDeLaFiche>
  );
}

// ──────────────────────────────────────────────── les tableaux

/** Ce qu'une case reçoit de son tableau : son identifiant, son nom pour les lecteurs d'écran. */
export interface AttributsDeCase {
  id: string;
  'aria-label': string;
  autoFocus?: boolean;
}

/** Une case de texte d'un tableau : une ligne, qui s'allonge avec ce qu'on y écrit. */
export function CelluleDeTexte({
  valeur,
  max,
  onChange,
  ...attrs
}: AttributsDeCase & { valeur: string; max: number; onChange: (texte: string) => void }) {
  return (
    <ZoneDeTexte
      {...attrs}
      rows={1}
      max={max}
      value={valeur}
      onChange={(ev) => onChange(ev.target.value)}
      className="min-h-10 py-2"
    />
  );
}

/**
 * Un tableau de la fiche à remplir, ligne par ligne : le plan d'action, les
 * formations, et les objectifs de l'année que fixe le N+1 (ADR-0274). Sur
 * une zone large, une ligne par entrée sous les titres des colonnes, comme
 * sur la fiche ; sur une zone étroite, chaque entrée s'empile, chaque case
 * sous son titre. Sans `onChange`, le tableau se lit ; vide, il dit
 * « Néant », comme le PDF. Avec un minimum, il montre d'emblée autant de
 * lignes à remplir, qui ne s'enregistrent qu'à la première frappe, et n'en
 * retire pas en dessous (ADR-0239). Avec `requises`, pendant la saisie, le
 * titre de chaque colonne porte l'astérisque d'un champ obligatoire.
 */
export function Tableau<L>({
  nom,
  leNom,
  colonnes,
  requises = false,
  gabarit,
  lignes: ecrites,
  min = 0,
  max,
  ajouter,
  vide,
  lecture,
  saisie,
  onChange,
}: {
  /** « Action » : le titre d'une entrée sur une zone étroite. */
  nom: string;
  /** « l'action » : pour retirer une entrée. */
  leNom: string;
  colonnes: readonly string[];
  /** Chaque case à remplir : son titre porte un astérisque pendant la saisie. */
  requises?: boolean;
  /** Les colonnes, sur une zone large : le numéro, les cases, le retrait. */
  gabarit: string;
  lignes: readonly L[];
  /** Les lignes que le tableau montre au moins pendant la saisie. */
  min?: number;
  max: number;
  ajouter: string;
  vide: () => L;
  lecture: (l: L) => string[];
  saisie: (
    l: L,
    changer: (maj: Partial<L>) => void,
    attrs: (colonne: number) => AttributsDeCase,
  ) => ReactNode[];
  onChange?: (lignes: L[]) => void;
}) {
  const uid = useId();
  // Pendant la saisie, des lignes vides jusqu'au minimum.
  const lignes: readonly L[] =
    onChange && ecrites.length < min
      ? [...ecrites, ...Array.from({ length: min - ecrites.length }, vide)]
      : ecrites;
  // Une clé par ligne, qui la suit quand une ligne au-dessus se retire.
  const suivante = useRef(lignes.length);
  const [cles, setCles] = useState(() => lignes.map((_, i) => i));
  const [nouvelle, setNouvelle] = useState<number | null>(null);
  const cleDe = (i: number) => (cles.length === lignes.length ? cles[i]! : i);
  const etoile =
    requises && onChange ? (
      <span aria-hidden className="text-danger">
        {' '}
        *
      </span>
    ) : null;

  if (!onChange && lignes.length === 0) {
    return <p className="px-5 pt-3 pb-5 text-[13px] text-ink-muted">Néant</p>;
  }

  const ajouterUneLigne = () => {
    const cle = suivante.current++;
    setCles((c) => [...c, cle]);
    setNouvelle(cle);
    onChange?.([...lignes, vide()]);
  };
  const retirer = (i: number) => {
    setCles((c) => c.filter((_, k) => k !== i));
    onChange?.(lignes.filter((_, k) => k !== i));
  };

  return (
    <div className="@container px-5 pt-3 pb-5">
      {lignes.length > 0 ? (
        <>
          <div
            aria-hidden
            className={cn('hidden gap-x-3 border-b border-line-soft pb-2 @[46rem]:grid', gabarit)}
          >
            <span className={TITRE_DE_COLONNE}>N°</span>
            {colonnes.map((c) => (
              <span key={c} className={TITRE_DE_COLONNE}>
                {c}
                {etoile}
              </span>
            ))}
          </div>
          <ol>
            {lignes.map((l, i) => {
              const cle = cleDe(i);
              const attrs = (colonne: number): AttributsDeCase => ({
                id: `${uid}-${cle}-${colonne}`,
                'aria-label': `${colonnes[colonne]}, ${nom.toLocaleLowerCase('fr')} ${i + 1}`,
                autoFocus: colonne === 0 && cle === nouvelle ? true : undefined,
              });
              const cases = onChange
                ? saisie(
                    l,
                    (maj) => onChange(lignes.map((x, k) => (k === i ? { ...x, ...maj } : x))),
                    attrs,
                  )
                : lecture(l).map((texte, k) => <CaseLue key={k} texte={texte} />);
              return (
                <li
                  key={cle}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 border-b border-line-soft py-3 last:border-b-0 @[46rem]:gap-y-0',
                    gabarit,
                  )}
                >
                  <p className="text-[10.5px] font-bold tracking-[0.12em] text-accent-text uppercase @[46rem]:pt-2.5 @[46rem]:text-[12.5px] @[46rem]:tracking-normal @[46rem]:text-ink-muted @[46rem]:tabular-nums">
                    <span className="@[46rem]:sr-only">{nom} </span>
                    {i + 1}
                  </p>
                  {cases.map((c, k) => (
                    <div key={k} className="col-span-2 min-w-0 @[46rem]:col-span-1">
                      <p
                        aria-hidden
                        className="mb-1 text-[12px] font-semibold text-ink-muted @[46rem]:hidden"
                      >
                        {colonnes[k]}
                        {etoile}
                      </p>
                      {c}
                    </div>
                  ))}
                  {onChange && lignes.length > min ? (
                    <button
                      type="button"
                      aria-label={`Retirer ${leNom} ${i + 1}`}
                      title="Retirer"
                      onClick={() => retirer(i)}
                      className="col-start-2 row-start-1 grid size-7 place-items-center self-start rounded-full text-ink-muted/70 transition-colors duration-150 outline-none hover:bg-hover hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/35 @[46rem]:col-start-auto @[46rem]:row-start-auto @[46rem]:mt-1.5"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {onChange && lignes.length < max ? (
        <BoutonAjouter
          libelle={ajouter}
          onClick={ajouterUneLigne}
          className={lignes.length > 0 ? 'mt-3' : undefined}
        />
      ) : null}
    </div>
  );
}

const TITRE_DE_COLONNE = 'text-[9.5px] font-bold tracking-[0.1em] text-ink-muted uppercase';

/** Une case d'un tableau en lecture. */
function CaseLue({ texte }: { texte: string }) {
  return texte.trim() ? (
    <p className="text-[13px] leading-relaxed break-words whitespace-pre-line text-ink-strong @[46rem]:pt-2">
      {texte.trim()}
    </p>
  ) : (
    <p className="text-[13px] text-ink-muted/70 @[46rem]:pt-2">Non renseigné</p>
  );
}

// ──────────────────────────────────────────────── 8. la partie réservée

/**
 * La partie strictement réservée à la hiérarchie : la synthèse générale et
 * les observations du N+1, puis les commentaires du N+2. Chaque partie dit
 * qui l'écrit, comme sur la fiche.
 */
function Reservee({
  reservee: r,
  commentairesDuN2,
  onChange,
}: {
  reservee: PartieReservee;
  commentairesDuN2?: ReactNode;
  onChange?: (maj: Partial<PartieReservee>) => void;
}) {
  const choisir = (cle: 'comprehension' | 'tenue', niveau: Niveau | null) =>
    onChange?.(cle === 'comprehension' ? { comprehension: niveau } : { tenue: niveau });
  return (
    <CarteDeLaFiche
      titre="Partie strictement réservée à la hiérarchie"
      icone="lock"
      // Avec les commentaires du N+2, la carte a deux auteurs : chaque partie
      // dit le sien.
      qui={commentairesDuN2 ? undefined : PAR_LE_N1}
    >
      <SousPartie titre="Synthèse générale du N+1">
        <div className="flex flex-col gap-5 px-5 pt-4 pb-5">
          {SYNTHESE_GENERALE.map((c) => {
            const niveau = r[c.cle];
            return onChange ? (
              <div key={c.cle}>
                <Libelle requise>{c.intitule}</Libelle>
                <ChoixDeNiveau
                  legende={c.intitule}
                  valeur={niveau}
                  libelles={c.niveaux}
                  onChange={(n) => choisir(c.cle, n)}
                />
              </div>
            ) : (
              <div key={c.cle}>
                <LibelleLu>{c.intitule}</LibelleLu>
                <NiveauDonne niveau={niveau} libelle={niveau ? c.niveaux[niveau] : undefined} />
              </div>
            );
          })}
        </div>
      </SousPartie>
      <SousPartie titre="Observations du N+1">
        <div className="px-5 pt-3 pb-5">
          {onChange ? (
            <ZoneDeTexte
              aria-label="Observations du N+1"
              max={LONGUEURS_DE_LA_FICHE.texte}
              value={r.observations}
              onChange={(ev) => onChange({ observations: ev.target.value })}
            />
          ) : (
            <TexteLu texte={r.observations} />
          )}
        </div>
      </SousPartie>
      {commentairesDuN2 ? (
        <SousPartie titre="Commentaires du N+2">
          <div className="px-5 pt-3 pb-5">{commentairesDuN2}</div>
        </SousPartie>
      ) : null}
    </CarteDeLaFiche>
  );
}

/**
 * Les commentaires du N+2, en lecture, et dessous qui les a transmis, et
 * quand, comme la signature de la fiche. Sans un mot, la fiche porte
 * « Néant », comme le PDF.
 */
export function CommentairesDuN2Lus({
  texte,
  par,
  le,
}: {
  texte: string;
  par?: PersonneDeLaCampagne | null;
  le?: string | null;
}) {
  return (
    <>
      {texte.trim() ? (
        <TexteLu texte={texte} />
      ) : (
        <p className="text-[13px] text-ink-muted">Néant</p>
      )}
      {par && le ? (
        <p className="mt-2.5 text-[12px] text-ink-muted">
          {par.prenom} {par.nom}, le {dateEnLettres(le)}
        </p>
      ) : null}
    </>
  );
}
