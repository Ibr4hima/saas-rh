'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PublicCertificateView } from '@teranga/contracts';
import { ACADEMY_CATEGORY_LABELS } from '@teranga/contracts';
import { Button, Card, cn, Input, Skeleton } from '@teranga/ui';
import { BrandMark } from '../../../components/brand-mark';
import { Icon, type IconName } from '../../../components/icons';
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

const VERDICTS: Record<
  PublicCertificateView['status'],
  { icone: IconName; titre: string; ton: string }
> = {
  valide: {
    icone: 'verified_user',
    titre: 'Certificat authentique et valable',
    ton: 'bg-success-soft text-success ring-success/25',
  },
  expire: {
    icone: 'schedule',
    titre: 'Certificat authentique, mais expiré',
    ton: 'bg-warning-soft text-warning ring-warning/25',
  },
  revoque: {
    icone: 'error',
    titre: 'Certificat révoqué',
    ton: 'bg-danger-soft text-danger ring-danger/25',
  },
};

function AutreNumero() {
  const router = useRouter();
  const [saisie, setSaisie] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (saisie.trim()) router.push(`/verifier/${encodeURIComponent(saisie.trim())}`);
      }}
    >
      <Input
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder="APX-XXXX-XXXX"
        aria-label="Numéro de certificat"
        className="h-9 flex-1 font-mono uppercase"
      />
      <Button type="submit" variant="secondary" disabled={!saisie.trim()}>
        Vérifier
      </Button>
    </form>
  );
}

export default function VerifierPage() {
  const { numero } = useParams<{ numero: string }>();
  const verification = useQuery({
    queryKey: ['verification', numero],
    queryFn: () =>
      api<PublicCertificateView>(
        `/public/certificats/${encodeURIComponent(decodeURIComponent(numero))}`,
      ),
    retry: false,
  });
  const inconnu =
    verification.isError &&
    verification.error instanceof ApiError &&
    verification.error.problem.status === 404;
  const c = verification.data;
  const verdict = c ? VERDICTS[c.status] : null;

  return (
    <main className="fond-candidature min-h-dvh overflow-y-auto p-5">
      <div className="mx-auto flex min-h-[calc(100dvh-40px)] max-w-lg flex-col justify-center gap-4 py-6">
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center gap-2 border-b border-line-soft px-6 pt-8 pb-5 text-center">
            <BrandMark variant="candidature" repli="A" />
            <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
              APIX Academy · Vérification de certificat
            </p>
          </div>

          <div className="flex flex-col gap-5 px-6 py-6">
            {verification.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : c && verdict ? (
              <>
                <p
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-[12px] px-4 py-3 text-[14px] font-bold ring-1 ring-inset',
                    verdict.ton,
                  )}
                >
                  <Icon name={verdict.icone} size={20} />
                  {verdict.titre}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px]">
                  <dt className="text-ink-muted">Titulaire</dt>
                  <dd className="font-bold text-ink-strong">{c.holderName}</dd>
                  <dt className="text-ink-muted">Formation</dt>
                  <dd className="font-semibold text-ink">
                    {c.courseTitle}
                    <span className="block text-[12px] font-normal text-ink-muted">
                      {ACADEMY_CATEGORY_LABELS[c.courseCategory]}
                    </span>
                  </dd>
                  <dt className="text-ink-muted">Score</dt>
                  <dd className="font-semibold text-ink">{pourcent(c.score)}</dd>
                  <dt className="text-ink-muted">Délivré le</dt>
                  <dd className="text-ink">{formatDate(c.issuedAt)}</dd>
                  <dt className="text-ink-muted">Validité</dt>
                  <dd className="text-ink">
                    {c.expiresAt ? `Jusqu’au ${formatDate(c.expiresAt)}` : 'Sans limite'}
                  </dd>
                  <dt className="text-ink-muted">Délivré par</dt>
                  <dd className="text-ink">{c.organizationName}</dd>
                  <dt className="text-ink-muted">Numéro</dt>
                  <dd className="font-mono font-bold tracking-tight text-ink">{c.number}</dd>
                </dl>
              </>
            ) : (
              <p className="flex items-start gap-2.5 rounded-[12px] bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger">
                <Icon name="error" size={19} className="mt-px shrink-0" />
                {inconnu
                  ? 'Aucun certificat ne porte ce numéro. Vérifiez la saisie : APX, puis deux groupes de quatre caractères.'
                  : 'La vérification n’a pas pu se faire. Réessayez dans un instant.'}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-line-soft bg-bg/60 px-6 py-4">
            <p className="text-[11.5px] font-semibold text-ink-muted">Vérifier un autre numéro</p>
            <AutreNumero />
          </div>
        </Card>
      </div>
    </main>
  );
}
