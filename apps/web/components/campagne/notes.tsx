'use client';

import { useId } from 'react';
import {
  arrondiPossible,
  LONGUEURS_DE_LA_FICHE,
  MOYENNE_D_ATTEINTE,
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
import { Checkbox, cn, Field, Table, TBody, Td, Th, THead, Tr } from '@teranga/ui';
import { ChoixDeNiveau, NiveauDonne, ZoneDeTexte } from '../grille-evaluation';

/* ────────────────────────────────────────────────────────────────
   Les notes des objectifs, de 1 à 4 (ADR-0275, ADR-0276), à la place des
   lettres A à D : l'agent note chaque objectif dans son auto-évaluation, le
   N+1 après l'entretien. Chaque note garde la couleur de la lettre qu'elle
   remplace : 4 en vert comme A, jusqu'à 1 en rouge comme D. Sous les
   objectifs, le relevé des notes obtenues, comme celui de l'ancienne grille
   du personnel non cadre : la note de chaque objectif, puis la moyenne, sur
   4. Une moyenne de 2 atteint les objectifs de l'année ; de 1,5 à moins de
   2, le N+1 peut l'arrondir à 2, en le justifiant.
   ──────────────────────────────────────────────────────────────── */

/** La lettre dont chaque note prend la couleur. */
const LETTRE_DE_LA_NOTE: Record<NoteDObjectif, Niveau> = { 4: 'A', 3: 'B', 2: 'C', 1: 'D' };

/** Ce que dit chaque note, rangé sous sa lettre : « Dépassé » sous A, pour la note 4. */
const LIBELLES = Object.fromEntries(
  NIVEAUX.map((n) => [n, NOTES_D_ATTEINTE[NOTE_DE_LA_LETTRE[n]].libelle]),
) as Record<Niveau, string>;

/** La note dans la pastille de sa lettre : 4 pour A, 1 pour D. */
const MARQUES = Object.fromEntries(NIVEAUX.map((n) => [n, String(NOTE_DE_LA_LETTRE[n])])) as Record<
  Niveau,
  string
>;

/** Les quatre notes d'un objectif, de 4 à 1, à cocher : chacune avec ce qu'elle veut dire. */
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

/** Ce que le N+1 écrit de l'arrondi : la case, puis sa justification. */
type MiseAJourDeLArrondi = (
  maj: Partial<Pick<EvaluationDuN1, 'arrondi' | 'justificationDeLArrondi'>>,
) => void;

/**
 * Le relevé des notes obtenues, sous les objectifs : la note de chaque
 * objectif, puis la moyenne, sur 4, une fois chaque objectif noté ; avant,
 * des points de suspension tiennent la place. Avec `evaluation`, deux
 * colonnes, l'auto-évaluation et le N+1 ; sans, la note de l'agent seule,
 * dans son auto-évaluation. Il suit la saisie.
 *
 * L'arrondi (ADR-0276) : quand la moyenne du N+1 va de 1,5 à moins de 2,
 * la saisie du N+1 (`onArrondi`) propose « Arrondir à 2 », puis demande sa
 * justification. Arrondie, la moyenne retenue, 2, ferme le tableau ; en
 * lecture, la justification suit.
 */
export function ReleveDesNotes({
  objectifs,
  auto,
  evaluation = null,
  onArrondi,
}: {
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
  evaluation?: EvaluationDuN1 | null;
  onArrondi?: MiseAJourDeLArrondi;
}) {
  const id = useId();
  const idDeLaJustification = useId();
  if (objectifs.length === 0) return null;
  const { lignes, moyennes, arrondi } = releveDesObjectifs(objectifs, auto, evaluation);
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
  const enGras = 'text-right font-bold whitespace-nowrap text-ink-strong tabular-nums';
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
                {evaluation ? (
                  <>
                    <span className="sm:hidden">Agent</span>
                    <span className="max-sm:hidden">Auto-évaluation</span>
                  </>
                ) : (
                  'Note'
                )}
              </Th>
              {evaluation ? <Th className={cn(serre, 'text-right')}>N+1</Th> : null}
            </tr>
          </THead>
          <TBody>
            {lignes.map((l, i) => (
              <Tr key={l.objectif.id}>
                <Td className={cn(serre, 'text-ink-strong')}>
                  <span className="text-ink-muted tabular-nums">{i + 1}.</span>{' '}
                  {l.objectif.intitule}
                </Td>
                <Td className={cn(serre, 'text-right tabular-nums', !evaluation && forte)}>
                  {note(l.agent)}
                </Td>
                {evaluation ? (
                  <Td className={cn(serre, 'text-right tabular-nums', forte)}>{note(l.n1)}</Td>
                ) : null}
              </Tr>
            ))}
            <tr className="border-t border-line">
              <Td className={cn(serre, 'font-bold text-ink-strong')}>Moyenne</Td>
              <Td
                className={cn(
                  serre,
                  evaluation
                    ? 'text-right font-semibold whitespace-nowrap text-ink tabular-nums'
                    : enGras,
                )}
              >
                {moyenne(moyennes.agent)}
              </Td>
              {evaluation ? <Td className={cn(serre, enGras)}>{moyenne(moyennes.n1)}</Td> : null}
            </tr>
            {arrondi ? (
              <tr className="border-t border-line-soft">
                <Td className={cn(serre, 'font-bold text-ink-strong')}>Moyenne retenue</Td>
                <Td className={serre} />
                <Td className={cn(serre, enGras)}>{moyenne(MOYENNE_D_ATTEINTE)}</Td>
              </tr>
            ) : null}
          </TBody>
        </Table>
      </div>
      {evaluation && onArrondi && arrondiPossible(moyennes.n1) ? (
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex cursor-pointer items-start gap-3 self-start">
            <Checkbox
              className="mt-[3px]"
              checked={evaluation.arrondi}
              onChange={(ev) => onArrondi({ arrondi: ev.target.checked })}
            />
            <span className="text-sm leading-relaxed font-medium text-ink-strong">
              Arrondir à 2
            </span>
          </label>
          {evaluation.arrondi ? (
            <Field label="Justification de l’arrondi" htmlFor={idDeLaJustification} required>
              <ZoneDeTexte
                id={idDeLaJustification}
                max={LONGUEURS_DE_LA_FICHE.texte}
                value={evaluation.justificationDeLArrondi}
                onChange={(ev) => onArrondi({ justificationDeLArrondi: ev.target.value })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
      {evaluation && !onArrondi && arrondi ? (
        <div className="mt-4">
          <p className="text-[12.5px] font-semibold text-ink-muted">Justification de l’arrondi</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
            {evaluation.justificationDeLArrondi.trim()}
          </p>
        </div>
      ) : null}
    </section>
  );
}
