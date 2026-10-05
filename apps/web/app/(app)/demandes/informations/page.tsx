'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { peut, type ProfileChangeRequestView } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
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
} from '@teranga/ui';
import { BoutonDecision } from '../../../../components/bouton-decision';
import { DeleguerMembres } from '../../../../components/deleguer-membres';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { valeurSignalee } from '../../../../components/telephone';
import {
  BandeauDelegation,
  BandeauMessage,
  listePrenoms,
  Pastille,
  texteErreur,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { api } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   « Mise à jour d'infos » — les changements d'informations signalés par
   les agents, pour la Direction du Capital Humain.

   Un agent signale un changement (adresse, téléphone, situation…) depuis
   son espace ; la DCH le confirme — le dossier est mis à jour aussitôt — ou
   le refuse, avec un motif. Son directeur peut DÉLÉGUER : les membres qu'il
   coche peuvent traiter ces demandes — et lui aussi, toujours. Ce qui est
   traité ne s'affiche plus : le dossier de l'agent le porte.
   ———————————————————————————————————————————————————————————————— */

const lisible = (champ: string, valeur: string | null | undefined) =>
  valeurSignalee(champ, valeur) ?? '—';

export default function InformationsATraiterPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const estDirecteur = Boolean(me.data?.dirigeLaDCH);
  const demandes = useQuery({
    queryKey: ['profile-changes', 'file'],
    queryFn: () => api<ProfileChangeRequestView[]>('/profile-changes'),
  });
  const membres = useMembresDCH().data?.membres ?? [];
  const [message, setMessage] = useState<Message>(null);
  const [refus, setRefus] = useState<ProfileChangeRequestView | null>(null);
  // Le dossier a changé depuis la demande : la valider remplacerait une
  // correction de la RH. Cela se confirme en voyant ce qui sera remplacé.
  const [aRemplacer, setARemplacer] = useState<ProfileChangeRequestView | null>(null);
  const [motif, setMotif] = useState('');

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
  };
  const echec = (err: unknown) => setMessage({ ton: 'erreur', texte: texteErreur(err) });

  const decider = useMutation({
    mutationFn: (v: {
      demande: ProfileChangeRequestView;
      decision: 'approve' | 'reject';
      ecraser?: boolean;
    }) =>
      api(`/profile-changes/${v.demande.id}/decide`, {
        method: 'POST',
        body: {
          decision: v.decision,
          ...(v.decision === 'reject' ? { message: motif.trim() } : {}),
          ...(v.ecraser ? { ecraser: true } : {}),
        },
      }),
    onSuccess: async (_, v) => {
      setRefus(null);
      setARemplacer(null);
      setMotif('');
      setMessage({
        ton: 'ok',
        texte:
          v.decision === 'approve'
            ? `Dossier de ${v.demande.employeeName} mis à jour. Un message lui est envoyé.`
            : `Changement de ${v.demande.employeeName} refusé. Le motif lui est transmis.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  // Ce que l'appelant peut trancher — le directeur, tout, délégué ou non —,
  // et sa propre demande, qu'il délègue. Qui consulte seulement voit la file
  // entière, sans geste.
  const toutes = demandes.data ?? [];
  const traite =
    estDirecteur || peut(me.data, 'demandes.informations') || toutes.some((r) => r.canDecide);
  const aTraiter = toutes.filter(
    (r) => r.status === 'pending' && (!traite || r.canDecide || Boolean(r.traitement?.aConfier)),
  );
  const habilites = membres.filter((m) => m.capacites.includes('demandes.informations'));

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {estDirecteur ? (
        <BandeauDelegation
          icone="arrow_split"
          texte={
            habilites.length > 0
              ? `${listePrenoms(habilites)} ${habilites.length > 1 ? 'peuvent' : 'peut'} désormais traiter les demandes de mise à jour d’informations.`
              : 'Vous pouvez déléguer cette tâche à votre équipe.'
          }
          action={
            <DeleguerMembres
              membres={membres}
              capacite="demandes.informations"
              titre="Déléguer les mises à jour d’informations"
              confirmation={(retenus) =>
                `${listePrenoms(retenus)} ${retenus.length > 1 ? 'pourront' : 'pourra'} traiter désormais les demandes de mise à jour d’informations.`
              }
              retrait="Vous traiterez de vous-même toutes les demandes de mise à jour d’informations."
              fichiers={['profile-changes']}
              onFait={() => setMessage(null)}
              onErreur={echec}
            />
          }
        />
      ) : peut(me.data, 'demandes.informations') ? (
        <BandeauDelegation
          icone="how_to_reg"
          texte="La DCH vous a délégué le traitement des demandes de mise à jour d’informations."
        />
      ) : null}

      {/* ———— Demandes à traiter ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center gap-2">
          <CardTitle className="min-w-0 flex-1">Demandes à traiter</CardTitle>
          {aTraiter.length > 0 ? <Pastille n={aTraiter.length} /> : null}
        </CardHeader>
        {demandes.isLoading ? (
          <div className="px-2 pb-2">
            <Squelette />
          </div>
        ) : aTraiter.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<Icon name="badge" size={22} />}
            title="Rien à traiter"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Employé</Th>
                <Th>Changement</Th>
                <Th>Signalé le</Th>
                <Th className="text-right">{traite ? 'Décision' : 'Traitée par'}</Th>
              </tr>
            </THead>
            <TBody>
              {aTraiter.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {r.employeeName}
                  </Td>
                  <Td>
                    <Changements demande={r} />
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {formatDate(r.createdAt.slice(0, 10))}
                  </Td>
                  <Td>
                    {!traite ? (
                      <p className="text-right text-[12px] text-ink-muted">
                        {r.traitement?.traitants ?? '—'}
                      </p>
                    ) : r.canDecide ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <BoutonDecision
                          geste="approuver"
                          objet="le changement"
                          employe={r.employeeName}
                          enCours={
                            decider.isPending &&
                            decider.variables?.demande.id === r.id &&
                            decider.variables.decision === 'approve'
                          }
                          bloque={decider.isPending}
                          onClick={() => {
                            setMessage(null);
                            if (r.fields.some((f) => f.modifieDepuis)) setARemplacer(r);
                            else decider.mutate({ demande: r, decision: 'approve' });
                          }}
                        />
                        <BoutonDecision
                          geste="refuser"
                          objet="le changement"
                          employe={r.employeeName}
                          enCours={false}
                          bloque={decider.isPending}
                          onClick={() => {
                            setMessage(null);
                            setMotif('');
                            setRefus(r);
                          }}
                        />
                      </div>
                    ) : (
                      <p className="text-right text-[11.5px] font-semibold text-accent-text">
                        Votre propre demande, à déléguer
                      </p>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {aRemplacer ? (
        <Modal
          open
          onClose={() => setARemplacer(null)}
          title={`Remplacer les informations de ${aRemplacer.employeeName} ?`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setARemplacer(null)}>
                Annuler
              </Button>
              <Button
                loading={decider.isPending}
                onClick={() =>
                  decider.mutate({ demande: aRemplacer, decision: 'approve', ecraser: true })
                }
              >
                Remplacer
              </Button>
            </div>
          }
        >
          <ul className="flex flex-col gap-2 text-[13px]">
            {aRemplacer.fields
              .filter((f) => f.modifieDepuis)
              .map((f) => (
                <li key={f.field} className="leading-snug">
                  <span className="text-ink-muted">{f.label} : </span>
                  <span className="text-ink-muted line-through">{lisible(f.field, f.actuel)}</span>
                  <span className="mx-1.5 text-ink-muted">→</span>
                  <span className="font-medium text-ink-strong">{lisible(f.field, f.next)}</span>
                </li>
              ))}
          </ul>
        </Modal>
      ) : null}

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
            hint="Obligatoire. Il est transmis à l’agent avec le refus."
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
    </Page>
  );
}

/** Ce qui change — avant → après, champ par champ —, et le mot de l'agent. */
function Changements({ demande: r }: { demande: ProfileChangeRequestView }) {
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {r.fields.map((f) => (
          <li key={f.field} className="leading-snug">
            <span className="text-ink-muted">{f.label} : </span>
            {/* Modifié depuis la demande : c'est la valeur au dossier
                aujourd'hui qui serait remplacée, pas celle qu'a vue l'agent. */}
            <span className="text-ink-muted line-through">
              {lisible(f.field, f.modifieDepuis ? f.actuel : f.previous)}
            </span>
            <span className="mx-1.5 text-ink-muted">→</span>
            <span className="font-medium text-ink-strong">{lisible(f.field, f.next)}</span>
            {f.modifieDepuis ? (
              <Badge tone="rouge" size="sm" className="ml-1.5 align-middle">
                Modifié depuis la demande
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {r.note ? (
        <span className="mt-0.5 block text-[11px] text-ink-muted italic">« {r.note} »</span>
      ) : null}
    </>
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
