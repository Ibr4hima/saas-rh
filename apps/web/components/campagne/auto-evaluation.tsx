'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  LONGUEURS_DE_LA_FICHE,
  NIVEAUX_D_ATTEINTE,
  NIVEAUX,
  pucesDe,
  QUESTIONS_DES_SOUHAITS,
  QUESTIONS_DU_BILAN,
  type AppreciationDeLAgent,
  type AutoEvaluation,
  type ChoixDeLAuto,
  type Niveau,
  type ObjectifEvalue,
} from '@teranga/contracts';
import { Card, cn, Field } from '@teranga/ui';
import { insecables } from '../../lib/mots';
import { ChoixDeNiveau, NiveauDonne, ZoneDeTexte } from '../grille-evaluation';
import { type IconName } from '../icons';
import { OuiNon } from '../saisie-de-fiche';
import { TitreDeSection } from './charte';
import type { Changement } from './enregistrement';
import { ListeAPuces } from './liste-a-puces';

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

/** Les réponses en toutes lettres de l'auto-évaluation : tout, sauf les objectifs et les choix. */
type CleDeTexte = Exclude<keyof AutoEvaluation, 'objectifs' | ChoixDeLAuto>;

/**
 * Une question de la fiche et sa forme : du texte, des puces, ou oui ou non
 * puis des puces (ADR-0238).
 */
interface QuestionDeLaFiche {
  cle: CleDeTexte;
  question: string;
  requise: boolean;
  enPuces: boolean;
  /** Le choix oui ou non qui ouvre les puces. */
  choix?: ChoixDeLAuto;
}

const enQuestion = (
  q: (typeof QUESTIONS_DU_BILAN)[number] | (typeof QUESTIONS_DES_SOUHAITS)[number],
): QuestionDeLaFiche => ({
  cle: q.cle,
  question: 'precision' in q ? `${q.question} (${q.precision})` : q.question,
  requise: true,
  enPuces: 'puces' in q || 'ouiNon' in q,
  ...('ouiNon' in q ? { choix: q.ouiNon } : {}),
});

/** Les questions du récapitulatif, toutes obligatoires. */
const BILAN: readonly QuestionDeLaFiche[] = QUESTIONS_DU_BILAN.map(enQuestion);

/**
 * Les questions de la carte « Préoccupations et souhaits », obligatoires,
 * puis « Autres commentaires », qui ne l'est pas (ADR-0238).
 */
const SOUHAITS: readonly QuestionDeLaFiche[] = [
  ...QUESTIONS_DES_SOUHAITS.map(enQuestion),
  { cle: 'autresCommentaires', question: 'Autres commentaires', requise: false, enPuces: false },
];

const appreciationVide = (): AppreciationDeLAgent => ({
  niveau: null,
  resultats: '',
  commentaire: '',
});

/**
 * Une partie de la fiche : son titre en Anton, comme les sections de
 * l'accueil, au-dessus de sa carte (ADR-0233) ; à droite, qui la remplit ;
 * dessous, une phrase qui l'introduit s'il y a lieu. Puis son contenu, dans
 * la carte. Une partie qui en suit une autre s'en écarte un peu plus que
 * les blocs de la page.
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
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 [&:not(:first-child)]:mt-5">
      <TitreDeSection
        id={id}
        icone={icone}
        chapeau={chapeau}
        droite={
          qui ? <span className="text-[12px] font-semibold text-ink-muted">{qui}</span> : undefined
        }
      >
        {titre}
      </TitreDeSection>
      <Card>{children}</Card>
    </section>
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
      label={insecables(question)}
      htmlFor={id}
      required={requise}
      className={cn(large && 'lg:col-span-2')}
    >
      <ZoneDeTexte id={id} max={MAX} value={valeur} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Une question qui se répond en puces, une par ligne (ADR-0238). */
export function QuestionEnPuces({
  question,
  requise = false,
  valeur,
  onChange,
}: {
  question: string;
  requise?: boolean;
  valeur: string;
  onChange: (texte: string) => void;
}) {
  const id = useId();
  return (
    <Field label={insecables(question)} htmlFor={id} required={requise}>
      <ListeAPuces id={id} libelle={question} valeur={valeur} onChange={onChange} max={MAX} />
    </Field>
  );
}

/**
 * Une question qui se répond d'abord par oui ou par non, obligatoirement
 * (ADR-0238). Sur un oui, la réponse en puces s'ouvre, le curseur dans sa
 * première puce ; sur un non, elle se replie.
 */
export function QuestionOuiNon({
  question,
  oui,
  onChoisir,
  valeur,
  onChange,
}: {
  question: string;
  oui: boolean | null;
  onChoisir: (oui: boolean) => void;
  valeur: string;
  onChange: (texte: string) => void;
}) {
  const id = useId();
  // Ouverte d'un clic sur « Oui » : le curseur y va ; rouverte avec la page, non.
  const [ouverteALInstant, setOuverteALInstant] = useState(false);
  return (
    <Field label={insecables(question)} htmlFor={oui ? id : undefined} required>
      <div className="flex flex-col gap-3">
        <div className="w-full max-w-56">
          <OuiNon
            libelle={question}
            oui={oui}
            onChoisir={(choix) => {
              setOuverteALInstant(choix);
              onChoisir(choix);
            }}
          />
        </div>
        {oui ? (
          <ListeAPuces
            id={id}
            libelle={question}
            valeur={valeur}
            onChange={onChange}
            max={MAX}
            autoFocus={ouverteALInstant}
          />
        ) : null}
      </div>
    </Field>
  );
}

