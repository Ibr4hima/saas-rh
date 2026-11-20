'use client';

import { useId, type ReactNode } from 'react';
import {
  LONGUEURS_DE_LA_FICHE,
  NIVEAUX_D_ATTEINTE,
  NIVEAUX,
  QUESTIONS_DES_SOUHAITS,
  QUESTIONS_DU_BILAN,
  type AppreciationDeLAgent,
  type AutoEvaluation,
  type Niveau,
  type ObjectifEvalue,
} from '@teranga/contracts';
import { Card, CardHeader, CardTitle, cn, Field } from '@teranga/ui';
import { ChoixDeNiveau, NiveauDonne, ZoneDeTexte } from '../grille-evaluation';
import { Icon, type IconName } from '../icons';
import type { Changement } from './enregistrement';

/* ────────────────────────────────────────────────────────────────
   L'auto-évaluation sur la fiche S1/EN05 (ADR-0215) : ce que l'agent
   remplit, dans l'ordre de la fiche, avec les questions de la DCH mot pour
   mot (contrats, entretien-annuel.ts). Trois cartes : le récapitulatif de
   l'année, l'évaluation des résultats (chaque objectif, puis les autres
   réalisations), les préoccupations et les souhaits. La même forme se lit
   une fois transmise. Les pièces servent aussi la fiche du N+1 (ADR-0216).
   ──────────────────────────────────────────────────────────────── */

/** Les niveaux d'atteinte d'un objectif, en un mot : « Dépassé », « Réalisé »… */
export const LIBELLES_D_ATTEINTE = Object.fromEntries(
  NIVEAUX.map((n) => [n, NIVEAUX_D_ATTEINTE[n].libelle]),
) as Record<Niveau, string>;

/** Qui remplit une partie de la fiche, comme le dit le PDF. */
export const PAR_L_AGENT = 'Rempli par l’agent';
export const PAR_LE_N1 = 'Rempli par le N+1';

const MAX = LONGUEURS_DE_LA_FICHE.texte;

/** Les réponses en toutes lettres de l'auto-évaluation : tout, sauf les objectifs. */
type CleDeTexte = Exclude<keyof AutoEvaluation, 'objectifs'>;

/** Les questions de la carte « Préoccupations et souhaits », avec « Autres commentaires ». */
const SOUHAITS: readonly { cle: CleDeTexte; question: string }[] = [
  ...QUESTIONS_DES_SOUHAITS.map((q) => ({
    cle: q.cle,
    question: 'precision' in q ? `${q.question} (${q.precision})` : q.question,
  })),
  { cle: 'autresCommentaires', question: 'Autres commentaires' },
];

const appreciationVide = (): AppreciationDeLAgent => ({
  niveau: null,
  resultats: '',
  commentaire: '',
});

/**
 * Une carte de la fiche : son titre, qui la remplit, une phrase qui
 * l'introduit s'il y a lieu, son contenu.
 */
