'use client';

import Link from 'next/link';
import { useId } from 'react';
import type { AgentDeLaCampagne, PeriodeDeLaCampagne } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { GrilleDeReperes } from '../fiche';
import { Icon, type IconName } from '../icons';
import { periodeDeLAuto, periodeDeLEvaluationDuN1, reperesDeLAgent } from './fiche';

/* ────────────────────────────────────────────────────────────────
   Les pièces de la campagne à la charte de l'APIX (ADR-0227), sur l'accueil
   puis sur toutes ses pages (ADR-0233).

   En tête, le bandeau : le bleu de la charte, ses ondulations, et en bas,
   bien droit, un filet orange (ADR-0228). Dessus, la personne (ses
   initiales, son nom, son poste) ou la page (son icône, son titre), et le
   geste du moment en blanc ; dessous, sur le blanc, les repères. Puis des
   sections titrées en Anton, la police des titres de la charte, soulignées
   d'un filet orange ; et pour qui pilote la campagne, des tuiles, l'icône
   en orange comme celles de la charte.
   ──────────────────────────────────────────────────────────────── */

const n = (v: number) => Number(v.toFixed(1));

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

/** Le bas du bandeau : un filet orange, bien droit, l'orange de la charte de jour comme de nuit. */
function FiletDuBandeau() {
  return <div aria-hidden className="h-[3px] bg-[#ca631f]" />;
}

/** Les initiales d'une personne, dans un rond, sur le bleu du bandeau. */
function Initiales({ prenom, nom }: { prenom: string; nom: string }) {
  return (
    <span
      aria-hidden
      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/12 text-[19px] font-bold tracking-[0.04em] text-white uppercase ring-1 ring-white/30 sm:size-16 sm:text-[21px]"
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
      <Bleu className="px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-5">
          <Initiales prenom={a.prenom} nom={a.nom} />
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
      <FiletDuBandeau />
      <div className="@container px-5 py-5 sm:px-8">
        <GrilleDeReperes colonnes={reperes.length as 2 | 3 | 4 | 5}>{reperes}</GrilleDeReperes>
      </div>
    </section>
  );
}

/**
 * Ce qui se pose à côté d'un titre sur le bleu : la coche bleue d'une étape
 * faite y passe en blanc, sa coche en bleu, pour se voir encore. Les
 * utilitaires de couleur lisent les jetons `--tg-*` eux-mêmes : c'est eux
 * qui s'inversent ici.
 */
function MarqueSurLeBleu({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex [--tg-primary:#ffffff] [--tg-primary-ink:#004f91]">
      {children}
    </span>
  );
}

/**
 * Le bandeau d'une page de la campagne qui ne porte pas sur un agent : son
 * auto-évaluation, son évaluation, le suivi de la DCH, l'administration.
 * L'icône de la page dans le rond des initiales, le titre et la coche s'il
 * y a lieu, la précision dessous, le geste de la page à droite ; puis le
 * filet orange et les repères.
 */
export function BandeauDePage({
  icone,
  titre,
  marque,
  sousTitre,
  action,
  reperes,
}: {
  icone: IconName;
  titre: string;
  /** La coche bleue d'une étape faite, passée en blanc sur le bleu. */
  marque?: React.ReactNode;
  sousTitre?: React.ReactNode;
  action?: React.ReactNode;
  /** Des `<Repere>`, cinq au plus. */
  reperes?: React.ReactElement[];
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-barre border border-card-line bg-surface shadow-xs"
    >
      <Bleu className="px-5 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-5">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/30 sm:size-16"
          >
            <Icon name={icone} size={26} />
          </span>
          <div className="min-w-0 flex-1 basis-52">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1
                id={id}
                className="text-[24px] leading-tight font-bold tracking-[-0.02em] sm:text-[28px]"
              >
                {titre}
              </h1>
              {marque ? <MarqueSurLeBleu>{marque}</MarqueSurLeBleu> : null}
            </div>
            {sousTitre ? (
              <p className="mt-1.5 text-[13.5px] leading-snug text-white/80 sm:text-[14.5px]">
                {sousTitre}
              </p>
            ) : null}
          </div>
          {action ? <div className="w-full sm:w-auto">{action}</div> : null}
        </div>
      </Bleu>
      <FiletDuBandeau />
      {reperes && reperes.length > 0 ? (
        <div className="@container px-5 py-5 sm:px-8">
          <GrilleDeReperes colonnes={reperes.length as 2 | 3 | 4 | 5}>{reperes}</GrilleDeReperes>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Le bandeau d'un compte sans dossier d'agent, l'administration : la
 * campagne elle-même, ses deux temps et leurs dates, numérotés comme sur la
 * carte de la période. La barre en dit déjà le titre : il ne se lit ici que
 * par les lecteurs d'écran. Le filet orange le ferme, comme celui de l'agent.
 */
export function BandeauDeLaCampagne({
  titre,
  periode,
}: {
  titre: string;
  periode: PeriodeDeLaCampagne | null;
}) {
  return (
    <section
      aria-labelledby="titre-de-la-campagne"
      className="overflow-hidden rounded-barre shadow-xs"
    >
      <h1 id="titre-de-la-campagne" className="sr-only">
        {titre}
      </h1>
      <Bleu className="px-5 py-7 sm:px-8 sm:py-9">
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
      <FiletDuBandeau />
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
 * Le titre d'une section de la campagne : en Anton, en capitales, dans le
 * bleu de la charte, souligné d'un filet orange comme le titre de la
 * connexion. À côté, s'il y a lieu, le nombre de ce qu'elle réunit ; devant,
 * une icône (le cadenas de la partie réservée). À droite, ce qui la
 * complète : qui la remplit, une recherche, un filtre. Dessous, une phrase
 * qui l'introduit. À 22 px, 20 sur un téléphone, sous le titre de la barre
 * (ADR-0240).
 */
export function TitreDeSection({
  id,
  nombre,
  icone,
  droite,
  chapeau,
  children,
}: {
  id?: string;
  nombre?: number;
  icone?: IconName;
  droite?: React.ReactNode;
  chapeau?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Sur un grand écran, ce qui complète le titre se range à sa hauteur, à
  // droite ; ailleurs, sous le filet. Le chapeau prend toute la largeur.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-6">
      <h2
        id={id}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 font-titre text-[20px] leading-[1.15] tracking-[0.015em] text-primary uppercase sm:col-start-1 sm:row-start-1 sm:text-[22px]"
      >
        {icone ? <Icon name={icone} size={20} className="-mr-1 self-center" /> : null}
        <span>{children}</span>
        {nombre !== undefined ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-soft px-2 font-sans text-[12px] font-bold tracking-normal text-primary tabular-nums">
            {nombre}
          </span>
        ) : null}
      </h2>
      <span
        aria-hidden
        className="mt-2.5 block h-[3px] w-10 rounded-full bg-accent sm:col-start-1 sm:row-start-2"
      />
      {droite ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-end">
          {droite}
        </div>
      ) : null}
      {chapeau ? (
        <div className="mt-3 text-[13px] leading-relaxed text-ink-muted sm:col-span-2 sm:row-start-3">
          {chapeau}
        </div>
      ) : null}
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