/** La zone d'une question, selon sa forme : du texte, des puces, ou oui ou non puis des puces. */
function ChampDeLaQuestion({
  q,
  auto,
  onChange,
}: {
  q: QuestionDeLaFiche;
  auto: AutoEvaluation;
  onChange: Changement<AutoEvaluation>;
}) {
  const texte = (v: string) => onChange((a) => ({ ...a, [q.cle]: v }));
  const choix = q.choix;
  if (choix) {
    return (
      <QuestionOuiNon
        question={q.question}
        oui={auto[choix]}
        onChoisir={(oui) => onChange((a) => ({ ...a, [choix]: oui }))}
        valeur={auto[q.cle]}
        onChange={texte}
      />
    );
  }
  if (q.enPuces) {
    return (
      <QuestionEnPuces
        question={q.question}
        requise={q.requise}
        valeur={auto[q.cle]}
        onChange={texte}
      />
    );
  }
  return (
    <Question
      question={q.question}
      requise={q.requise}
      large={q.cle === 'autresCommentaires'}
      valeur={auto[q.cle]}
      onChange={texte}
    />
  );
}

/**
 * Le formulaire de l'auto-évaluation. Obligatoires, et marqués d'un
 * astérisque : les deux questions du récapitulatif, pour chaque objectif son
 * niveau et ses résultats obtenus (ADR-0215), et les questions des
 * préoccupations et des souhaits, sauf « Autres commentaires » (ADR-0238).
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
          {BILAN.map((q) => (
            <ChampDeLaQuestion key={q.cle} q={q} auto={auto} onChange={onChange} />
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
            <ChampDeLaQuestion key={q.cle} q={q} auto={auto} onChange={onChange} />
          ))}
        </DeuxParDeux>
      </CarteDeLaFiche>
    </>
  );
}

const TEXTE_LU = 'text-[13.5px] leading-relaxed break-words text-ink-strong';

/**
 * Une réponse en lecture : la question, petite et grise, puis le texte, ses
 * puces, ou le oui ou le non d'une question à choix et ses puces (ADR-0238).
 * Dans une grille deux par deux, la question et la réponse tiennent chacune
 * leur rangée, que la voisine partage (`subgrid`) : la réponse forme un seul
 * bloc, le oui et ses puces ensemble, sans quoi les puces tomberaient sous
 * la réponse d'à côté (ADR-0259).
 */
export function Reponse({
  question,
  texte,
  large = false,
  enPuces = false,
  choix,
}: {
  question: string;
  texte: string;
  large?: boolean;
  /** Une puce par ligne. */
  enPuces?: boolean;
  /** Le oui ou le non d'une question à choix ; `null` : aucun choix, comme sur une fiche d'avant. */
  choix?: boolean | null;
}) {
  const puces = pucesDe(texte);
  let reponse: ReactNode;
  if (choix === false) {
    reponse = <p className={TEXTE_LU}>Non</p>;
  } else if (choix === true) {
    reponse = (
      <>
        <p className={TEXTE_LU}>Oui</p>
        {puces.length > 0 ? <Puces puces={puces} className="mt-1" /> : null}
      </>
    );
  } else if (enPuces && puces.length > 0) {
    reponse = <Puces puces={puces} />;
  } else if (texte.trim()) {
    reponse = <p className={cn(TEXTE_LU, 'whitespace-pre-line')}>{texte.trim()}</p>;
  } else {
    reponse = <p className="text-[13px] text-ink-muted/70">Non renseigné</p>;
  }
  return (
    <div className={cn(large && 'lg:col-span-2')}>
      <p className="text-[12.5px] font-semibold text-ink-muted">{insecables(question)}</p>
      <div className="mt-1.5">{reponse}</div>
    </div>
  );
}

/**
 * Les puces d'une réponse, en lecture : le point au bord gauche de la
 * réponse, comme les puces de la période (ADR-0259).
 */
function Puces({ puces, className }: { puces: readonly string[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {puces.map((p, i) => (
        <li key={i} className={cn(TEXTE_LU, 'flex gap-2.5')}>
          <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-ink-muted/60" />
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ul>
  );
}

/** Une question de la fiche en lecture, selon sa forme. */
function ReponseALaQuestion({ q, auto }: { q: QuestionDeLaFiche; auto: AutoEvaluation }) {
  return (
    <Reponse
      question={q.question}
      texte={auto[q.cle]}
      large={q.cle === 'autresCommentaires'}
      enPuces={q.enPuces}
      choix={q.choix ? auto[q.choix] : undefined}
    />
  );
}

/** Le récapitulatif de l'année, en lecture. */
export function RecapitulatifEnLecture({ auto, qui }: { auto: AutoEvaluation; qui?: string }) {
  return (
    <CarteDeLaFiche titre="Récapitulatif et faits marquants" qui={qui}>
      <DeuxParDeux>
        {BILAN.map((q) => (
          <ReponseALaQuestion key={q.cle} q={q} auto={auto} />
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
          <ReponseALaQuestion key={q.cle} q={q} auto={auto} />
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
