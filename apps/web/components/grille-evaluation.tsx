'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CRITERES_CADRE,
  dateEnLettres,
  FORMATIONS,
  LIBELLES_OU_EN_EST,
  LIMITES_DE_LA_GRILLE,
  NIVEAUX,
  NIVEAUX_D_OBJECTIF,
  nomDeLaGrille,
  periodeDEvaluationEnLettres,
  SYNTHESE_DU_N1,
  texteRicheVide,
  type ContenuDeGrille,
  type FormationDemandee,
  type FormationProposable,
  type GrilleAuDossier,
  type Niveau,
  type OuEnEst,
  type PeriodeEvaluation,
  type TexteRiche,
  type VueDeGrille,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Field,
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
import { api, ApiError, apiUrl } from '../lib/api';
import { enregistrerFichier, lireFichier } from '../lib/fichiers';
import { majuscule } from '../lib/mots';
import { ActionDeLEntete } from './entete';
import { FenetreDocument } from './fenetre-document';
import { Donnee } from './fiche';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { EditeurObjectifsAVenir, Echeance } from './objectifs-a-venir';
import { PdfEnLargeur } from './pdf-viewer';
import { TexteRicheLu } from './texte-riche';

/**
 * L'éditeur de texte mis en forme, chargé à la demande : BlockNote ne pèse
 * que sur la page qui fait remplir la grille. La place du champ est tenue
 * pendant qu'il arrive.
 */
const EditeurRiche = dynamic(() => import('./editeur-riche'), {
  ssr: false,
  loading: () => <div className="min-h-[inherit] rounded-controle border border-line bg-surface" />,
});

/*
   La grille d'évaluation de l'APIX à l'écran (ADR-0149) : le N+1 la remplit
   section par section, dans l'ordre du modèle ; l'agent la lit, sans la
   partie réservée à la hiérarchie ; le N+1, le N+2 et la DCH la voient telle
   qu'elle s'imprime, en PDF. Chacun voit ce que les autres y ont fait : le
   circuit dit qui l'a eue, quand, et ce qu'en ont dit l'agent et le N+2.
*/

export const CLE_EVALUATIONS = ['evaluations'] as const;

export const cleDeLaGrille = (employeeId: string, annee: number | null) =>
  [...CLE_EVALUATIONS, 'grille', employeeId, annee] as const;

/** L'année lue dans l'adresse (« ?annee=2026 ») ; absente ou fausse : null. */
export function anneeDeLAdresse(valeur: string | null): number | null {
  const annee = Number(valeur);
  return valeur && Number.isInteger(annee) && annee >= 2000 && annee <= 2100 ? annee : null;
}

/** « 4 décembre 2026 » : la date d'une étape, en lettres. */
export const leEnLettres = (iso: string) => dateEnLettres(iso.slice(0, 10));

/** « Du 1er au 31 décembre 2026 », ou rien sans période. */
export const periodeEnTete = (p: PeriodeEvaluation | null) =>
  p ? majuscule(periodeDEvaluationEnLettres(p)) : null;

/** Où en est une grille, d'après sa vue. */
export function ouEnEstDe(vue: Pick<VueDeGrille, 'etat' | 'renvoi'>): OuEnEst {
  if (!vue.etat) return 'a_remplir';
  if (vue.etat === 'brouillon') return vue.renvoi ? 'renvoyee' : 'en_cours';
  return vue.etat;
}

/**
 * L'orange de l'attente pour ce qui attend la personne qui regarde : le N+1
 * pour une grille à remplir, renvoyée ou validée par l'agent ; le N+2 pour
 * une grille reçue. Le bleu pour ce qui est chez quelqu'un d'autre, le
 * vert d'eau pour ce qui est arrivé à la DCH.
 */
export function tonDeLEtape(o: OuEnEst, enN2 = false): BadgeTone {
  switch (o) {
    case 'a_remplir':
    case 'renvoyee':
    case 'validee_agent':
      return 'orange';
    case 'chez_n2':
      return enN2 ? 'orange' : 'bleu';
    case 'terminee':
      return 'teal';
    default:
      return 'bleu';
  }
}

export function libelleDeLEtape(o: OuEnEst): string {
  return LIBELLES_OU_EN_EST[o === 'brouillon' ? 'en_cours' : o];
}

export function BadgeDeLEtape({
  ouEnEst,
  enN2 = false,
  size,
}: {
  ouEnEst: OuEnEst;
  enN2?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge tone={tonDeLEtape(ouEnEst, enN2)} size={size}>
      {libelleDeLEtape(ouEnEst)}
    </Badge>
  );
}

// ──────────────────────────────────────────────── les pièces

