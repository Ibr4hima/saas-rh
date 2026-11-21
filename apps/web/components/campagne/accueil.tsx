'use client';

import Link from 'next/link';
import type { AgentDeLaCampagne, PeriodeDeLaCampagne } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { GrilleDeReperes } from '../fiche';
import { Icon, type IconName } from '../icons';
import { COURBE_DE_LA_CHARTE } from '../scene-de-la-charte';
import { periodeDeLAuto, periodeDeLEvaluationDuN1, reperesDeLAgent } from './fiche';

/* ────────────────────────────────────────────────────────────────
   Les pièces de l'accueil de la campagne, à la charte de l'APIX (ADR-0227).

   En tête, le bandeau : le bleu de la charte, ses ondulations, et en bas la
   courbe du papier à en-tête soulignée d'orange, comme au pied de l'écran
   de connexion. Dessus, la personne : ses initiales, son nom, son poste, et
   le geste du moment en blanc ; dessous, sur le blanc de la fiche, ses
   repères. Puis des sections titrées en Anton, la police des titres de la
   charte, soulignées d'un filet orange ; et pour qui pilote la campagne,
   des tuiles, l'icône en orange comme celles de la charte.
   ──────────────────────────────────────────────────────────────── */

const n = (v: number) => Number(v.toFixed(1));

/** La courbe du bandeau, en unités de son cadre : étirée sur sa largeur. */
const COURBE_L = 1440;
const COURBE_H = 48;
/**
 * Le papier à en-tête, ramené au cadre : la courbe part à 40 du haut, à
 * gauche, et monte à 6, à droite ; son creux reste dans le cadre.
 */
const ARCS = COURBE_DE_LA_CHARTE.map((arc) =>
  arc.map(([x, y]) => [(x * COURBE_L) / 595.28, 6 + ((y - 705.59) * 34) / (769.7 - 705.59)]),
);
const SOUS_LA_COURBE =
  `M${n(ARCS[0]![0]![0]!)} ${n(ARCS[0]![0]![1]!)}` +
  ARCS.map(
    ([, p1, p2, p3]) =>
      `C${n(p1![0]!)} ${n(p1![1]!)} ${n(p2![0]!)} ${n(p2![1]!)} ${n(p3![0]!)} ${n(p3![1]!)}`,
  ).join('') +
  `L${COURBE_L} ${COURBE_H}L0 ${COURBE_H}Z`;

/**
 * Les ondulations du bandeau : des lignes qui montent vers la droite, comme
 * sur la page de garde de la charte. Assez nombreuses pour couvrir le cadre
 * d'un bord à l'autre ; le masque les efface vers la gauche.
 */
