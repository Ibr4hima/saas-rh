'use client';

import * as React from 'react';
import { passwordRulesFor } from '@teranga/contracts';
import { cn, Input } from '@teranga/ui';
import { BrandMark } from './brand-mark';
import { Icon, type IconName } from './icons';
import { useThemeClair } from './preferences';

/* ── Les motifs de la charte ─────────────────────────────────────────
   La courbe du bas et les ondulations, tracées comme sur le certificat
   d'APIX Academy et au bas des courriels (ADR-0185, ADR-0186) : le même
   bord de courbe que le papier à en-tête, en points de l'A4. */
const ARCS = [
  [
    [0, 769.7],
    [99.12, 787.94],
    [200.97, 780.65],
    [300.25, 767.28],
  ],
  [
    [300.25, 767.28],
    [374.96, 757.09],
    [448.99, 742.17],
    [522.22, 724.29],
  ],
  [
    [522.22, 724.29],
    [546.66, 718.4],
    [571.01, 712.15],
    [595.28, 705.59],
  ],
] as const;

/** La bande, en unités de son cadre : étirée sur la largeur de l'écran. */
const BANDE_L = 1440;
const BANDE_H = 120;
const n = (v: number) => Number(v.toFixed(1));
const enX = (x: number) => (x * BANDE_L) / 595.28;
/**
 * La courbe part à 52 du haut, à gauche, et monte à 4, à droite. Sous son
 * creux, le pied garde de l'air, même quand la bande s'abaisse.
 */
const enY = (y: number) => 4 + ((y - 705.59) * 48) / (769.7 - 705.59);
const ARCS_BANDE = ARCS.map((arc) => arc.map(([x, y]) => [enX(x), enY(y)] as const));

/** Le bord de la courbe, échantillonné de gauche à droite. */
const BORD = ARCS_BANDE.flatMap((arc, i) =>
  Array.from({ length: 33 }, (_, k) => k / 32)
    .slice(i === 0 ? 0 : 1)
    .map((t) => {
      const u = 1 - t;
      const c = (k: 0 | 1) =>
        u * u * u * arc[0]![k] +
        3 * u * u * t * arc[1]![k] +
        3 * u * t * t * arc[2]![k] +
        t * t * t * arc[3]![k];
      return [c(0), c(1)] as const;
    }),
);

