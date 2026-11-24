'use client';

import { useId } from 'react';
import {
  moyenneEnChiffres,
  NIVEAUX,
  NOTE_DE_LA_LETTRE,
  NOTE_MAXIMALE,
  NOTES_D_ATTEINTE,
  releveDesObjectifs,
  type AutoEvaluation,
  type EvaluationDuN1,
  type Niveau,
  type NoteDObjectif,
  type ObjectifEvalue,
} from '@teranga/contracts';
import { cn, Table, TBody, Td, Th, THead, Tr } from '@teranga/ui';
import { ChoixDeNiveau, NiveauDonne } from '../grille-evaluation';

/* ────────────────────────────────────────────────────────────────
   Les notes des objectifs, de 0 à 3 (ADR-0275), à la place des lettres A à
   D : l'agent note chaque objectif dans son auto-évaluation, le N+1 après
   l'entretien. Chaque note garde la couleur de la lettre qu'elle remplace :
   3 en vert comme A, jusqu'à 0 en rouge comme D. Sous les objectifs, le
   relevé des notes obtenues, comme celui de l'ancienne grille du personnel
   non cadre : la note de chaque objectif, puis la moyenne, sur 3.
   ──────────────────────────────────────────────────────────────── */

/** La lettre dont chaque note prend la couleur. */
const LETTRE_DE_LA_NOTE: Record<NoteDObjectif, Niveau> = { 3: 'A', 2: 'B', 1: 'C', 0: 'D' };

/** Ce que dit chaque note, rangé sous sa lettre : « Dépassé » sous A, pour la note 3. */
const LIBELLES = Object.fromEntries(
  NIVEAUX.map((n) => [n, NOTES_D_ATTEINTE[NOTE_DE_LA_LETTRE[n]].libelle]),
) as Record<Niveau, string>;

/** La note dans la pastille de sa lettre : 3 pour A, 0 pour D. */
const MARQUES = Object.fromEntries(NIVEAUX.map((n) => [n, String(NOTE_DE_LA_LETTRE[n])])) as Record<
  Niveau,
  string
>;

/** Les quatre notes d'un objectif, de 3 à 0, à cocher : chacune avec ce qu'elle veut dire. */
export function ChoixDeLaNote({
  legende,
  valeur,
  onChange,
}: {
  legende: string;
  valeur: NoteDObjectif | null;
  onChange: (note: NoteDObjectif | null) => void;
}) {
  return (
    <ChoixDeNiveau
      legende={legende}
      valeur={valeur === null ? null : LETTRE_DE_LA_NOTE[valeur]}
      libelles={LIBELLES}
      marques={MARQUES}
      court
      onChange={(n) => onChange(n === null ? null : NOTE_DE_LA_LETTRE[n])}
    />
  );
}

/** Une note donnée, en lecture : le chiffre dans sa pastille, puis ce qu'il veut dire. */
export function NoteDonnee({ note }: { note: NoteDObjectif | null }) {
  if (note === null) return <NiveauDonne niveau={null} />;
  return (
    <NiveauDonne
      niveau={LETTRE_DE_LA_NOTE[note]}
      libelle={NOTES_D_ATTEINTE[note].libelle}
      marque={String(note)}
    />
  );
}

/**
 * Le relevé des notes obtenues, sous les objectifs : la note de chaque
 * objectif, puis la moyenne, sur 3, une fois chaque objectif noté ; avant,
 * des points de suspension tiennent la place. Avec `evaluation`, deux
 * colonnes, l'auto-évaluation et le N+1 ; sans, la note de l'agent seule,
 * dans son auto-évaluation. Il suit la saisie.
 */
export function ReleveDesNotes({
  objectifs,
  auto,
  evaluation = null,
}: {
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
  evaluation?: EvaluationDuN1 | null;
}) {
  const id = useId();
  if (objectifs.length === 0) return null;
  const { lignes, moyennes } = releveDesObjectifs(objectifs, auto, evaluation);
  const avecLeN1 = evaluation !== null;
  const serre = 'max-sm:px-2.5';
  const attente = <span className="text-ink-muted/60">…</span>;
  const note = (n: NoteDObjectif | null) => (n === null ? attente : n);
  const moyenne = (m: number | null) => (
    <>
      {m === null ? attente : moyenneEnChiffres(m)} / {NOTE_MAXIMALE}
    </>
  );
  // La note qui compte en dernier, celle du N+1, ressort ; sans N+1, celle de l'agent.
  const forte = 'font-semibold text-ink-strong';
  return (
    <section aria-labelledby={id} className="border-b border-line-soft px-5 py-5">
      <h3 id={id} className="mb-3 text-[13.5px] leading-snug font-bold text-ink-strong">
        Relevé des notes obtenues
      </h3>
      <div className="rounded-bloc border border-line">
        <Table>
          <THead>
            <tr>
              <Th className={serre}>Objectif</Th>
              <Th className={cn(serre, 'text-right')}>
                {avecLeN1 ? (
                  <>
                    <span className="sm:hidden">Agent</span>
                    <span className="max-sm:hidden">Auto-évaluation</span>
                  </>
                ) : (
                  'Note'
                )}
              </Th>
              {avecLeN1 ? <Th className={cn(serre, 'text-right')}>N+1</Th> : null}
            </tr>
          </THead>
          <TBody>
            {lignes.map((l, i) => (
              <Tr key={l.objectif.id}>
                <Td className={cn(serre, 'text-ink-strong')}>
                  <span className="text-ink-muted tabular-nums">{i + 1}.</span>{' '}
                  {l.objectif.intitule}
                </Td>
                <Td className={cn(serre, 'text-right tabular-nums', !avecLeN1 && forte)}>
                  {note(l.agent)}
                </Td>
                {avecLeN1 ? (
                  <Td className={cn(serre, 'text-right tabular-nums', forte)}>{note(l.n1)}</Td>
                ) : null}
              </Tr>
            ))}
            <tr className="border-t border-line">
              <Td className={cn(serre, 'font-bold text-ink-strong')}>Moyenne</Td>
              <Td
                className={cn(
                  serre,
                  'text-right whitespace-nowrap tabular-nums',
                  avecLeN1 ? 'font-semibold text-ink' : 'font-bold text-ink-strong',
                )}
              >
                {moyenne(moyennes.agent)}
              </Td>
              {avecLeN1 ? (
                <Td
                  className={cn(
                    serre,
                    'text-right font-bold whitespace-nowrap text-ink-strong tabular-nums',
                  )}
                >
                  {moyenne(moyennes.n1)}
                </Td>
              ) : null}
            </tr>
          </TBody>
        </Table>
      </div>
    </section>
  );
}