export function CarteDeLaFiche({
  titre,
  icone,
  qui,
  chapeau,
  children,
}: {
  titre: string;
  /** Une icône devant le titre : le cadenas de la partie réservée. */
  icone?: IconName;
  /** « Rempli par l'agent », « Rempli par le N+1 ». */
  qui?: string;
  chapeau?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-line-soft">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <CardTitle className="flex items-center gap-1.5">
            {icone ? <Icon name={icone} size={14} className="-mt-px" /> : null}
            {titre}
          </CardTitle>
          {qui ? <p className="text-[11.5px] font-semibold text-ink-muted">{qui}</p> : null}
        </div>
        {chapeau ? <div className="mt-1.5 text-[12.5px] text-ink-muted">{chapeau}</div> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/**
 * Des questions deux par deux sur un grand écran, une par ligne ailleurs.
 * Chacune occupe trois rangées que sa voisine partage (`subgrid`) :
 * l'intitulé, la réponse, la place du compteur. Un intitulé sur deux lignes
 * ne décale donc pas la zone d'à côté, comme dans les fiches de la DCH.
 */
export function DeuxParDeux({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-5 px-5 pt-5 *:row-span-3 *:grid *:grid-rows-subgrid *:items-start *:pb-5 lg:grid-cols-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** L'intitulé d'un objectif et ses indicateurs, comme sur la fiche. */
export function EnTeteDeLObjectif({
  objectif: o,
  rang,
}: {
  objectif: ObjectifEvalue;
  rang: number;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-bold tracking-[0.12em] text-accent-text uppercase">
        Objectif {rang}
      </p>
      <p className="mt-1.5 text-[14px] leading-snug font-bold text-ink-strong">{o.intitule}</p>
      {o.indicateurs ? (
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          <span className="font-semibold">Indicateurs : </span>
          {o.indicateurs}
        </p>
      ) : null}
    </div>
  );
}

/** Une question et sa zone de réponse, qui grandit avec le texte. */
export function Question({
  question,
  requise = false,
  large = false,
  valeur,
  onChange,
}: {
  question: string;
  requise?: boolean;
  /** Sur toute la largeur de la grille. */
  large?: boolean;
  valeur: string;
  onChange: (texte: string) => void;
}) {
  const id = useId();
  return (
    <Field
      label={question}
      htmlFor={id}
      required={requise}
      className={cn(large && 'lg:col-span-2')}
    >
      <ZoneDeTexte id={id} max={MAX} value={valeur} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/**
 * Le formulaire de l'auto-évaluation. Obligatoires, et marqués d'un
 * astérisque : les deux questions du récapitulatif, puis, pour chaque
 * objectif, son niveau et ses résultats obtenus (ADR-0215).
 */
export function SaisieDeLAuto({
  annee,
  objectifs,
  auto,
  onChange,
}: {
  annee: number;
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
  onChange: Changement<AutoEvaluation>;
}) {
  const texte = (cle: CleDeTexte) => (v: string) => onChange((a) => ({ ...a, [cle]: v }));
  const objectif =
    (id: string) =>
    (maj: Partial<AppreciationDeLAgent>): void =>
      onChange((a) => ({
        ...a,
        objectifs: {
          ...a.objectifs,
          [id]: { ...appreciationVide(), ...a.objectifs[id], ...maj },
        },
      }));

  return (
    <>
      <CarteDeLaFiche titre="Récapitulatif et faits marquants">
        <DeuxParDeux>
          {QUESTIONS_DU_BILAN.map((q) => (
            <Question
              key={q.cle}
              question={q.question}
              requise
              valeur={auto[q.cle]}
              onChange={texte(q.cle)}
            />
          ))}
        </DeuxParDeux>
      </CarteDeLaFiche>

      <CarteDeLaFiche
        titre="Évaluation des résultats"
        chapeau={`L’atteinte des objectifs fixés pour ${annee}.`}
      >
        {objectifs.length === 0 ? (
          <AucunObjectif />
        ) : (
          <ol>
            {objectifs.map((o, i) => {
              const a = auto.objectifs[o.id] ?? appreciationVide();
              const changer = objectif(o.id);
              return (
                <li key={o.id} className="flex flex-col gap-4 border-b border-line-soft px-5 py-5">
                  <EnTeteDeLObjectif objectif={o} rang={i + 1} />
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-ink-strong">
                      Niveau<span className="text-danger"> *</span>
                    </p>
                    <ChoixDeNiveau
                      legende={`Niveau de l’objectif ${i + 1}`}
                      valeur={a.niveau}
                      libelles={LIBELLES_D_ATTEINTE}
                      court
                      onChange={(niveau) => changer({ niveau })}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Question
                      question="Résultats obtenus"
                      requise
                      valeur={a.resultats}
                      onChange={(resultats) => changer({ resultats })}
                    />
                    <Question
                      question="Commentaire"
                      valeur={a.commentaire}
                      onChange={(commentaire) => changer({ commentaire })}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="px-5 py-5">
          <Question
            question="Autres réalisations en dehors des objectifs"
            valeur={auto.autresRealisations}
            onChange={texte('autresRealisations')}
          />
        </div>
      </CarteDeLaFiche>

      <CarteDeLaFiche titre="Préoccupations et souhaits">
        <DeuxParDeux>
          {SOUHAITS.map((q) => (
            <Question
              key={q.cle}
              question={q.question}
              large={q.cle === 'autresCommentaires'}
              valeur={auto[q.cle]}
              onChange={texte(q.cle)}
            />
          ))}
        </DeuxParDeux>
      </CarteDeLaFiche>
    </>
  );
}

/** Une réponse en lecture : la question, petite et grise, puis le texte. */
export function Reponse({
  question,
  texte,
  large = false,
}: {
  question: string;
  texte: string;
  large?: boolean;
}) {
  return (
    <div className={cn(large && 'lg:col-span-2')}>
      <p className="text-[12.5px] font-semibold text-ink-muted">{question}</p>
      {texte.trim() ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
          {texte.trim()}
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-muted/70">Non renseigné</p>
      )}
    </div>
  );
}

/** Le récapitulatif de l'année, en lecture. */
export function RecapitulatifEnLecture({ auto, qui }: { auto: AutoEvaluation; qui?: string }) {
  return (
    <CarteDeLaFiche titre="Récapitulatif et faits marquants" qui={qui}>
      <DeuxParDeux>
        {QUESTIONS_DU_BILAN.map((q) => (
          <Reponse key={q.cle} question={q.question} texte={auto[q.cle]} />
        ))}
      </DeuxParDeux>
    </CarteDeLaFiche>
  );
}

/** Ce que l'agent dit d'un objectif, en lecture : le niveau, les résultats obtenus, le commentaire. */
export function AppreciationDeLAgentEnLecture({
  appreciation,
  colonnes = true,
}: {
  appreciation: AppreciationDeLAgent | undefined;
  /** Les résultats et le commentaire côte à côte sur un grand écran. */
  colonnes?: boolean;
}) {
  const a = appreciation ?? appreciationVide();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">Niveau</p>
        <NiveauDonne
          niveau={a.niveau}
          libelle={a.niveau ? LIBELLES_D_ATTEINTE[a.niveau] : undefined}
        />
      </div>
      <div className={cn('grid grid-cols-1 gap-4', colonnes && 'lg:grid-cols-2')}>
        <Reponse question="Résultats obtenus" texte={a.resultats} />
        <Reponse question="Commentaire" texte={a.commentaire} />
      </div>
    </div>
  );
}

/** Les préoccupations et les souhaits de l'agent, en lecture. */
export function SouhaitsEnLecture({ auto, qui }: { auto: AutoEvaluation; qui?: string }) {
  return (
    <CarteDeLaFiche titre="Préoccupations et souhaits" qui={qui}>
      <DeuxParDeux>
        {SOUHAITS.map((q) => (
          <Reponse
            key={q.cle}
            question={q.question}
            texte={auto[q.cle]}
            large={q.cle === 'autresCommentaires'}
          />
        ))}
      </DeuxParDeux>
    </CarteDeLaFiche>
  );
}

/** L'auto-évaluation en lecture : la même forme que le formulaire, les réponses à la place des zones. */
export function AutoEvaluationEnLecture({
  annee,
  objectifs,
  auto,
}: {
  annee: number;
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
}) {
  return (
    <>
      <RecapitulatifEnLecture auto={auto} />

      <CarteDeLaFiche
        titre="Évaluation des résultats"
        chapeau={`L’atteinte des objectifs fixés pour ${annee}.`}
      >
        {objectifs.length === 0 ? (
          <AucunObjectif />
        ) : (
          <ol>
            {objectifs.map((o, i) => (
              <li key={o.id} className="flex flex-col gap-4 border-b border-line-soft px-5 py-5">
                <EnTeteDeLObjectif objectif={o} rang={i + 1} />
                <AppreciationDeLAgentEnLecture appreciation={auto.objectifs[o.id]} />
              </li>
            ))}
          </ol>
        )}
        <AutresRealisationsEnLecture auto={auto} />
      </CarteDeLaFiche>

      <SouhaitsEnLecture auto={auto} />
    </>
  );
}

/** La fiche d'un agent sans objectif fixé pour l'année. */
export function AucunObjectif() {
  return (
    <p className="px-5 py-5 text-[13px] text-ink-muted">
      Aucun objectif n’a été fixé pour cette année.
    </p>
  );
}

/** Les autres réalisations de l'agent, en lecture, au bas de l'évaluation des résultats. */
export function AutresRealisationsEnLecture({ auto }: { auto: AutoEvaluation }) {
  return (
    <div className="px-5 py-5">
      <Reponse
        question="Autres réalisations en dehors des objectifs"
        texte={auto.autresRealisations}
      />
    </div>
  );
}
