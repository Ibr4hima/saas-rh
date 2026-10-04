'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { PublicCertificateView } from '@teranga/contracts';
import { ACADEMY_CATEGORY_LABELS } from '@teranga/contracts';
import { Badge, type BadgeTone, cn, Skeleton } from '@teranga/ui';
import { BrandMark } from '../../../components/brand-mark';
import { Icon, type IconName } from '../../../components/icons';
import { useThemeClair } from '../../../components/preferences';
import { api, ApiError } from '../../../lib/api';
import { pourcent } from '../../../lib/academy';
import { formatDate } from '../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   La vérification publique d'un certificat APIX Academy.

   C'est la page qu'ouvre le QR code imprimé sur le certificat. Elle ne
   demande aucun compte : un recruteur, un partenaire, une administration y
   confirme en un coup d'œil qu'un certificat présenté est AUTHENTIQUE, et
   qu'il est toujours valable.

   Elle ne montre que ce que le certificat imprimé dit déjà — titulaire,
   formation, score, dates. Rien du dossier de l'agent.
   ———————————————————————————————————————————————————————————————— */

/**
 * Le verdict, d'abord : un sceau et une phrase, lisibles avant tout le reste.
 * La couleur suit la sémantique des badges : teal pour ce qui est en règle,
 * orange pour ce qui demande attention, rouge pour ce qui ne vaut plus.
 */
const VERDICTS: Record<
  PublicCertificateView['status'],
  { icone: IconName; titre: string; sceau: string; badge: BadgeTone | null }
> = {
  valide: {
    icone: 'verified_user',
    titre: 'Certificat authentique',
    sceau: 'bg-success-soft text-success ring-success/15',
    badge: 'teal',
  },
  expire: {
    icone: 'schedule',
    titre: 'Certificat authentique',
    sceau: 'bg-warning-soft text-warning ring-warning/15',
    badge: 'orange',
  },
  revoque: {
    icone: 'verified_off',
    titre: 'Certificat révoqué',
    sceau: 'bg-danger-soft text-danger ring-danger/15',
    badge: null,
  },
};

export default function VerifierPage() {
  useThemeClair();
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
    // Le fond de l'écran de connexion, à l'identique : le dôme de marque et
    // son décor (cf. `EcranMarque`).
    <main className="login-dome flex min-h-dvh flex-col">
      <div aria-hidden className="login-decor" />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] bg-surface shadow-[0_30px_70px_rgb(0_0_0/0.28),0_4px_14px_rgb(0_0_0/0.10)]">
          <header className="flex flex-col items-center gap-3 px-8 pt-9">
            <BrandMark variant="candidature" repli="A" />
            <p className="text-[10.5px] font-extrabold tracking-[0.18em] text-primary uppercase">
              APIX Academy
            </p>
          </header>

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
    </main>
  );
}

/** Le certificat vérifié : le verdict, le titulaire, puis les faits. */
function Certificat({ c }: { c: PublicCertificateView }) {
  const verdict = VERDICTS[c.status];
  const etat =
    c.status === 'valide'
      ? c.expiresAt
        ? `Valable jusqu’au ${formatDate(c.expiresAt)}`
        : 'Valable sans limite'
      : c.status === 'expire' && c.expiresAt
        ? `Expiré le ${formatDate(c.expiresAt)}`
        : null;
  return (
    <>
      <section className="flex flex-col items-center px-8 pt-7 pb-8 text-center">
        <Sceau icone={verdict.icone} ton={verdict.sceau} />
        <h1 className="mt-5 text-[22px] leading-tight font-extrabold tracking-[-0.015em] text-ink-strong">
          {verdict.titre}
        </h1>
        {verdict.badge && etat ? (
          <div className="mt-2.5">
            <Badge tone={verdict.badge}>{etat}</Badge>
          </div>
        ) : null}
      </section>

      {/* Le titulaire et la formation, comme sur le certificat lui-même :
          le nom en grand, la formation dessous. */}
      <section className="mx-6 border-t border-dashed border-line px-2 pt-7 text-center sm:mx-8">
        <p className="text-[10px] font-extrabold tracking-[0.16em] text-ink-muted uppercase">
          Décerné à
        </p>
        <p className="mt-2 text-[26px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-ink-strong">
          {c.holderName}
        </p>
        <p className="mt-4 text-[10px] font-extrabold tracking-[0.16em] text-ink-muted uppercase">
          Formation
        </p>
        <p className="mt-1.5 text-[15px] leading-snug font-bold text-balance text-ink">
          {c.courseTitle}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {ACADEMY_CATEGORY_LABELS[c.courseCategory]}
        </p>
      </section>

      {/* Les faits, comme un reçu : une ligne chacun, le libellé à gauche, la
          valeur à droite. La validité n'y figure pas, le badge la dit déjà. */}
      <section className="px-6 pt-7 pb-8 sm:px-8">
        <dl className="divide-y divide-line-soft rounded-[18px] px-4 ring-1 ring-line">
          <Fait label="Score">{pourcent(c.score)}</Fait>
          <Fait label="Délivré le">{formatDate(c.issuedAt)}</Fait>
          <Fait label="Délivré par">{c.organizationName}</Fait>
          <Fait label="Numéro">
            <Numero numero={c.number} />
          </Fait>
        </dl>
      </section>
    </>
  );
}

/** Le sceau du verdict : un disque teinté, cerclé d'un halo, qui apparaît. */
function Sceau({ icone, ton }: { icone: IconName; ton: string }) {
  return (
    <span
      className={cn(
        'sceau-apparition flex size-[68px] items-center justify-center rounded-full ring-[10px]',
        ton,
      )}
    >
      <Icon name={icone} size={34} fill />
    </span>
  );
}

function Fait({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13.5px] font-semibold text-ink-strong tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Le numéro, à recopier dans un dossier : il se copie d'un geste. */
function Numero({ numero }: { numero: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <span className="flex items-center justify-end gap-1">
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

/** Un numéro inconnu, ou un serveur injoignable : le sceau en rouge, et pourquoi. */
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
    <section className="flex flex-col items-center px-8 pt-7 pb-10 text-center">
      <Sceau icone="error" ton="bg-danger-soft text-danger ring-danger/15" />
      <h1 className="mt-5 text-[22px] leading-tight font-extrabold tracking-[-0.015em] text-ink-strong">
        {titre}
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink-muted">{detail}</p>
      {numero ? (
        <p className="mt-4 rounded-full bg-bg px-3.5 py-1.5 font-mono text-[12.5px] font-bold tracking-[0.04em] text-ink">
          {numero}
        </p>
      ) : null}
    </section>
  );
}

function Chargement() {
  return (
    <div className="flex flex-col items-center px-8 pt-7 pb-8" aria-busy>
      <Skeleton className="size-[68px] rounded-full" />
      <Skeleton className="mt-5 h-6 w-56" />
      <Skeleton className="mt-8 h-8 w-44" />
      <Skeleton className="mt-7 h-32 w-full rounded-[18px]" />
    </div>
  );
}
