'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { PublicCertificateView } from '@teranga/contracts';
import { cn, Skeleton } from '@teranga/ui';
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
 * Le verdict, d'abord : une phrase et son icône, lisibles avant tout le reste.
 * La couleur suit la sémantique des badges : teal pour ce qui est en règle,
 * orange pour ce qui demande attention, rouge pour ce qui ne vaut plus.
 */
const VERDICTS: Record<
  PublicCertificateView['status'],
  { icone: IconName; titre: string; couleur: string }
> = {
  valide: {
    icone: 'verified_user',
    titre: 'Certificat authentique',
    couleur: 'text-success',
  },
  expire: {
    icone: 'schedule',
    titre: 'Certificat expiré',
    couleur: 'text-warning',
  },
  revoque: {
    icone: 'verified_off',
    titre: 'Certificat révoqué',
    couleur: 'text-danger',
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
    // Le fond du volet de l'offre sur la page Postuler, un cran plus
    // soutenu pour détacher la carte. La carte tient dans l'écran, sans
    // défilement : sur un écran bas, ses marges se resserrent (`court:`).
    <main className="fond-certificat flex min-h-dvh flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-8 court:py-3">
        <div className="w-full max-w-[440px] overflow-hidden rounded-[20px] bg-surface shadow-[0_1px_2px_rgb(0_40_90/0.05),0_18px_48px_-18px_rgb(0_40_90/0.24)] ring-1 ring-[rgb(0_40_90/0.06)]">
          <header className="flex justify-center px-8 pt-7 court:pt-4">
            <BrandMark variant="candidature" repli="A" />
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
  return (
    <>
      <section className="px-8 pt-5 pb-6 court:pt-4 court:pb-5">
        <Verdict icone={verdict.icone} couleur={verdict.couleur} titre={verdict.titre} />
      </section>

      {/* Le titulaire et la formation, comme sur le certificat lui-même :
          le nom en grand, la formation dessous. */}
      <section className="mx-6 border-t border-dashed border-line px-2 pt-5 text-center sm:mx-8 court:pt-4">
        <p className="text-[10px] font-extrabold tracking-[0.16em] text-ink-muted uppercase">
          Décerné à
        </p>
        <p className="mt-1.5 text-[25px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-ink-strong court:text-[22px]">
          {c.holderName}
        </p>
        <p className="mt-3 text-[10px] font-extrabold tracking-[0.16em] text-ink-muted uppercase court:mt-2.5">
          Formation
        </p>
        <p className="mt-1 text-[15px] leading-snug font-bold text-balance text-ink">
          {c.courseTitle}
        </p>
      </section>

      {/* Les faits, comme un reçu : une ligne chacun, le libellé à gauche, la
          valeur à droite. */}
      <section className="px-6 pt-6 pb-7 sm:px-8 court:pt-4 court:pb-5">
        <dl className="divide-y divide-line-soft rounded-[14px] px-4 ring-1 ring-line">
          <Fait label="Score">{pourcent(c.score)}</Fait>
          <Fait label="Délivré le">{formatDate(c.issuedAt)}</Fait>
          <Fait label={c.status === 'expire' ? 'Expiré le' : 'Valable jusqu’au'}>
            {c.expiresAt ? formatDate(c.expiresAt) : 'Sans limite'}
          </Fait>
          <Fait label="Délivré par">{c.organizationName}</Fait>
          <Fait label="Numéro">
            <Numero numero={c.number} />
          </Fait>
        </dl>
      </section>
    </>
  );
}

/** Le verdict : le titre, précédé de son icône dans la couleur du statut. */
function Verdict({ icone, couleur, titre }: { icone: IconName; couleur: string; titre: string }) {
  return (
    <h1 className="flex items-center justify-center gap-2 text-center text-[21px] leading-tight font-extrabold tracking-[-0.015em] text-ink-strong">
      <Icon name={icone} size={24} fill className={cn('shrink-0', couleur)} />
      {titre}
    </h1>
  );
}

function Fait({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 court:min-h-10 court:py-2">
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
    <section className="flex flex-col items-center px-8 pt-5 pb-8 text-center court:pt-4 court:pb-7">
      <Verdict icone="error" couleur="text-danger" titre={titre} />
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
    <div className="flex flex-col items-center px-8 pt-6 pb-7" aria-busy>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-8 h-8 w-44" />
      <Skeleton className="mt-6 h-48 w-full rounded-[14px]" />
    </div>
  );
}
