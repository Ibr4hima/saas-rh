'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { useState } from 'react';
import { premierDuMois, type PublicCertificateView } from '@teranga/contracts';
import { cn, Skeleton } from '@teranga/ui';
import { Icon, type IconName } from '../../../components/icons';
import { SceneDeLaCharte } from '../../../components/scene-de-la-charte';
import { api, ApiError } from '../../../lib/api';

/* ────────────────────────────────────────────────────────────────
   La vérification publique d'un certificat APIX Academy.

   C'est la page qu'ouvre le QR code imprimé sur le certificat. Elle ne
   demande aucun compte : un recruteur, un partenaire, une administration y
   confirme en un coup d'œil qu'un certificat présenté est AUTHENTIQUE, et
   qu'il est toujours valable.

   Elle ne montre que ce que le certificat imprimé dit déjà : le titulaire,
   la formation, le score, les dates. Rien du dossier de l'agent.

   Sur la scène de la charte, comme les écrans de connexion (ADR-0188) : le
   verdict en tête de la carte, puis le certificat dans ses propres mots, son
   sceau et ses mentions, disposés comme sur le papier.
   ──────────────────────────────────────────────────────────────── */

type Ton = 'succes' | 'attention' | 'danger';

/**
 * Le verdict, d'abord : une phrase et son icône, lisibles avant tout le reste.
 * La couleur suit la sémantique des badges : vert pour ce qui est en règle,
 * ambre pour ce qui demande attention, rouge pour ce qui ne vaut plus.
 */
const VERDICTS: Record<
  PublicCertificateView['status'],
  { icone: IconName; titre: string; ton: Ton }
> = {
  valide: { icone: 'verified_user', titre: 'Certificat authentique', ton: 'succes' },
  expire: { icone: 'schedule', titre: 'Certificat expiré', ton: 'attention' },
  revoque: { icone: 'verified_off', titre: 'Certificat révoqué', ton: 'danger' },
};