function bordA(x: number): number {
  for (let i = 1; i < BORD.length; i += 1) {
    const [x1, y1] = BORD[i]!;
    const [x0, y0] = BORD[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return BORD.at(-1)![1];
}

const TRACE_BANDE =
  `M${n(ARCS_BANDE[0]![0]![0])} ${n(ARCS_BANDE[0]![0]![1])}` +
  ARCS_BANDE.map(
    ([, p1, p2, p3]) =>
      `C${n(p1![0])} ${n(p1![1])} ${n(p2![0])} ${n(p2![1])} ${n(p3![0])} ${n(p3![1])}`,
  ).join('') +
  `L${BANDE_L} ${BANDE_H}L0 ${BANDE_H}Z`;

/** Les ondulations de la bande : des lignes qui suivent la courbe. */
const ONDES_BANDE = Array.from({ length: 12 }, (_, i) => {
  const points: string[] = [];
  for (let x = 0; x <= BANDE_L; x += 12) {
    const y =
      bordA(x) + 8 + i * 7.5 + 2.4 * Math.sin((2 * Math.PI * x) / 260 + i * 0.4) * (1 - i / 14);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

/** Les ondulations du coin, qui montent vers la droite comme la courbe. */
const ONDES_COIN = Array.from({ length: 20 }, (_, k) => {
  const points: string[] = [];
  for (let x = 0; x <= 640; x += 10) {
    const y = 26 + k * 15 - 0.42 * x + 11 * Math.sin((2 * Math.PI * x) / 380 + k * 0.25);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

/**
 * La courbe bleue de la charte, soulignée d'orange, au bas de l'écran. Le
 * cadre s'étire en largeur ; les ondulations gardent leur trait d'un pixel.
 */
function CourbeDeLaCharte() {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${BANDE_L} ${BANDE_H}`}
      preserveAspectRatio="none"
      className="block h-[136px] w-full sm:h-[120px] sm:court:h-[92px]"
    >
      <defs>
        <linearGradient id={`${id}-fond`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#004f91" />
          <stop offset="1" stopColor="#003a6c" />
        </linearGradient>
        <clipPath id={`${id}-bande`}>
          <path d={TRACE_BANDE} />
        </clipPath>
      </defs>
      <path d={TRACE_BANDE} transform="translate(0 -4)" fill="#ca631f" />
      <path d={TRACE_BANDE} fill={`url(#${id}-fond)`} />
      <g clipPath={`url(#${id}-bande)`} fill="none" stroke="#ffffff" strokeOpacity="0.09">
        {ONDES_BANDE.map((points, i) => (
          <polyline key={i} points={points} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

/** Les ondulations du coin, à peine visibles, qui s'effacent vers le centre. */
function OndulationsDuCoin() {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden
      viewBox="0 0 640 420"
      className="pointer-events-none absolute top-0 right-0 -z-10 hidden h-[420px] w-[640px] max-w-[90vw] text-primary/15 sm:block"
    >
      <defs>
        <linearGradient id={`${id}-fondu`} x1="1" y1="0" x2="0.15" y2="0.85">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-masque`}>
          <rect width="640" height="420" fill={`url(#${id}-fondu)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-masque)`} fill="none" stroke="currentColor" strokeWidth="1">
        {ONDES_COIN.map((points, i) => (
          <polyline key={i} points={points} />
        ))}
      </g>
    </svg>
  );
}

/**
 * La scène des écrans qui précèdent le compte : connexion, création,
 * activation d'une invitation, mot de passe oublié ou à refaire.
 *
 * À la charte de l'APIX, comme le certificat d'APIX Academy et les courriels
 * (ADR-0187) : la marque en tête, la carte au milieu, son titre souligné d'un
 * filet orange ; en bas, la courbe bleue de la charte, soulignée d'orange,
 * qui porte le pied ; dans le coin, ses ondulations. Toujours en clair, quel
 * que soit le thème choisi dans l'application : on le retrouve après la
 * connexion. Sur un écran bas, les marges se resserrent et la courbe
 * s'abaisse : la carte tient sans défilement.
 *
 * Elle vit ici et non dans chaque page : cinq écrans qui recopient le même
 * décor finissent par en avoir cinq versions, et c'est le premier écran du
 * produit qui se met à loucher.
 */
export function EcranMarque({
  titre,
  sousTitre,
  pied,
  children,
}: {
  titre: React.ReactNode;
  sousTitre?: React.ReactNode;
  /** Bande de bas de carte : le lien vers l'écran voisin, s'il y en a un. */
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  useThemeClair();
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg">
      <OndulationsDuCoin />

      <div className="flex flex-1 flex-col items-center justify-center px-5 pt-7 pb-6 sm:pt-12 sm:pb-10 court:pt-5 court:pb-5">
        <div className="login-monte flex flex-col items-center">
          <BrandMark variant="connexion" />
          <div className="mt-4 flex items-center gap-3.5 court:mt-3">
            <span className="hidden h-px w-11 bg-linear-to-r from-transparent to-primary/30 sm:block" />
            <p className="text-center text-[10.5px] font-bold tracking-[0.16em] text-primary uppercase">
              Système de Gestion des Ressources Humaines
            </p>
            <span className="hidden h-px w-11 bg-linear-to-r from-primary/30 to-transparent sm:block" />
          </div>
        </div>

        <div
          className="login-monte relative mt-8 w-full max-w-[27rem] court:mt-5"
          style={{ '--retard': '0.08s' } as React.CSSProperties}
        >
          {/* Le rayon est celui des cartes de l'application : ces écrans n'ont
              pas de raison d'avoir leur propre rondeur. */}
          <div className="relative overflow-hidden rounded-bloc border border-card-line bg-surface shadow-[0_1px_2px_rgb(0_40_90/0.05),0_2px_6px_-2px_rgb(0_40_90/0.06),0_24px_56px_-24px_rgb(0_40_90/0.28)]">
            <div className="px-7 pt-9 pb-7 sm:px-9 court:pt-7 court:pb-6">
              <h1 className="text-center text-[25px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-ink-strong">
                {titre}
              </h1>
              {/* Le filet orange de la charte sous le titre, comme sur le
                  certificat et les courriels. */}
              <span
                aria-hidden
                className="mx-auto mt-3 block h-[3px] w-10 rounded-full bg-accent"
              />
              {sousTitre ? (
                <p className="mt-3.5 text-center text-[13.5px] leading-relaxed text-pretty text-ink-muted">
                  {sousTitre}
                </p>
              ) : null}
              {children}
            </div>

            {pied ? (
              <div className="border-t border-line-soft bg-surface-raised px-7 py-4 text-center text-[13px] text-ink-muted sm:px-9 court:py-3">
                {pied}
              </div>
            ) : null}
          </div>
        </div>

        <p
          className="login-monte mt-6 flex max-w-[27rem] items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted court:mt-4"
          style={{ '--retard': '0.2s' } as React.CSSProperties}
        >
          <Icon name="lock" size={13} className="mt-px shrink-0" />
          Accès réservé aux agents de l&apos;APIX disposant d&apos;un compte professionnel
        </p>
      </div>

      {/* Le pied, en blanc sur la courbe de la charte. */}
      <footer className="relative shrink-0">
        <CourbeDeLaCharte />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 px-6 pb-4 text-[11.5px] text-white/85 sm:flex-row sm:justify-between sm:px-10 sm:pb-5 sm:court:pb-3.5">
          <span>© {new Date().getFullYear()} APIX S.A · DCH. Tous droits réservés.</span>
          <span>Plateforme à usage interne</span>
        </div>
      </footer>
    </main>
  );
}

/**
 * Un champ de ces écrans : micro-libellé en capitales, icône de tête qui prend
 * la couleur de marque au focus, message sous le champ.
 *
 * Écrit ici plutôt que repris de `Field` : ces écrans portent la typographie
 * de la marque et non celle des formulaires de l'application. Le câblage
 * d'accessibilité que `Field` apporte est refait, pas abandonné.
 */
export function ChampMarque({
  id,
  label,
  icone,
  erreur,
  indication,
  ton = 'muet',
  children,
}: {
  id: string;
  label: string;
  icone: IconName;
  erreur?: string;
  indication?: React.ReactNode;
  /** L'indication avertit-elle, ou se contente-t-elle d'informer ? */
  ton?: 'muet' | 'alerte';
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[10.5px] font-extrabold tracking-[0.1em] text-primary uppercase"
      >
        {label}
      </label>
      <div className="group relative">
        <Icon
          name={icone}
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted transition-colors duration-150 group-focus-within:text-primary"
        />
        {children}
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} className="mt-1.5 text-xs text-danger">
          {erreur}
        </p>
      ) : indication ? (
        <p
          id={`${id}-indication`}
          className={cn('mt-1.5 text-xs', ton === 'alerte' ? 'text-warning' : 'text-ink-muted')}
        >
          {indication}
        </p>
      ) : null}
    </div>
  );
}

/** Le champ de saisie de ces écrans — haut, à icône, coins doux. */
export function SaisieMarque({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  return (
    <Input
      className={cn(
        'h-12 rounded-lg border-[1.5px] bg-surface-raised pr-3 pl-10 text-[14.5px] court:h-11',
        className,
      )}
      {...props}
    />
  );
}

/** L'œil qui dévoile un mot de passe, posé au bout du champ. */
export function BoutonOeil({
  visible,
  onToggle,
  disabled,
}: {
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={visible ? 'visibility_off' : 'visibility'} size={17} />
    </button>
  );
}

/**
 * Un mot de passe se tape : il ne se copie, ne se coupe, ne se colle ni ne se
 * dépose. La confirmation sert à prouver qu'on le connaît ; recopiée par un
 * copier-coller, elle reproduirait la faute de frappe au lieu de la révéler.
 * Le remplissage d'un gestionnaire de mots de passe n'est pas un collage : il
 * passe toujours.
 */
export const SANS_COPIER_COLLER = {
  onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
  onCut: (e: React.ClipboardEvent) => e.preventDefault(),
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
  onDrop: (e: React.DragEvent) => e.preventDefault(),
};

/**
 * Toutes les règles affichées sous le champ sont remplies. Tant qu'elles ne le
 * sont pas, la confirmation reste fermée : on ne confirme pas un mot de passe
 * que le serveur refusera.
 */
export function motDePasseConforme(password: string, email: string): boolean {
  return passwordRulesFor(email).every((regle) => regle.ok(password));
}

/**
 * La politique de mot de passe, cochée en direct.
 *
 * Les règles viennent des contrats — les mêmes que le serveur revalide. Une
 * liste recopiée dans l'écran finirait par promettre ce que l'API refuse.
 *
 * Elle ne paraît qu'une fois la saisie commencée : six lignes de contraintes
 * sur un champ vide accueillent mal, et elles n'apprennent rien tant qu'il n'y
 * a rien à vérifier.
 */
export function ReglesMotDePasse({ password, email }: { password: string; email: string }) {
  if (password.length === 0) return null;
  return (
    <ul
      aria-label="Exigences du mot de passe"
      className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2"
    >
      {passwordRulesFor(email).map((regle) => {
        const ok = regle.ok(password);
        return (
          <li
            key={regle.libelle}
            className={cn(
              'flex items-center gap-1.5 text-[11px] font-semibold transition-colors duration-150',
              ok ? 'text-success' : 'text-ink-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full',
                ok ? 'bg-success/15' : 'bg-line-soft',
              )}
            >
              {ok ? <Icon name="check" size={10} /> : null}
            </span>
            {/* Le lecteur d'écran a besoin de l'état, que la couleur seule ne
                lui donne pas. */}
            <span className="sr-only">{ok ? 'Rempli :' : 'Manquant :'}</span>
            {regle.libelle}
          </li>
        );
      })}
    </ul>
  );
}
