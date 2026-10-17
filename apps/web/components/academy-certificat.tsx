'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CertificateSummary, FormationAnimee } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Field,
  Skeleton,
  Textarea,
} from '@teranga/ui';
import { FAMILLES, FOND_COUVERTURE, pourcent, STATUTS_CERTIFICAT } from '../lib/academy';
import { api, ApiError, apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { FenetreDocument } from './fenetre-document';
import { Icon } from './icons';
import { Modal } from './modal';

/* ————————————————————————————————————————————————————————————————
   Les certificats d'APIX Academy, à l'écran.

   Un certificat se CONSULTE dans l'aperçu du produit — comme toute pièce —
   et se télécharge de là. Son authenticité se vérifie par le QR code
   imprimé dessus : un recruteur ou un partenaire le scanne, sans compte.
   ———————————————————————————————————————————————————————————————— */

export function ApercuCertificat({
  certificat,
  onClose,
}: {
  certificat: CertificateSummary;
  onClose: () => void;
}) {
  return (
    <FenetreDocument
      doc={{
        url: apiUrl(`/academy/certificats/${certificat.id}/pdf?disposition=inline`),
        filename: `Certificat ${certificat.number}.pdf`,
        contentType: 'application/pdf',
        titre: `Certificat : ${certificat.courseTitle}`,
      }}
      sousTitre={`N° ${certificat.number}`}
      telechargement={apiUrl(`/academy/certificats/${certificat.id}/pdf`)}
      onClose={onClose}
    />
  );
}

/** Une ligne par certificat : la formation, la date, le score s'il y en a un, le statut. */
export function ListeCertificats({
  certificats,
  compact = false,
}: {
  certificats: CertificateSummary[];
  compact?: boolean;
}) {
  const [ouvert, setOuvert] = useState<CertificateSummary | null>(null);
  // Qui gère l'Academy : révoquer (motif dit), réémettre (nom corrigé).
  const [aRevoquer, setARevoquer] = useState<CertificateSummary | null>(null);
  const [aReemettre, setAReemettre] = useState<CertificateSummary | null>(null);
  return (
    <>
      <ul className="flex flex-col">
        {certificats.map((c) => {
          const statut = STATUTS_CERTIFICAT[c.status];
          return (
            <li
              key={c.id}
              className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
                  style={{ background: FOND_COUVERTURE }}
                >
                  <Icon name="workspace_premium" size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold text-ink-strong">
                    {c.courseTitle}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    Obtenu le {formatDate(c.issuedAt)}
                    {c.score !== null ? ` · ${pourcent(c.score)}` : ''}
                    {c.expiresAt ? ` · jusqu’au ${formatDate(c.expiresAt)}` : ''}
                    {c.reemisSous
                      ? ` · réémis sous le n° ${c.reemisSous}`
                      : c.revocationMotif
                        ? ` · ${c.revocationMotif}`
                        : ''}
                    {!compact ? (
                      <>
                        {' · '}
                        <span className="font-mono tracking-tight">{c.number}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </div>
              <div className={cn('flex flex-wrap items-center gap-1.5 pl-12 sm:pl-0')}>
                <Badge tone={statut.tone}>{statut.label}</Badge>
                <Button variant="secondary" size="sm" onClick={() => setOuvert(c)}>
                  <Icon name="visibility" size={15} />
                  Voir
                </Button>
                {c.gestes.reemettre ? (
                  <Button variant="secondary" size="sm" onClick={() => setAReemettre(c)}>
                    Réémettre
                  </Button>
                ) : null}
                {c.gestes.revoquer ? (
                  <Button variant="ghost" size="sm" onClick={() => setARevoquer(c)}>
                    Révoquer
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {ouvert ? <ApercuCertificat certificat={ouvert} onClose={() => setOuvert(null)} /> : null}
      {aRevoquer ? (
        <FenetreRevocation certificat={aRevoquer} onClose={() => setARevoquer(null)} />
      ) : null}
      {aReemettre ? (
        <FenetreReemission certificat={aReemettre} onClose={() => setAReemettre(null)} />
      ) : null}
    </>
  );
}

const messageDErreur = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Action impossible, réessayez.';

/** Révoquer : le motif est dit au titulaire, et la vérification publique le montre révoqué. */
function FenetreRevocation({
  certificat: c,
  onClose,
}: {
  certificat: CertificateSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [motif, setMotif] = useState('');
  const revoquer = useMutation({
    mutationFn: () =>
      api(`/academy/certificats/${c.id}/revocation`, {
        method: 'POST',
        body: { motif: motif.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['academy', 'certificats'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Révoquer le certificat « ${c.courseTitle} »`}
      subtitle={`N° ${c.number}`}
      maxWidth="max-w-lg"
      footer={
        <>
          {revoquer.isError ? (
            <p role="alert" className="min-w-0 flex-1 text-[12px] font-semibold text-danger">
              {messageDErreur(revoquer.error)}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={!motif.trim()}
            loading={revoquer.isPending}
            onClick={() => revoquer.mutate()}
          >
            Révoquer
          </Button>
        </>
      }
    >
      <Field label="Motif" htmlFor="motif-revocation" required>
        <Textarea
          id="motif-revocation"
          value={motif}
          maxLength={500}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/** Réémettre : un nouveau numéro, au nom actuel du titulaire ; l'ancien renvoie au nouveau. */
function FenetreReemission({
  certificat: c,
  onClose,
}: {
  certificat: CertificateSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reemettre = useMutation({
    mutationFn: () =>
      api<CertificateSummary>(`/academy/certificats/${c.id}/reemission`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['academy', 'certificats'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Réémettre le certificat « ${c.courseTitle} »`}
      subtitle={`N° ${c.number}`}
      maxWidth="max-w-lg"
      footer={
        <>
          {reemettre.isError ? (
            <p role="alert" className="min-w-0 flex-1 text-[12px] font-semibold text-danger">
              {messageDErreur(reemettre.error)}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={reemettre.isPending} onClick={() => reemettre.mutate()}>
            Réémettre
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px]">
        <div>
          <dt className="text-ink-muted">Obtenu le</dt>
          <dd className="font-semibold text-ink-strong">{formatDate(c.issuedAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Valable jusqu’au</dt>
          <dd className="font-semibold text-ink-strong">
            {c.expiresAt ? formatDate(c.expiresAt) : 'Sans limite'}
          </dd>
        </div>
      </dl>
    </Modal>
  );
}

/**
 * Les certificats d'un agent, dans son dossier : ce que la RH consulte
 * quand on lui demande qui est formé à quoi. Et les formations qu'il a
 * faites lui-même : il en est le formateur, elles ne lui donnent pas de
 * certificat.
 */
export function CarteCertificatsAgent({ employeeId }: { employeeId: string }) {
  const certificats = useQuery({
    queryKey: ['academy', 'certificats', employeeId],
    queryFn: () => api<CertificateSummary[]>(`/academy/employees/${employeeId}/certificats`),
  });
  const animees = useQuery({
    queryKey: ['academy', 'formations-animees', employeeId],
    queryFn: () => api<FormationAnimee[]>(`/academy/employees/${employeeId}/formations-animees`),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>APIX Academy · Certificats</CardTitle>
      </CardHeader>
      <CardContent>
        {certificats.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : !certificats.data || certificats.data.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Aucun certificat pour l’instant.</p>
        ) : (
          <ListeCertificats certificats={certificats.data} compact />
        )}
        {animees.data && animees.data.length > 0 ? (
          <section className="mt-4 border-t border-line-soft pt-4">
            <h3 className="text-[11px] font-bold tracking-[0.08em] text-ink-muted uppercase">
              {animees.data.length > 1 ? 'Formations dispensées' : 'Formation dispensée'}
            </h3>
            <ul className="mt-1 flex flex-col">
              {animees.data.map((a) => (
                <li
                  key={a.courseId}
                  className="flex items-center gap-3 border-b border-line-soft py-3 last:border-b-0"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary">
                    <Icon name="school" size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink-strong">
                      {a.title}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted">
                      {FAMILLES[a.category].label}
                    </span>
                  </span>
                  {!a.published ? <Badge tone="gris">Brouillon</Badge> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
