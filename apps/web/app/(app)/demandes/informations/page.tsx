'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PROFILE_CHANGE_STATUS_LABELS,
  PROFILE_CHANGE_STATUS_TONES,
  type MembreHabilite,
  type ProfileChangeRequestView,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Skeleton,
  Textarea,
} from '@teranga/ui';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { valeurSignalee } from '../../../../components/telephone';
import {
  BandeauMessage,
  ModalConfier,
  ModalLesSuivantes,
  quiTraite,
  texteErreur,
  useConfier,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Les changements d'informations à traiter pour la DCH.

   Un agent signale un changement (adresse, téléphone, situation…) depuis
   son espace ; la DCH le confirme — le dossier est mis à jour aussitôt — ou
   le refuse, avec un motif. Ce qui attend l'appelant en haut ; ce qui est
   confié à un autre membre ensuite ; les derniers traités en bas.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;
const LIGNE =
  'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover';

const lisible = (champ: string, valeur: string | null | undefined) =>
  valeurSignalee(champ, valeur) ?? '—';

export default function InformationsATraiterPage() {
  const queryClient = useQueryClient();
  const demandes = useQuery({
    queryKey: ['profile-changes', 'file'],
    queryFn: () => api<ProfileChangeRequestView[]>('/profile-changes'),
  });
  const membres = useMembresDCH().data?.membres ?? [];
  const [message, setMessage] = useState<Message>(null);
  const [refus, setRefus] = useState<ProfileChangeRequestView | null>(null);
  const [motif, setMotif] = useState('');
  const [aConfier, setAConfier] = useState<ProfileChangeRequestView | null>(null);
  const [proposition, setProposition] = useState<MembreHabilite | null>(null);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
  };
  const echec = (err: unknown) => setMessage({ ton: 'erreur', texte: texteErreur(err) });

  const decider = useMutation({
    mutationFn: (v: { demande: ProfileChangeRequestView; decision: 'approve' | 'reject' }) =>
      api(`/profile-changes/${v.demande.id}/decide`, {
        method: 'POST',
        body: {
          decision: v.decision,
          ...(v.decision === 'reject' ? { message: motif.trim() } : {}),
        },
      }),
    onSuccess: async (_, v) => {
      setRefus(null);
      setMotif('');
      setMessage({
        ton: 'ok',
        texte:
          v.decision === 'approve'
            ? `Dossier de ${v.demande.employeeName} mis à jour — un message lui est envoyé.`
            : `Changement de ${v.demande.employeeName} refusé — le motif lui est transmis.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  const confier = useConfier('informations', rafraichir);
  const confierA = (r: ProfileChangeRequestView, employeeId: string | null) =>
    confier.mutate(
      { id: r.id, employeeId },
      {
        onSuccess: (res) => {
          setAConfier(null);
          const m = membres.find((x) => x.employeeId === employeeId);
          setMessage({
            ton: 'ok',
            texte: m
              ? `Demande de ${r.employeeName} confiée à ${m.nom} — une notification lui est envoyée.`
              : `Vous reprenez la demande de ${r.employeeName}.`,
          });
          if (res?.proposerHabilitation && m) setProposition(m);
        },
        onError: echec,
      },
    );

  const toutes = demandes.data ?? [];
  const aTraiter = toutes.filter((r) => r.status === 'pending' && r.traitement?.pourMoi);
  const ailleurs = toutes.filter((r) => r.status === 'pending' && !r.traitement?.pourMoi);
  const traitees = toutes.filter((r) => r.status !== 'pending').slice(0, 40);
  const dirige = toutes.some((r) => r.traitement?.peutConfier);

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {/* ———— À traiter ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>À traiter</CardTitle>
          {aTraiter.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(aTraiter.length, 'demande')}
            </span>
          ) : null}
        </CardHeader>
        <div className="px-2 pb-2">
          {demandes.isLoading ? (
            <Squelette />
          ) : aTraiter.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="badge" size={22} />}
              title="Rien à traiter"
            />
          ) : (
            <ul className="flex flex-col">
              {aTraiter.map((r) => (
                <li key={r.id} className={LIGNE}>
                  <Resume demande={r} />
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                    {r.traitement?.peutConfier && membres.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMessage(null);
                          setAConfier(r);
                        }}
                      >
                        Confier
                      </Button>
                    ) : null}
                    {r.canDecide ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setMessage(null);
                            setMotif('');
                            setRefus(r);
                          }}
                        >
                          Refuser
                        </Button>
                        <Button
                          size="sm"
                          loading={decider.isPending && decider.variables?.demande.id === r.id}
                          disabled={decider.isPending}
                          onClick={() => {
                            setMessage(null);
                            decider.mutate({ demande: r, decision: 'approve' });
                          }}
                        >
                          Confirmer
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ———— Chez un autre membre ———— */}
      {ailleurs.length > 0 ? (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle>{dirige ? 'Confiées' : 'Chez un autre membre de la DCH'}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col px-2 pb-2">
            {ailleurs.map((r) => (
              <li key={r.id} className={LIGNE}>
                <Resume demande={r} attendu={quiTraite(r.traitement)} />
                {r.traitement?.peutConfier ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    loading={confier.isPending && confier.variables?.id === r.id}
                    onClick={() => {
                      setMessage(null);
                      confierA(r, null);
                    }}
                  >
                    Reprendre
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ———— Traitées ———— */}
      <CartePleine>
        <CardHeader className="shrink-0">
          <CardTitle>Traitées</CardTitle>
        </CardHeader>
        <CorpsDefilant className="px-2 pb-2">
          {demandes.isLoading ? (
            <Squelette />
          ) : traitees.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="badge" size={22} />}
              title="Aucun changement traité"
              description="Les changements confirmés ou refusés s’afficheront ici."
            />
          ) : (
            <ul className="flex flex-col">
              {traitees.map((r) => (
                <li key={r.id} className={LIGNE}>
                  <Resume
                    demande={r}
                    attendu={[
                      r.handledByName ? `Par ${r.handledByName}` : null,
                      r.status === 'rejected' && r.hrMessage ? `Motif : ${r.hrMessage}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <Badge tone={PROFILE_CHANGE_STATUS_TONES[r.status]} className="ml-auto">
                    {PROFILE_CHANGE_STATUS_LABELS[r.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CorpsDefilant>
      </CartePleine>

      {refus ? (
        <Modal
          open
          onClose={() => setRefus(null)}
          title={`Refuser le changement de ${refus.employeeName}`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefus(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                disabled={!motif.trim()}
                loading={decider.isPending}
                onClick={() => decider.mutate({ demande: refus, decision: 'reject' })}
              >
                Refuser
              </Button>
            </div>
          }
        >
          <Field
            label="Motif"
            htmlFor="motif-refus-info"
            required
            hint="Obligatoire — il est transmis à l’agent avec le refus."
          >
            <Textarea
              id="motif-refus-info"
              value={motif}
              maxLength={500}
              placeholder="Ex. : merci de passer présenter votre acte de mariage."
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {aConfier ? (
        <ModalConfier
          titre={`Confier la demande de ${aConfier.employeeName}`}
          sousTitre={aConfier.fields.map((f) => f.label).join(', ')}
          membres={membres}
          exclure={aConfier.employeeId}
          enCours={confier.isPending}
          onConfier={(employeeId) => confierA(aConfier, employeeId)}
          onClose={() => setAConfier(null)}
        />
      ) : null}
      {proposition ? (
        <ModalLesSuivantes
          membre={proposition}
          capacite="demandes.informations"
          onFait={(texte) => {
            setProposition(null);
            setMessage({ ton: 'ok', texte });
          }}
          onClose={() => setProposition(null)}
        />
      ) : null}
    </Page>
  );
}

/** Qui, quoi (avant → après), quand. */
function Resume({
  demande: r,
  attendu,
}: {
  demande: ProfileChangeRequestView;
  attendu?: string | null;
}) {
  return (
    <div className="min-w-0 flex-1 basis-64">
      <p className="truncate text-[13px] font-semibold text-ink-strong">
        {r.employeeName}
        <span className="ml-2 font-mono text-[10.5px] font-normal text-ink-muted">
          {r.employeeNumber}
        </span>
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {r.fields.map((f) => (
          <li key={f.field} className="text-[12px] leading-snug">
            <span className="text-ink-muted">{f.label} : </span>
            <span className="text-ink-muted line-through">{lisible(f.field, f.previous)}</span>
            <span className="mx-1.5 text-ink-muted">→</span>
            <span className="font-medium text-ink-strong">{lisible(f.field, f.next)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11.5px] text-ink-muted">
        {[
          `Signalé le ${formatDate(r.createdAt.slice(0, 10))}`,
          r.note ? `« ${r.note} »` : null,
          attendu,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

function Squelette() {
  return (
    <div className="flex flex-col gap-1 px-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="h-3 w-52" />
        </span>
      ))}
    </div>
  );
}