const ONDES = Array.from({ length: 34 }, (_, k) => {
  const points: string[] = [];
  for (let x = 0; x <= 1200; x += 15) {
    const y = 24 + k * 12 - 0.17 * x + 8 * Math.sin((2 * Math.PI * x) / 440 + k * 0.32);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

/**
 * Le bleu du bandeau : le dégradé de la charte, une lueur en haut à gauche,
 * et les ondulations à droite, d'un pixel, qui gardent leur trait quelle que
 * soit la taille.
 */
function Bleu({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden bg-linear-to-br from-bandeau to-bandeau-fin text-white',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(120%_150%_at_0%_0%,rgb(255_255_255/0.11),transparent_55%)]"
      />
      <svg
        aria-hidden
        viewBox="0 0 1200 240"
        preserveAspectRatio="xMaxYMid slice"
        className="absolute inset-0 -z-10 h-full w-full [mask-image:linear-gradient(to_left,#000_15%,transparent_80%)]"
      >
        <g fill="none" stroke="#ffffff" strokeOpacity="0.11" strokeWidth="1">
          {ONDES.map((points, i) => (
            <polyline key={i} points={points} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </svg>
      {children}
    </div>
  );
}

/**
 * Le bas du bandeau : la courbe du papier à en-tête, soulignée d'orange.
 * Sous la courbe, `dessous` : le blanc de la fiche, ou le fond de la page.
 * Le cadre s'étire en largeur et garde sa hauteur : sur un téléphone, la
 * courbe se resserre sans s'épaissir.
 */
function CourbeDuBandeau({ dessous }: { dessous: 'fiche' | 'page' }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${COURBE_L} ${COURBE_H}`}
      preserveAspectRatio="none"
      className="relative -mt-8 block h-8 w-full sm:-mt-12 sm:h-12"
    >
      <path d={SOUS_LA_COURBE} transform="translate(0 -3)" fill="#ca631f" />
      <path d={SOUS_LA_COURBE} className={dessous === 'fiche' ? 'fill-surface' : 'fill-bg'} />
    </svg>
  );
}

/** Les initiales d'une personne, dans un rond : sur sa carte, ou en grand dans le bandeau. */
export function Initiales({
  prenom,
  nom,
  taille,
}: {
  prenom: string;
  nom: string;
  taille: 'carte' | 'bandeau';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold uppercase',
        taille === 'bandeau'
          ? 'size-14 bg-white/12 text-[19px] tracking-[0.04em] text-white ring-1 ring-white/30 sm:size-16 sm:text-[21px]'
          : 'size-11 bg-primary-soft text-[13px] text-primary',
      )}
    >
      {prenom.charAt(0)}
      {nom.charAt(0)}
    </span>
  );
}

/**
 * Le bandeau d'un agent : ses initiales, son nom et son poste sur le bleu,
 * le geste du moment à droite (s'auto-évaluer, valider son évaluation) ;
 * dessous, ses repères, comme sur la fiche de son dossier (ADR-0211,
 * ADR-0224, ADR-0225).
 */
export function BandeauDeLAgent({
  agent: a,
  action,
}: {
  agent: AgentDeLaCampagne;
  action?: React.ReactNode;
}) {
  const reperes = reperesDeLAgent(a);
  return (
    <section
      aria-labelledby="nom-de-l-agent"
      className="overflow-hidden rounded-barre border border-card-line bg-surface shadow-xs"
    >
      <Bleu className="px-5 pt-6 pb-12 sm:px-8 sm:pt-8 sm:pb-16">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-5">
          <Initiales prenom={a.prenom} nom={a.nom} taille="bandeau" />
          <div className="min-w-0 flex-1 basis-52">
            <h1
              id="nom-de-l-agent"
              className="text-[24px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]"
            >
              {a.prenom} {a.nom}
            </h1>
            {/* Sous le nom, le poste seul (ADR-0225). */}
            {a.poste ? (
              <p className="mt-1.5 text-[13.5px] leading-snug text-white/80 sm:text-[14.5px]">
                {a.poste}
              </p>
            ) : null}
          </div>
          {action ? <div className="w-full sm:w-auto">{action}</div> : null}
        </div>
      </Bleu>
      <CourbeDuBandeau dessous="fiche" />
      <div className="@container px-5 pt-2 pb-5 sm:px-8 sm:pt-3 sm:pb-6">
        <GrilleDeReperes colonnes={reperes.length as 2 | 3 | 4 | 5}>{reperes}</GrilleDeReperes>
      </div>
    </section>
  );
}

/**
 * Le bandeau d'un compte sans dossier d'agent, l'administration : la
 * campagne elle-même, ses deux temps et leurs dates, numérotés comme sur la
 * carte de la période. La barre en dit déjà le titre : il ne se lit ici que
 * par les lecteurs d'écran. Le bandeau s'arrête sur la courbe, à même le
 * fond de la page.
 */
export function BandeauDeLaCampagne({
  titre,
  periode,
}: {
  titre: string;
  periode: PeriodeDeLaCampagne | null;
}) {
  return (
    <section aria-labelledby="titre-de-la-campagne" className="overflow-hidden rounded-t-barre">
      <h1 id="titre-de-la-campagne" className="sr-only">
        {titre}
      </h1>
      <Bleu className="px-5 pt-7 pb-14 sm:px-8 sm:pt-9 sm:pb-[4.5rem]">
        {periode ? (
          <ol className="grid gap-6 sm:grid-cols-2 sm:gap-10">
            <TempsDuBandeau numero={1} titre="Auto-évaluation" periode={periodeDeLAuto(periode)} />
            <TempsDuBandeau
              numero={2}
              titre="Évaluation"
              periode={periodeDeLEvaluationDuN1(periode)}
            />
          </ol>
        ) : (
          <p className="flex items-center gap-2.5 text-[16px] font-bold sm:text-[18px]">
            <Icon name="event" size={20} className="text-white/75" />
            Dates de l’évaluation à fixer
          </p>
        )}
      </Bleu>
      <CourbeDuBandeau dessous="page" />
    </section>
  );
}

/**
 * Un temps de la campagne, dans le bandeau : son numéro, dans un orange
 * éclairci qui se lit sur le bleu, son nom en capitales, ses dates.
 */
function TempsDuBandeau({
  numero,
  titre,
  periode,
}: {
  numero: number;
  titre: string;
  periode: string;
}) {
  return (
    <li className="flex items-center gap-4">
      {/* Une largeur fixe : en Anton, « 01 » est plus étroit que « 02 », et
          les libellés des deux temps se décaleraient. */}
      <span
        aria-hidden
        className="w-14 shrink-0 font-titre text-[44px] leading-[0.9] text-[#f6a06f] sm:w-16 sm:text-[52px]"
      >
        {String(numero).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold tracking-[0.14em] text-white/75 uppercase">
          {titre}
        </span>
        <span className="mt-1 block text-[17px] leading-snug font-bold sm:text-[20px]">
          {periode}
        </span>
      </span>
    </li>
  );
}

/**
 * Le titre d'une section de l'accueil : en Anton, en capitales, dans le bleu
 * de la charte, souligné d'un filet orange comme le titre de la connexion ;
 * à côté, s'il y a lieu, le nombre de ce qu'elle réunit.
 */
export function TitreDeSection({
  id,
  nombre,
  children,
}: {
  id: string;
  nombre?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        id={id}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 font-titre text-[22px] leading-[1.15] tracking-[0.015em] text-primary uppercase sm:text-[25px]"
      >
        <span>{children}</span>
        {nombre !== undefined ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-soft px-2 font-sans text-[12px] font-bold tracking-normal text-primary tabular-nums">
            {nombre}
          </span>
        ) : null}
      </h2>
      <span aria-hidden className="mt-2.5 block h-[3px] w-10 rounded-full bg-accent" />
    </div>
  );
}

/**
 * Une tuile de pilotage : l'icône en orange, le titre, une ligne dessous,
 * et la jauge s'il y a un avancement à montrer. Toute la tuile s'ouvre.
 * Étroite, elle s'empile, la flèche en haut à droite ; large (seule sur sa
 * ligne, ou deux sur un grand écran), elle tient sur une ligne, la flèche
 * au bout. Le seuil suit la largeur de la tuile, pas celle de l'écran.
 */
export function TuileDePilotage({
  href,
  icone,
  titre,
  texte,
  jauge,
}: {
  href: string;
  icone: IconName;
  titre: string;
  texte: string;
  /** L'avancement : tant sur tant. */
  jauge?: { fait: number; total: number };
}) {
  const part = jauge && jauge.total > 0 ? Math.round((jauge.fait / jauge.total) * 100) : 0;
  return (
    <Link
      href={href}
      className="group @container block rounded-bloc border border-card-line bg-surface shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <span className="flex flex-col gap-5 p-5 @[34rem]:flex-row @[34rem]:items-center">
        {/* Étroite, l'icône et la flèche se partagent la première ligne ;
            large, elles rejoignent la ligne de la tuile, chacune à son bout. */}
        <span className="flex items-start justify-between gap-3 @[34rem]:contents">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-bloc bg-accent-soft text-accent-text @[34rem]:order-1">
            <Icon name={icone} size={22} />
          </span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted/60 transition-colors duration-200 group-hover:bg-primary-soft group-hover:text-primary @[34rem]:order-4">
            <Icon
              name="arrow_forward"
              size={18}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-1 @[34rem]:order-2 @[34rem]:flex-1">
          <span className="text-[15px] leading-tight font-bold text-ink-strong">{titre}</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">{texte}</span>
        </span>
        {jauge ? (
          <span
            role="progressbar"
            aria-label={titre}
            aria-valuemin={0}
            aria-valuemax={jauge.total}
            aria-valuenow={jauge.fait}
            className="block h-1.5 overflow-hidden rounded-full bg-line-soft @[34rem]:order-3 @[34rem]:w-44 @[34rem]:shrink-0"
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${part}%` }}
            />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