const TONS: Record<Ton, string> = {
  succes: 'bg-success-soft text-success',
  attention: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

/** « 25 septembre 2026 », comme sur le certificat ; une date ne se coupe pas. */
function dateLongue(iso: string): string {
  return premierDuMois(
    new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  ).replace(/ /g, ' ');
}

/** Arrondi par défaut, comme sur le certificat : 79,6 % ne s'affiche jamais « 80 % ». */
function enPourcent(part: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, part)) * 100 + 1e-9)}`;
}

export default function VerifierPage() {
  const { numero } = useParams<{ numero: string }>();
  const saisi = decodeURIComponent(numero);
  const verification = useQuery({
    queryKey: ['verification', numero],
    queryFn: () => api<PublicCertificateView>(`/public/certificats/${encodeURIComponent(saisi)}`),
    retry: false,
  });
  const inconnu =
    verification.isError &&
    verification.error instanceof ApiError &&
    verification.error.problem.status === 404;
  const c = verification.data;

  return (
    <SceneDeLaCharte signature="APIX Academy" repli="A">
      <div
        className="login-monte relative mt-8 w-full max-w-[34rem] court:mt-5"
        style={{ '--retard': '0.08s' } as React.CSSProperties}
      >
        <div className="relative overflow-hidden rounded-bloc border border-card-line bg-surface shadow-[0_1px_2px_rgb(0_40_90/0.05),0_2px_6px_-2px_rgb(0_40_90/0.06),0_24px_56px_-24px_rgb(0_40_90/0.28)]">
          {verification.isPending ? (
            <Chargement />
          ) : c ? (
            <Certificat c={c} />
          ) : (
            <Echec
              titre={inconnu ? 'Certificat introuvable' : 'Vérification impossible'}
              detail={
                inconnu ? 'Aucun certificat ne porte ce numéro.' : 'Réessayez dans un instant.'
              }
              numero={inconnu ? saisi : null}
            />
          )}
        </div>
      </div>
    </SceneDeLaCharte>
  );
}

/** Le verdict, en bandeau sur toute la largeur de la carte. */
function Verdict({ icone, titre, ton }: { icone: IconName; titre: string; ton: Ton }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2.5 border-b border-current/10 px-6 py-3.5 court:py-3',
        TONS[ton],
      )}
    >
      <Icon name={icone} size={22} fill className="shrink-0" />
      <h1 className="text-[17px] leading-tight font-extrabold tracking-[-0.01em]">{titre}</h1>
    </div>
  );
}

/**
 * Le certificat vérifié : le verdict, puis le certificat dans ses propres
 * mots, et en bas, comme sur le papier, les dates à gauche, le sceau au
 * milieu, la référence à droite.
 */
function Certificat({ c }: { c: PublicCertificateView }) {
  const verdict = VERDICTS[c.status];
  return (
    <>
      <Verdict {...verdict} />

      <div className="px-6 pt-6 pb-6 text-center sm:px-10 court:pt-5 court:pb-5">
        <p className="text-[11px] font-bold tracking-[0.3em] text-accent-text uppercase">
          {c.score === null ? 'Certificat de formation' : 'Certificat de réussite'}
        </p>
        {/* Le filet orange de la charte, comme sous le titre du certificat. */}
        <span aria-hidden className="mx-auto mt-2.5 block h-[3px] w-10 rounded-full bg-accent" />
        <p className="mt-4 text-[13px] text-ink-muted italic court:mt-3">décerné à</p>
        <p className="mt-0.5 text-[26px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-ink-strong court:text-[24px]">
          {c.holderName}
        </p>
        <p className="mt-3 text-[13.5px] text-ink-muted court:mt-2.5">
          pour avoir suivi la formation en ligne
        </p>
        <p className="mt-1 text-[17px] leading-snug font-bold text-balance text-primary">
          «&nbsp;{c.courseTitle}&nbsp;»
        </p>
        <p className="mt-1.5 text-[13.5px] text-pretty text-ink-muted">
          {c.score === null ? (
            'et validé chacune de ses leçons.'
          ) : (
            <>
              et réussi son évaluation finale avec un score de{' '}
              <span className="font-bold text-accent-text">{enPourcent(c.score)}&nbsp;%</span>.
            </>
          )}
        </p>
      </div>

      <div className="border-t border-line-soft bg-surface-raised px-6 py-5 sm:px-8 court:py-4">
        {/* Sur un téléphone, le sceau au-dessus des deux colonnes ; plus
            large, entre elles. */}
        <div className="grid grid-cols-2 items-start gap-x-4 gap-y-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-x-6">
          {/* Le sceau du certificat ; terni quand le certificat ne vaut plus. */}
          <Sceau
            score={c.score}
            terni={c.status !== 'valide'}
            className="col-span-2 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1"
          />
          <dl className="space-y-3 text-left sm:col-start-1 sm:row-start-1">
            <Fait label="Délivré le">{dateLongue(c.issuedAt)}</Fait>
            <Fait label="Validité">
              {c.expiresAt ? `Jusqu’au ${dateLongue(c.expiresAt)}` : 'Sans limite'}
            </Fait>
          </dl>
          <dl className="space-y-3 text-right sm:col-start-3 sm:row-start-1">
            <Fait label="Référence">
              <Numero numero={c.number} />
            </Fait>
            <Fait label="Délivré par">{c.organizationName}</Fait>
          </dl>
        </div>

        {c.reemisSous ? (
          <p className="mt-4 border-t border-line-soft pt-3.5 text-center text-[13px] text-ink-muted">
            Réémis sous{' '}
            <Link
              href={`/verifier/${c.reemisSous}`}
              className="font-mono font-bold tracking-[0.04em] text-primary underline-offset-2 hover:underline"
            >
              {c.reemisSous}
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Une mention du certificat : l'intitulé au-dessus de la valeur, comme au bas du certificat. */
function Fait({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-bold tracking-[0.14em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[14px] font-semibold text-pretty text-ink-strong">{children}</dd>
    </div>
  );
}

/** Le numéro, à recopier dans un dossier : il se copie d'un geste. */
function Numero({ numero }: { numero: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="truncate font-mono text-[13.5px] font-bold tracking-[0.04em]">{numero}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(numero).then(() => {
            setCopie(true);
            window.setTimeout(() => setCopie(false), 1600);
          });
        }}
        aria-label={copie ? 'Numéro copié' : 'Copier le numéro'}
        title={copie ? 'Copié' : 'Copier'}
        className={cn(
          '-my-1.5 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          copie ? 'text-success' : 'text-ink-muted hover:bg-hover hover:text-primary',
        )}
      >
        <Icon name={copie ? 'check' : 'content_copy'} size={16} />
      </button>
    </span>
  );
}

/* ──── Le sceau ──────────────────────────────────────────────────────── */

/** La rosace du sceau : 44 dents, comme sur le certificat. */
const ROSACE = Array.from({ length: 88 }, (_, k) => {
  const a = (Math.PI * k) / 44 - Math.PI / 2;
  const r = k % 2 === 0 ? 50 : 46.6;
  return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

/**
 * Le sceau du certificat, redessiné pour l'écran : la rosace orange, le
 * disque bleu, « APIX ACADEMY » en haut de l'anneau, « RÉUSSITE » ou
 * « FORMATION » en bas, et au centre le score, ou une coche. Il ne fait que
 * répéter le texte : les lecteurs d'écran le passent.
 */
function Sceau({
  score,
  terni,
  className,
}: {
  score: number | null;
  terni: boolean;
  className?: string;
}) {
  const id = React.useId().replace(/:/g, '');
  const valeur = score === null ? null : enPourcent(score);
  // « 100 » est plus large que « 80 » : il se resserre pour garder son air
  // dans l'anneau.
  const corps = valeur && valeur.length > 2 ? 19 : 23;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      className={cn('size-[88px] shrink-0', terni && 'opacity-60 grayscale', className)}
    >
      <defs>
        {/* Le texte du haut se pose sur l'anneau ; celui du bas suit le
            cercle à l'envers, pour se lire lui aussi de gauche à droite. */}
        <path id={`${id}-haut`} d="M18.3 50A31.7 31.7 0 0 1 81.7 50" />
        <path id={`${id}-bas`} d="M13.7 50A36.3 36.3 0 0 0 86.3 50" />
      </defs>
      <polygon points={ROSACE} fill="#ca631f" />
      <circle cx="50" cy="50" r="44" fill="#004f91" />
      <g fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.7">
        <circle cx="50" cy="50" r="40.5" />
        <circle cx="50" cy="50" r="27.5" />
      </g>
      <g fill="#fff" fontSize="6.6" fontWeight="500" letterSpacing="1.9">
        <text textAnchor="middle">
          <textPath href={`#${id}-haut`} startOffset="50%">
            APIX ACADEMY
          </textPath>
        </text>
        <text textAnchor="middle">
          <textPath href={`#${id}-bas`} startOffset="50%">
            {score === null ? 'FORMATION' : 'RÉUSSITE'}
          </textPath>
        </text>
      </g>
      <circle cx="16" cy="50" r="1.1" fill="#ca631f" />
      <circle cx="84" cy="50" r="1.1" fill="#ca631f" />
      {valeur ? (
        // Le centre optique, un peu au-dessus du centre : la ligne de base
        // descend de la moitié des chiffres, moins un point.
        <text x="50" y={49 + corps * 0.36} textAnchor="middle" fill="#fff" fontWeight="700">
          <tspan fontSize={corps}>{valeur}</tspan>
          <tspan fontSize={corps * 0.48} dx="0.6">
            %
          </tspan>
        </text>
      ) : (
        <path
          d="M40 50.5 47 57.5 61 42.5"
          fill="none"
          stroke="#fff"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Un numéro inconnu, ou un serveur injoignable : le verdict en rouge, et pourquoi. */
function Echec({
  titre,
  detail,
  numero,
}: {
  titre: string;
  detail: string;
  numero: string | null;
}) {
  return (
    <>
      <Verdict icone="error" titre={titre} ton="danger" />
      <div className="flex flex-col items-center px-8 pt-6 pb-7 text-center court:pt-5 court:pb-6">
        <p className="text-[14px] text-ink-muted">{detail}</p>
        {numero ? (
          <p className="mt-4 rounded-controle bg-bg px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.04em] text-ink">
            {numero}
          </p>
        ) : null}
      </div>
    </>
  );
}

function Chargement() {
  return (
    <div aria-busy>
      <Skeleton className="h-[50px] w-full rounded-none" />
      <div className="flex flex-col items-center px-8 pt-6 pb-6">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="mt-6 h-7 w-56" />
        <Skeleton className="mt-4 h-4 w-64" />
        <Skeleton className="mt-2 h-5 w-48" />
      </div>
      <Skeleton className="h-32 w-full rounded-none" />
    </div>
  );
}
