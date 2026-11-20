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

/* ────────────────────────────────────────────────────────────────
   L'auto-évaluation sur la fiche S1/EN05 (ADR-0215) : ce que l'agent
   remplit, dans l'ordre de la fiche, avec les questions de la DCH mot pour
   mot (contrats, entretien-annuel.ts). Trois cartes : le récapitulatif de
   l'année, l'évaluation des résultats (chaque objectif, puis les autres
   réalisations), les préoccupations et les souhaits. La même forme se lit
   une fois transmise, par l'agent comme par son N+1.
   ──────────────────────────────────────────────────────────────── */

/** Les niveaux d'atteinte d'un objectif, en un mot : « Dépassé », « Réalisé »… */
const LIBELLES_D_ATTEINTE = Object.fromEntries(
  NIVEAUX.map((n) => [n, NIVEAUX_D_ATTEINTE[n].libelle]),
) as Record<Niveau, string>;

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

/** Une carte de la fiche : son titre, une phrase qui l'introduit s'il y a lieu, son contenu. */
function CarteDeLaFiche({
  titre,
  chapeau,
  children,
}: {
  titre: string;
  chapeau?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-line-soft">
        <CardTitle>{titre}</CardTitle>
        {chapeau ? <p className="mt-1.5 text-[12.5px] text-ink-muted">{chapeau}</p> : null}
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
function DeuxParDeux({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 *:row-span-3 *:grid *:grid-rows-subgrid *:items-start *:pb-5 lg:grid-cols-2">
      {children}
    </div>
  );
}

/** L'intitulé d'un objectif et ses indicateurs, comme sur la fiche. */
function EnTeteDeLObjectif({ objectif: o, rang }: { objectif: ObjectifEvalue; rang: number }) {
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
function Question({
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

/** Ce qui change dans une auto-évaluation : le dernier état, une modification à la fois. */
export type ChangementDeLAuto = (maj: (a: AutoEvaluation) => AutoEvaluation) => void;

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
  onChange: ChangementDeLAuto;
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
          <p className="px-5 py-5 text-[13px] text-ink-muted">
            Aucun objectif n’a été fixé pour cette année.
          </p>
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
function Reponse({
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
      <CarteDeLaFiche titre="Récapitulatif et faits marquants">
        <DeuxParDeux>
          {QUESTIONS_DU_BILAN.map((q) => (
            <Reponse key={q.cle} question={q.question} texte={auto[q.cle]} />
          ))}
        </DeuxParDeux>
      </CarteDeLaFiche>

      <CarteDeLaFiche
        titre="Évaluation des résultats"
        chapeau={`L’atteinte des objectifs fixés pour ${annee}.`}
      >
        {objectifs.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-ink-muted">
            Aucun objectif n’a été fixé pour cette année.
          </p>
        ) : (
          <ol>
            {objectifs.map((o, i) => {
              const a = auto.objectifs[o.id] ?? appreciationVide();
              return (
                <li key={o.id} className="flex flex-col gap-4 border-b border-line-soft px-5 py-5">
                  <EnTeteDeLObjectif objectif={o} rang={i + 1} />
                  <div>
                    <p className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">Niveau</p>
                    <NiveauDonne
                      niveau={a.niveau}
                      libelle={a.niveau ? LIBELLES_D_ATTEINTE[a.niveau] : undefined}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Reponse question="Résultats obtenus" texte={a.resultats} />
                    <Reponse question="Commentaire" texte={a.commentaire} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="px-5 py-5">
          <Reponse
            question="Autres réalisations en dehors des objectifs"
            texte={auto.autresRealisations}
          />
        </div>
      </CarteDeLaFiche>

      <CarteDeLaFiche titre="Préoccupations et souhaits">
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
    </>
  );
}