/** Une section de la grille : son intitulé, puis ce qui s'y remplit ou s'y lit. */
function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="border-t border-line-soft px-5 pt-4 pb-5">
      <h3 className="mb-4 text-[13.5px] font-bold text-ink-strong">{titre}</h3>
      {children}
    </section>
  );
}

/**
 * La couleur de chaque niveau, à l'écran seulement : A vert, B jaune tirant
 * sur le vert, C orange tirant sur le jaune, D rouge, en teintes claires.
 */
const COULEURS_DU_NIVEAU: Record<Niveau, { choix: string; pastille: string; texte: string }> = {
  A: {
    choix: 'border-niveau-a-line bg-niveau-a-soft',
    pastille: 'bg-niveau-a text-niveau-a-ink',
    texte: 'text-niveau-a-text',
  },
  B: {
    choix: 'border-niveau-b-line bg-niveau-b-soft',
    pastille: 'bg-niveau-b text-niveau-b-ink',
    texte: 'text-niveau-b-text',
  },
  C: {
    choix: 'border-niveau-c-line bg-niveau-c-soft',
    pastille: 'bg-niveau-c text-niveau-c-ink',
    texte: 'text-niveau-c-text',
  },
  D: {
    choix: 'border-niveau-d-line bg-niveau-d-soft',
    pastille: 'bg-niveau-d text-niveau-d-ink',
    texte: 'text-niveau-d-text',
  },
};

/** Le signe dans la case d'un objectif : dépassé ou réalisé, en partie, pas du tout. */
const SIGNE_DU_NIVEAU: Record<Niveau, IconName> = {
  A: 'check',
  B: 'check',
  C: 'remove',
  D: 'close',
};

/**
 * La case d'un objectif de l'année écoulée. Elle ne se coche pas : le
 * niveau de l'objectif la remplit, à sa couleur.
 */
function CaseDuNiveau({ niveau }: { niveau: Niveau | null }) {
  return (
    <span
      role="img"
      aria-label={niveau ? `${niveau} : ${NIVEAUX_D_OBJECTIF[niveau]}` : 'Niveau à donner'}
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-150',
        niveau
          ? cn(COULEURS_DU_NIVEAU[niveau].pastille, 'border-transparent')
          : 'border-ink-muted/40 bg-surface',
      )}
    >
      {niveau ? <Icon name={SIGNE_DU_NIVEAU[niveau]} size={14} weight={600} /> : null}
    </span>
  );
}

/** Les quatre niveaux, A à D, à cocher : chacun avec ce qu'il veut dire. */
export function ChoixDeNiveau({
  legende,
  valeur,
  libelles,
  onChange,
  court = false,
}: {
  legende: string;
  valeur: Niveau | null;
  libelles: Record<Niveau, string>;
  /** Un nouveau clic sur le niveau coché le retire. */
  onChange: (n: Niveau | null) => void;
  /** Des libellés d'un ou deux mots : les quatre niveaux tiennent sur une ligne. */
  court?: boolean;
}) {
  const nom = useId();
  return (
    // `relative` : la légende, cachée, se place dans son cadre ; sans lui,
    // elle débordait de la zone qui défile et faisait défiler la page entière.
    <fieldset className="relative min-w-0">
      <legend className="sr-only">{legende}</legend>
      <div
        className={cn(
          'grid gap-2',
          court ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
        )}
      >
        {NIVEAUX.map((n) => {
          const choisi = valeur === n;
          return (
            <label
              key={n}
              // `relative` : la case radio, cachée, se place dans son libellé.
              // Sans parent positionné, la focaliser faisait défiler la
              // coquille entière pour aller la chercher.
              className={cn(
                'relative flex cursor-pointer items-start gap-2.5 rounded-controle border px-3 py-2.5 transition-colors duration-150',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
                choisi
                  ? COULEURS_DU_NIVEAU[n].choix
                  : 'border-line bg-surface hover:border-ink-muted/40 hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name={nom}
                value={n}
                checked={choisi}
                onChange={() => onChange(n)}
                onClick={() => {
                  if (choisi) onChange(null);
                }}
                className="sr-only"
              />
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold transition-colors duration-150',
                  choisi ? COULEURS_DU_NIVEAU[n].pastille : 'bg-line-soft text-ink-strong',
                )}
              >
                {n}
              </span>
              <span
                className={cn(
                  'min-w-0 pt-[3px] text-[12px] leading-snug',
                  choisi ? cn('font-semibold', COULEURS_DU_NIVEAU[n].texte) : 'text-ink',
                )}
              >
                {libelles[n]}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Un niveau donné, en lecture : la lettre dans sa pastille, puis ce qu'elle veut dire. */
function NiveauDonne({ niveau, libelle }: { niveau: Niveau | null; libelle?: string }) {
  if (!niveau) return <NonRenseigne />;
  return (
    <span className="flex items-start gap-2.5">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold',
          COULEURS_DU_NIVEAU[niveau].pastille,
        )}
      >
        {niveau}
      </span>
      {libelle ? (
        <span className="min-w-0 pt-[3px] text-[12.5px] leading-snug font-semibold text-ink-strong">
          {libelle}
        </span>
      ) : null}
    </span>
  );
}

function NonRenseigne() {
  return <span className="text-[12.5px] text-ink-muted/70">Non renseigné</span>;
}

/**
 * Le critère du commandement, pour qui n'encadre personne : il garde sa
 * place et son numéro, comme sur la grille, sans niveau à donner.
 */
function SansObjet({ numero, intitule }: { numero: number; intitule: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="text-[13px] font-semibold text-ink-muted">
        <span className="tabular-nums">{numero}.</span> {intitule}
      </p>
      <span className="text-[12px] text-ink-muted/80">Sans objet</span>
    </li>
  );
}

/** Un texte de la grille, en lecture, tel qu'il s'est écrit. */
function TexteDonne({ texte }: { texte: TexteRiche }) {
  return texteRicheVide(texte) ? <NonRenseigne /> : <TexteRicheLu texte={texte} />;
}

/**
 * Un champ de texte mis en forme, à remplir : `listes` y admet les puces et
 * les numéros. La place du champ est tenue pendant que l'éditeur arrive.
 */
function ChampRiche({
  label,
  valeur,
  onChange,
  listes,
  max,
  compact = false,
}: {
  label: string;
  valeur: TexteRiche;
  onChange: (t: TexteRiche) => void;
  listes: boolean;
  max: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'min-h-[38px]' : 'min-h-[58px]'}>
      <EditeurRiche
        label={label}
        valeur={valeur}
        onChange={onChange}
        listes={listes}
        max={max}
        compact={compact}
      />
    </div>
  );
}

/** Une formation en badge : le rayon vaut la moitié d'une ligne, un titre long passe à la ligne. */
const BADGE =
  'inline-flex max-w-full items-center gap-1.5 rounded-[15px] border px-3 py-[5px] text-left text-[12px] font-semibold transition-colors duration-150';

/**
 * Les besoins de formation, à choisir d'un clic dans le catalogue de l'APIX
 * Academy : ce que l'agent n'a ni terminé ni obtenu, et n'anime pas. Une
 * formation déjà demandée qui n'y est plus se retire d'un clic. Trois au
 * plus, les trois lignes du modèle.
 */
function ChoixDesFormations({
  choisies,
  proposables,
  onChange,
}: {
  choisies: FormationDemandee[];
  proposables: FormationProposable[];
  onChange: (formations: FormationDemandee[]) => void;
}) {
  const lignes = [
    ...proposables,
    ...choisies.filter((c) => !proposables.some((p) => p.courseId === c.courseId)),
  ];
  const complete = choisies.length >= FORMATIONS;
  if (lignes.length === 0) {
    return (
      <p className="text-[12.5px] text-ink-muted/70">
        Aucune formation de l’APIX Academy à proposer
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {lignes.map(({ courseId, titre }) => {
        const choisie = choisies.some((c) => c.courseId === courseId);
        const bloquee = !choisie && complete;
        return (
          <button
            key={courseId}
            type="button"
            aria-pressed={choisie}
            disabled={bloquee}
            title={bloquee ? 'Trois formations au plus' : undefined}
            onClick={() =>
              onChange(
                choisie
                  ? choisies.filter((c) => c.courseId !== courseId)
                  : [...choisies, { courseId, titre }],
              )
            }
            className={cn(
              BADGE,
              'outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
              choisie
                ? 'border-primary bg-primary pl-2 text-primary-ink'
                : 'border-line bg-surface text-ink hover:border-primary/40 hover:text-primary',
              bloquee && 'cursor-not-allowed opacity-50 hover:border-line hover:text-ink',
            )}
          >
            {choisie ? <Icon name="check" size={15} className="shrink-0" /> : null}
            <span className="min-w-0">{titre}</span>
          </button>
        );
      })}
    </div>
  );
}

/** L'intitulé d'un champ en lecture, petit et gris, comme ceux des fiches. */
function Intitule({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[9.5px] font-bold tracking-[0.1em] text-ink-muted uppercase">
      {children}
    </p>
  );
}

/**
 * Une zone de texte qui grandit avec ce qu'on y écrit : on relit tout son
 * texte sans faire défiler une petite boîte. Près de sa limite, celle de la
 * place que le texte a sur le PDF, elle compte ses caractères.
 */
export function ZoneDeTexte({
  max,
  value,
  className,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'maxLength' | 'value'> & { max: number; value: string }) {
  const cadre = useRef<HTMLDivElement>(null);
  const ajuster = useCallback(() => {
    const zone = cadre.current?.querySelector('textarea');
    if (!zone) return;
    zone.style.height = 'auto';
    // La hauteur du texte, plus les deux filets du cadre.
    zone.style.height = `${zone.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(ajuster, [value, ajuster]);
  // Plus étroite, la zone remet ses lignes à la ligne : elle se remesure.
  useEffect(() => {
    window.addEventListener('resize', ajuster);
    return () => window.removeEventListener('resize', ajuster);
  }, [ajuster]);
  return (
    <div ref={cadre}>
      <Textarea
        rows={2}
        maxLength={max}
        value={value}
        className={cn('min-h-[58px] resize-none overflow-hidden text-[12.5px]', className)}
        {...props}
      />
      {value.length >= max * 0.8 ? (
        <p className="mt-1 text-right text-[11px] text-ink-muted tabular-nums">
          {value.length} / {max}
        </p>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────── l'identification

function Identification({ vue, nouveau }: { vue: VueDeGrille; nouveau?: ReactNode }) {
  const id = vue.identification;
  return (
    <Section titre="Identification">
      <dl className="grid grid-cols-1 gap-x-10 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
        <Donnee label="Direction">{id.direction}</Donnee>
        <Donnee label="Département">{id.departement}</Donnee>
        <Donnee label="Service">{id.service}</Donnee>
        <Donnee label="Agent (N)">{id.agent}</Donnee>
        <Donnee label="Matricule">{id.matricule}</Donnee>
        <Donnee label="Fonction">{id.fonction}</Donnee>
        <Donnee label="Ancienneté dans le poste">{id.anciennete}</Donnee>
        <Donnee label="Évaluateur (N+1)">{id.evaluateur}</Donnee>
        <Donnee label="Fonction de l’évaluateur">{id.fonctionEvaluateur}</Donnee>
      </dl>
      {nouveau}
    </Section>
  );
}

// ──────────────────────────────────────────────── la saisie du N+1

/**
 * La grille que remplit le N+1 : les sections du modèle, dans son ordre,
 * de l'identification à la partie réservée à la hiérarchie. Les champs
 * marqués d'un astérisque sont ceux sans lesquels la grille ne part pas à
 * l'agent (cf. `ceQuiManque`).
 */
export function SaisieDeLaGrille({
  vue,
  contenu,
  onChange,
}: {
  vue: VueDeGrille;
  contenu: ContenuDeGrille;
  onChange: (contenu: ContenuDeGrille) => void;
}) {
  const L = LIMITES_DE_LA_GRILLE;
  const poser = (champ: Partial<ContenuDeGrille>) => onChange({ ...contenu, ...champ });
  const remplacer = <T,>(liste: T[], i: number, valeur: T) =>
    liste.map((x, k) => (k === i ? valeur : x));
  const avecRaisons = contenu.objectifs.some((o) => o.niveau === 'C' || o.niveau === 'D');
  const nouveau = contenu.nouveauAuPoste ?? vue.identification.nouveauAuPoste;

  return (
    <>
      <Identification
        vue={vue}
        nouveau={
          <label className="mt-5 flex w-max max-w-full cursor-pointer items-center gap-2.5 text-[12.5px] font-medium text-ink-strong">
            <Checkbox
              checked={nouveau}
              onChange={(e) => poser({ nouveauAuPoste: e.target.checked })}
            />
            Agent nouveau à son poste actuel
          </label>
        }
      />

      <Section titre="Rappel sur les objectifs fixés à l’agent pour la période écoulée">
        <div className="flex flex-col gap-6">
          {contenu.objectifs.map((o, i) => (
            <div key={i} className="flex flex-col gap-2.5">
              <Field label={`Objectif ${i + 1}`} required={i === 0}>
                <div className="flex items-start gap-2.5">
                  <span className="pt-[11px]">
                    <CaseDuNiveau niveau={o.niveau} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <ChampRiche
                      compact
                      listes={false}
                      label={`Objectif ${i + 1}`}
                      max={L.objectif}
                      valeur={o.texte}
                      onChange={(texte) =>
                        poser({ objectifs: remplacer(contenu.objectifs, i, { ...o, texte }) })
                      }
                    />
                  </div>
                </div>
              </Field>
              <div className="sm:pl-7">
                <ChoixDeNiveau
                  court
                  legende={`Niveau de l’objectif ${i + 1}`}
                  valeur={o.niveau}
                  libelles={NIVEAUX_D_OBJECTIF}
                  onChange={(niveau) =>
                    poser({ objectifs: remplacer(contenu.objectifs, i, { ...o, niveau }) })
                  }
                />
              </div>
            </div>
          ))}
          <Field
            label="Raisons des objectifs non atteints ou partiellement réalisés"
            required={avecRaisons}
          >
            <ChampRiche
              listes
              label="Raisons des objectifs non atteints ou partiellement réalisés"
              max={L.raisons}
              valeur={contenu.raisons}
              onChange={(raisons) => poser({ raisons })}
            />
          </Field>
        </div>
      </Section>

      <Section titre="Évaluation des performances dans le poste">
        <ol className="flex flex-col gap-6">
          {CRITERES_CADRE.map((c) =>
            c.commandement && !vue.commandement ? (
              <SansObjet key={c.numero} numero={c.numero} intitule={c.intitule} />
            ) : (
              <li key={c.numero} className="flex flex-col gap-2.5">
                <p className="text-[13px] font-semibold text-ink-strong">
                  <span className="text-ink-muted tabular-nums">{c.numero}.</span> {c.intitule}
                  <span className="text-danger">{'\u00a0'}*</span>
                </p>
                <ChoixDeNiveau
                  legende={c.intitule}
                  valeur={contenu.criteres[c.numero - 1] ?? null}
                  libelles={c.niveaux}
                  onChange={(niveau) =>
                    poser({ criteres: remplacer(contenu.criteres, c.numero - 1, niveau) })
                  }
                />
              </li>
            ),
          )}
        </ol>
      </Section>

      <Section titre="Résumé de l’évaluation des performances">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Field label="Points forts de l’évalué" required>
            <ChampRiche
              listes
              label="Points forts de l’évalué"
              max={L.pointsForts}
              valeur={contenu.pointsForts}
              onChange={(pointsForts) => poser({ pointsForts })}
            />
          </Field>
          <Field label="Points faibles de l’évalué (à améliorer)" required>
            <ChampRiche
              listes
              label="Points faibles de l’évalué (à améliorer)"
              max={L.pointsFaibles}
              valeur={contenu.pointsFaibles}
              onChange={(pointsFaibles) => poser({ pointsFaibles })}
            />
          </Field>
        </div>
      </Section>

      <Section titre="Actions pour améliorer les performances de l’évalué">
        <ChampRiche
          listes
          label="Actions pour améliorer les performances de l’évalué"
          max={L.actions}
          valeur={contenu.actions}
          onChange={(actions) => poser({ actions })}
        />
      </Section>

      <Section titre="Objectifs de travail pour la période à venir">
        <EditeurObjectifsAVenir
          initial={contenu.objectifsAVenir}
          annee={vue.annee}
          onChange={(objectifsAVenir) => poser({ objectifsAVenir })}
        />
      </Section>

      <Section titre="Besoins de formation identifiés">
        <ChoixDesFormations
          choisies={contenu.formations}
          proposables={vue.formationsProposables}
          onChange={(formations) => poser({ formations })}
        />
      </Section>

      <Section titre="Partie strictement réservée à la hiérarchie">
        <div className="flex flex-col gap-6">
          <Intitule>Synthèse générale du N+1</Intitule>
          {SYNTHESE_DU_N1.map((s) => (
            <div key={s.cle} className="flex flex-col gap-2.5">
              <p className="text-[13px] font-semibold text-ink-strong">
                {s.intitule}
                <span className="text-danger">{'\u00a0'}*</span>
              </p>
              <ChoixDeNiveau
                legende={s.intitule}
                valeur={contenu[s.cle]}
                libelles={s.niveaux}
                onChange={(niveau) => poser({ [s.cle]: niveau })}
              />
            </div>
          ))}
          <Field label="Observations du N+1">
            <ChampRiche
              listes
              label="Observations du N+1"
              max={L.observations}
              valeur={contenu.observations}
              onChange={(observations) => poser({ observations })}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

// ──────────────────────────────────────────────── la lecture de l'agent

/**
 * La grille en lecture, pour l'agent : ce que le N+1 y a écrit, sans la
 * partie réservée à la hiérarchie, que l'API ne transmet pas à l'agent.
 */
export function GrilleEnLecture({ vue }: { vue: VueDeGrille }) {
  const c = vue.contenu;
  const objectifs = c.objectifs.filter((o) => !texteRicheVide(o.texte) || o.niveau);
  const nouveau = c.nouveauAuPoste ?? vue.identification.nouveauAuPoste;
  return (
    <>
      <Identification
        vue={vue}
        nouveau={
          nouveau ? (
            <p className="mt-5 flex items-center gap-2 text-[12.5px] font-semibold text-ink-strong">
              <Icon name="check" size={16} className="text-primary" />
              Agent nouveau à son poste actuel
            </p>
          ) : null
        }
      />

      <Section titre="Rappel sur les objectifs fixés à l’agent pour la période écoulée">
        <div className="flex flex-col gap-5">
          {objectifs.map((o, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Intitule>Objectif {i + 1}</Intitule>
              <div className="flex items-start gap-2.5">
                <span className="pt-[3px]">
                  <CaseDuNiveau niveau={o.niveau} />
                </span>
                <div className="min-w-0 flex-1">
                  <TexteDonne texte={o.texte} />
                </div>
              </div>
              <div className="sm:pl-7">
                <NiveauDonne
                  niveau={o.niveau}
                  libelle={o.niveau ? NIVEAUX_D_OBJECTIF[o.niveau] : ''}
                />
              </div>
            </div>
          ))}
          {!texteRicheVide(c.raisons) ? (
            <div>
              <Intitule>Raisons des objectifs non atteints ou partiellement réalisés</Intitule>
              <TexteDonne texte={c.raisons} />
            </div>
          ) : null}
        </div>
      </Section>

      <Section titre="Évaluation des performances dans le poste">
        <ol className="flex flex-col gap-4">
          {CRITERES_CADRE.map((cr) => {
            if (cr.commandement && !vue.commandement) {
              return <SansObjet key={cr.numero} numero={cr.numero} intitule={cr.intitule} />;
            }
            const niveau = c.criteres[cr.numero - 1] ?? null;
            return (
              <li key={cr.numero} className="flex flex-col gap-2">
                <p className="text-[13px] font-semibold text-ink-strong">
                  <span className="text-ink-muted tabular-nums">{cr.numero}.</span> {cr.intitule}
                </p>
                <NiveauDonne niveau={niveau} libelle={niveau ? cr.niveaux[niveau] : ''} />
              </li>
            );
          })}
        </ol>
      </Section>

      <Section titre="Résumé de l’évaluation des performances">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <Intitule>Points forts de l’évalué</Intitule>
            <TexteDonne texte={c.pointsForts} />
          </div>
          <div>
            <Intitule>Points faibles de l’évalué (à améliorer)</Intitule>
            <TexteDonne texte={c.pointsFaibles} />
          </div>
        </div>
      </Section>

      <Section titre="Actions pour améliorer les performances de l’évalué">
        <TexteDonne texte={c.actions} />
      </Section>

      <Section titre="Objectifs de travail pour la période à venir">
        {c.objectifsAVenir.length === 0 ? (
          <NonRenseigne />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {c.objectifsAVenir.map((o, i) => (
              <li key={i} className="flex items-start gap-[11px]">
                <span
                  aria-hidden
                  className="w-2 shrink-0 text-[12.5px] leading-relaxed text-ink-muted"
                >
                  •
                </span>
                <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed break-words text-ink-strong">
                  {o.texte}
                </p>
                {o.echeance ? <Echeance date={o.echeance} className="pt-px" /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section titre="Besoins de formation identifiés">
        {c.formations.length === 0 ? (
          <NonRenseigne />
        ) : (
          <div className="flex flex-wrap gap-2">
            {c.formations.map((f) => (
              <Link
                key={f.courseId}
                href={`/academy/${f.courseId}`}
                className={cn(
                  BADGE,
                  'border-primary/20 bg-primary-soft text-primary hover:border-primary/45',
                )}
              >
                <span className="min-w-0">{f.titre}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ──────────────────────────────────────────────── le circuit

interface Etape {
  cle: string;
  titre: string;
  le: string | null;
  etat: 'faite' | 'en_cours' | 'a_venir';
  /** Le N+2 : une étape que le N+1 peut sauter. */
  facultative?: boolean;
  /** Ce qu'en a dit la personne : les commentaires de l'agent, du N+2. */
  mot?: string;
}

function etapesDe(vue: VueDeGrille): Etape[] {
  const d = vue.dates;
  const e = vue.etat;
  const apres = (...etats: (typeof e)[]) => etats.includes(e);
  const etapes: Etape[] = [
    {
      cle: 'agent',
      titre: apres('chez_agent', 'validee_agent', 'chez_n2', 'terminee')
        ? 'Envoyée à l’agent'
        : 'Envoi à l’agent',
      le: apres('chez_agent', 'validee_agent', 'chez_n2', 'terminee') ? d.envoyeeLe : null,
      etat: apres('chez_agent', 'validee_agent', 'chez_n2', 'terminee') ? 'faite' : 'en_cours',
    },
    {
      cle: 'validation',
      titre: d.valideeAgentLe ? 'Validée par l’agent' : 'Validation par l’agent',
      le: d.valideeAgentLe,
      etat: d.valideeAgentLe ? 'faite' : e === 'chez_agent' ? 'en_cours' : 'a_venir',
      mot: d.valideeAgentLe ? vue.commentairesAgent : undefined,
    },
  ];
  const n2 = vue.n2 ? `, ${vue.n2.nom}` : '';
  if (d.envoyeeN2Le) {
    etapes.push({
      cle: 'n2',
      titre: d.valideeN2Le
        ? `Commentée par le N+2${n2}`
        : e === 'chez_n2'
          ? `Chez le N+2${n2}`
          : `Envoyée au N+2${n2}`,
      le: d.valideeN2Le ?? d.envoyeeN2Le,
      etat: e === 'chez_n2' ? 'en_cours' : 'faite',
      mot: d.valideeN2Le ? vue.commentairesN2 : undefined,
    });
  } else if (vue.n2 && e !== 'terminee') {
    etapes.push({
      cle: 'n2',
      titre: `Avis du N+2${n2}`,
      le: null,
      etat: 'a_venir',
      facultative: true,
    });
  }
  etapes.push({
    cle: 'dch',
    titre: d.termineeLe ? 'Transmise à la DCH' : 'Transmission à la DCH',
    le: d.termineeLe,
    etat: d.termineeLe ? 'faite' : e === 'validee_agent' ? 'en_cours' : 'a_venir',
  });
  return etapes;
}

/**
 * Le circuit de la grille : chaque étape, sa date, et ce qu'en ont dit
 * l'agent et le N+2. Au pied, les gestes que la personne qui regarde peut
 * faire.
 */
export function CircuitDeLaGrille({
  vue,
  avant,
  children,
}: {
  vue: VueDeGrille;
  /** Ce qui se saisit avant les gestes : les commentaires du N+2. */
  avant?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 pt-4 pb-1">
        <CardTitle>Circuit</CardTitle>
      </div>
      <ol className="flex flex-col px-5 py-3">
        {etapesDe(vue).map((etape, i, toutes) => (
          <li key={etape.cle} className="flex gap-3">
            <div className="flex w-5 shrink-0 flex-col items-center">
              <span className="flex h-6 items-center">
                {etape.etat === 'faite' ? (
                  <Icon name="check_circle" size={18} className="text-success" />
                ) : etape.etat === 'en_cours' ? (
                  <Icon name="schedule" size={18} className="text-accent-text" />
                ) : (
                  <span aria-hidden className="size-3 rounded-full border-2 border-line" />
                )}
              </span>
              {i < toutes.length - 1 ? (
                <span aria-hidden className="w-px flex-1 bg-line-soft" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                <p
                  className={cn(
                    'text-[12.5px] font-semibold',
                    etape.etat === 'a_venir' ? 'text-ink-muted' : 'text-ink-strong',
                  )}
                >
                  {etape.titre}
                  {etape.facultative ? (
                    <span className="ml-2 text-[11px] font-medium text-ink-muted">Facultatif</span>
                  ) : null}
                </p>
                {etape.le ? (
                  <span className="text-[11.5px] text-ink-muted tabular-nums">
                    {leEnLettres(etape.le)}
                  </span>
                ) : null}
              </div>
              {etape.mot ? (
                <p className="mt-2 rounded-controle bg-bg px-3 py-2 text-[12.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
                  {etape.mot}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {avant ? <div className="border-t border-line-soft px-5 py-4">{avant}</div> : null}
      {children ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

// ──────────────────────────────────────────────── le PDF

/**
 * La grille telle qu'elle s'imprime, en largeur, comme les documents
 * générés ; « Télécharger » se pose dans l'en-tête dès que le PDF est là.
 * `version` change à chaque enregistrement : le PDF se refait, l'ancien
 * restant à l'écran le temps du nouveau.
 */
export function ApercuDeLaGrille({
  vue,
  matricule,
  version,
}: {
  vue: VueDeGrille;
  matricule: string | null;
  version: string;
}) {
  const { employeeId, annee } = vue;
  const pdf = useQuery({
    queryKey: [...CLE_EVALUATIONS, 'pdf', employeeId, annee, version],
    queryFn: ({ signal }) =>
      lireFichier(`/evaluations/grilles/${employeeId}/${annee}/pdf`, { signal }),
    retry: false,
    placeholderData: (precedent, requete) =>
      requete?.queryKey[2] === employeeId && requete.queryKey[3] === annee ? precedent : undefined,
  });
  const aJour = !pdf.isPlaceholderData;

  if (pdf.isError) {
    const probleme = pdf.error instanceof ApiError ? pdf.error.problem : null;
    return (
      <Card>
        <EmptyState
          icon={<Icon name="error" size={22} />}
          title={probleme?.title ?? 'Le PDF de la grille ne s’affiche pas'}
          description={probleme?.detail}
          action={
            probleme && probleme.status < 500 ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => void pdf.refetch()}>
                Réessayer
              </Button>
            )
          }
        />
      </Card>
    );
  }
  const contenu = pdf.data;
  if (!contenu) {
    return (
      <div className="grid aspect-[595/842] place-items-center rounded-bloc bg-white shadow-xs ring-1 ring-card-line">
        <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }
  return (
    <>
      {aJour ? (
        <ActionDeLEntete
          icon="download"
          label="Télécharger"
          onClick={() =>
            enregistrerFichier(
              new Blob([contenu], { type: 'application/pdf' }),
              nomDeLaGrille(annee, matricule),
            )
          }
        />
      ) : null}
      <div className={cn('transition-opacity duration-200', !aJour && 'opacity-55')}>
        <PdfEnLargeur data={contenu} titre={`Grille d’évaluation ${annee} de ${vue.agent.nom}`} />
      </div>
    </>
  );
}

/** La version d'une grille pour son PDF : son étape, ses dates, ses commentaires. */
export function versionDe(vue: VueDeGrille, enregistrements = 0): string {
  return [
    vue.etat,
    ...Object.values(vue.dates),
    vue.commentairesAgent.length,
    vue.commentairesN2.length,
    enregistrements,
  ].join('|');
}

// ──────────────────────────────────────────────── les confirmations

/** Un geste qu'on ne reprend pas : la fenêtre le fait confirmer. */
export function Confirmation({
  titre,
  libelle,
  enCours,
  erreur,
  onConfirmer,
  onClose,
  children,
}: {
  titre: string;
  libelle: string;
  enCours: boolean;
  erreur: string | null;
  onConfirmer: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={titre}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={enCours} onClick={onConfirmer}>
            {libelle}
          </Button>
        </>
      }
    >
      {erreur ? <Erreur>{erreur}</Erreur> : null}
      <div className="text-[13px] leading-relaxed text-ink">{children}</div>
    </Modal>
  );
}

export function Erreur({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-bloc bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger"
    >
      {children}
    </p>
  );
}

/** Le message d'une erreur de l'API, ou celui qu'on donne à défaut. */
export function messageDe(erreur: unknown, defaut = 'Action impossible, réessayez.'): string {
  if (!(erreur instanceof ApiError)) return defaut;
  const { title, detail } = erreur.problem;
  return detail && detail !== title ? `${title} : ${detail}` : title;
}

/** Garde la page tant qu'une saisie n'est pas enregistrée : le navigateur le rappelle. */
export function useGardeDeSaisie(modifie: boolean) {
  useEffect(() => {
    if (!modifie) return;
    const avant = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avant);
    return () => window.removeEventListener('beforeunload', avant);
  }, [modifie]);
}

/** Un message qui s'efface de lui-même : « Grille enregistrée ». */
export function useMessageBref(duree = 2500) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), duree);
    return () => clearTimeout(t);
  }, [message, duree]);
  return [message, setMessage] as const;
}

// ──────────────────────────────────────────────── au dossier de l'agent

/**
 * Les grilles transmises à la DCH, au dossier de l'agent : l'année, la
 * date de la transmission, et le PDF, l'original de la DCH.
 */
export function CarteDesGrilles({
  employeeId,
  nom,
  matricule,
}: {
  employeeId: string;
  nom: string;
  matricule: string | null;
}) {
  const grilles = useQuery({
    queryKey: [...CLE_EVALUATIONS, 'dossier', employeeId],
    queryFn: () => api<GrilleAuDossier[]>(`/evaluations/dossiers/${employeeId}`),
  });
  const [ouverte, setOuverte] = useState<number | null>(null);
  const liste = grilles.data ?? [];
  const chemin = (annee: number) => `/evaluations/grilles/${employeeId}/${annee}/pdf`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Évaluations annuelles</CardTitle>
      </CardHeader>
      {grilles.isPending ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : liste.length === 0 ? (
        <CardContent>
          <p className="rounded-bloc border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune grille transmise à la DCH
          </p>
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Année</Th>
              <Th className="max-sm:hidden">Grille</Th>
              <Th>Transmise le</Th>
              <Th>
                <span className="sr-only">PDF</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {liste.map((g) => (
              <Tr key={g.annee}>
                <Td className="font-semibold text-ink-strong tabular-nums">{g.annee}</Td>
                <Td className="max-sm:hidden">
                  {g.modele === 'cadre' ? 'Personnel cadre' : 'Personnel non cadre'}
                </Td>
                <Td className="tabular-nums">{leEnLettres(g.termineeLe)}</Td>
                <Td className="w-12 text-right">
                  <button
                    type="button"
                    onClick={() => setOuverte(g.annee)}
                    aria-label={`Grille d’évaluation ${g.annee}`}
                    title="Voir la grille"
                    className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                  >
                    <Icon name="picture_as_pdf" size={18} />
                  </button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <FenetreDocument
        doc={
          ouverte === null
            ? null
            : {
                url: apiUrl(`${chemin(ouverte)}?disposition=inline`),
                filename: nomDeLaGrille(ouverte, matricule),
                contentType: 'application/pdf',
                titre: `Grille d’évaluation ${ouverte} de ${nom}`,
              }
        }
        telechargement={ouverte === null ? undefined : apiUrl(chemin(ouverte))}
        onClose={() => setOuverte(null)}
      />
    </Card>
  );
}
