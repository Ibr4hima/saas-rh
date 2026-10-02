'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { peut, type AbsenceRequestView } from '@teranga/contracts';
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
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { StatutAbsence } from '../../../../components/statut-absence';
import {
  BandeauDelegation,
  BandeauMessage,
  EnTetePliable,
  listePrenoms,
  Pastille,
  quiTraite,
  texteErreur,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { resumeVisas } from '../../../../lib/absences';
import { api, apiUrl } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Absences & Congés » — les demandes de congé, pour la Direction du
   Capital Humain : la file à traiter et, sous elle, qui est absent.

   Le circuit de l'APIX : le N+1 vise d'abord ; la demande passe ensuite à
   la DCH. Son directeur peut DÉLÉGUER : les membres qu'il coche peuvent
   traiter les demandes — et lui aussi, toujours. Retirer une délégation,
   c'est décocher. Cet écran sert à tous :

     — au DIRECTEUR : toutes les demandes à l'étape de la DCH ;
     — aux MEMBRES habilités, ou à qui une demande est confiée : ce qui les
       attend, eux ;
     — à qui CONSULTE les dossiers : les demandes en cours et traitées, et
       le calendrier des absences, sans décision à prendre.

   Il remplace l'ancienne « Gestion des demandes » (/absences, qui y mène) :
   une seule page pour les mêmes demandes.
   ———————————————————————————————————————————————————————————————— */

export default function CongesATraiterPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const estDirecteur = Boolean(me.data?.dirigeLaDCH);
  const habilitations = useMembresDCH();
  const membres = habilitations.data?.membres ?? [];
  const demandes = useQuery({
    queryKey: ['absence-requests', 'dch'],
    queryFn: () => api<AbsenceRequestView[]>('/absence-requests?limit=100'),
  });

  const [message, setMessage] = useState<Message>(null);
  const [refus, setRefus] = useState<AbsenceRequestView | null>(null);
  const [motif, setMotif] = useState('');
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
  };
  const echec = (err: unknown) => setMessage({ ton: 'erreur', texte: texteErreur(err) });

  const decider = useMutation({
    mutationFn: (v: { demande: AbsenceRequestView; decision: 'approved' | 'rejected' }) =>
      api(`/absence-requests/${v.demande.id}/decision`, {
        method: 'POST',
        body: {
          decision: v.decision,
          ...(v.decision === 'rejected' && motif.trim() ? { comment: motif.trim() } : {}),
        },
      }),
    onSuccess: async (_, v) => {
      setRefus(null);
      setMotif('');
      setMessage({
        ton: 'ok',
        texte: `Congé de ${v.demande.employeeName} ${v.decision === 'approved' ? 'approuvé' : 'refusé'} — un message lui est envoyé.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  // Ce que l'appelant peut décider à l'étape de la DCH — pour le directeur,
  // tout, délégué ou non.
  const toutes = demandes.data ?? [];
  const aTraiter = toutes
    .filter((r) => r.canDecide && r.etapeAttendue === 'dch')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  // Qui traite les congés pour la DCH — ou se voit confier une demande. Les
  // autres consultent : ils voient la file telle qu'elle est, sans geste.
  const traite = estDirecteur || peut(me.data, 'demandes.conges') || aTraiter.length > 0;
  const enAttente = traite
    ? aTraiter
    : toutes
        .filter((r) => r.status === 'pending' && r.etapeAttendue === 'dch')
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const traitees = toutes.filter((r) => r.status !== 'pending').slice(0, 40);
  const habilites = membres.filter((m) => m.capacites.includes('demandes.conges'));
  // Le justificatif peut dire une maladie : à qui traite, ou lit les données sensibles.
  const voitJustificatifs = traite || peut(me.data, 'personnel.sensible');

  const chargement = demandes.isLoading;

  const justificatif = (r: AbsenceRequestView) =>
    r.documentName && voitJustificatifs ? (
      <BoutonJustificatif
        onClick={() =>
          setViewedDoc({
            url: apiUrl(`/absence-requests/${r.id}/document`),
            filename: r.documentName!,
            contentType: 'application/pdf',
            titre: 'Justificatif',
          })
        }
      />
    ) : (
      <span className="text-ink-muted/60">—</span>
    );

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {estDirecteur ? (
        <BandeauDelegation
          icone="arrow_split"
          texte={
            habilites.length > 0
              ? `${listePrenoms(habilites)} ${habilites.length > 1 ? 'peuvent' : 'peut'} désormais traiter les demandes d’absence et de congé.`
              : 'Vous pouvez déléguer cette tâche à votre équipe.'
          }
          action={
            <DeleguerMembres
              membres={membres}
              capacite="demandes.conges"
              titre="Déléguer les absences et congés"
              confirmation={(retenus) =>
                `${listePrenoms(retenus)} ${retenus.length > 1 ? 'pourront' : 'pourra'} traiter désormais les demandes d’absence et de congé, une fois visées par son manager, conformément au circuit de validation.`
              }
              retrait="Vous traiterez de vous-même toutes les demandes d’absence et de congé."
              fichiers={['absence-requests']}
              onFait={() => setMessage(null)}
              onErreur={echec}
            />
          }
        />
      ) : peut(me.data, 'demandes.conges') ? (
        <BandeauDelegation
          icone="how_to_reg"
          texte="La DCH vous a délégué le traitement des demandes d’absence et de congé."
        />
      ) : null}

      {/* ———— Demandes à traiter ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center gap-2">
          <CardTitle className="min-w-0 flex-1">Demandes à traiter</CardTitle>
          {enAttente.length > 0 ? <Pastille n={enAttente.length} /> : null}
        </CardHeader>
        {chargement ? (
          <div className="px-2 pb-2">
            <Squelette />
          </div>
        ) : enAttente.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<Icon name="how_to_reg" size={22} />}
            title="Rien à traiter"
            description="Une fois visée par le N+1, une demande d’absence ou de congé arrive ici, avec une notification."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Employé</Th>
                <Th>Type</Th>
                <Th>Période</Th>
                <Th className="text-right">Jours</Th>
                <Th>Justificatif</Th>
                <Th className="text-right">{traite ? 'Décision' : 'Traitée par'}</Th>
              </tr>
            </THead>
            <TBody>
              {enAttente.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {r.employeeName}
                  </Td>
                  <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Periode demande={r} />
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                  <Td>{justificatif(r)}</Td>
                  <Td>
                    {traite ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <BoutonDecision
                          geste="approuver"
                          employe={r.employeeName}
                          enCours={
                            decider.isPending &&
                            decider.variables?.demande.id === r.id &&
                            decider.variables.decision === 'approved'
                          }
                          bloque={decider.isPending}
                          onClick={() => {
                            setMessage(null);
                            decider.mutate({ demande: r, decision: 'approved' });
                          }}
                        />
                        <BoutonDecision
                          geste="refuser"
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
                      <p className="text-right text-[12px] text-ink-muted">
                        {quiTraite(r.traitement) ?? '—'}
                      </p>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <CalendrierDesAbsences />

      {/* ———— Demandes traitées : pliées, on les ouvre quand on les cherche ———— */}
      <DemandesTraitees demandes={traitees} chargement={chargement} />

      {/* ———— Refuser, avec un motif ———— */}
      {refus ? (
        <Modal
          open
          onClose={() => setRefus(null)}
          title={`Refuser le congé de ${refus.employeeName}`}
          subtitle={`${refus.absenceTypeName} · ${formatDate(refus.startDate)} → ${formatDate(refus.endDate)} · ${compte(refus.daysCount, 'jour')}`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefus(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={decider.isPending}
                onClick={() => decider.mutate({ demande: refus, decision: 'rejected' })}
              >
                Refuser la demande
              </Button>
            </div>
          }
        >
          <Field
            label="Motif"
            htmlFor="motif-refus-dch"
            hint="Facultatif — il est transmis à l’agent avec le refus."
          >
            <Textarea
              id="motif-refus-dch"
              value={motif}
              maxLength={1000}
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

function BoutonJustificatif({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary-soft"
    >
      <Icon name="description" size={14} />
      Justificatif
    </button>
  );
}

function Periode({ demande: r }: { demande: AbsenceRequestView }) {
  return (
    <>
      {formatDate(r.startDate)} <span className="text-ink-muted">→</span> {formatDate(r.endDate)}
    </>
  );
}

/**
 * Les demandes traitées — approuvées, refusées, annulées —, PLIÉES par
 * défaut : on les consulte quand on cherche, pas à chaque ouverture.
 */
function DemandesTraitees({
  demandes,
  chargement,
}: {
  demandes: AbsenceRequestView[];
  chargement: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <Card className="shrink-0">
      <EnTetePliable
        titre="Demandes traitées"
        n={demandes.length}
        ouvert={ouvert}
        onBasculer={() => setOuvert((o) => !o)}
      />
      {!ouvert ? null : chargement ? (
        <div className="px-2 pb-2">
          <Squelette />
        </div>
      ) : demandes.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Icon name="free_cancellation" size={22} />}
          title="Aucune demande traitée"
          description="Les demandes approuvées, refusées ou annulées s’affichent ici."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Employé</Th>
              <Th>Type</Th>
              <Th>Période</Th>
              <Th className="text-right">Jours</Th>
              <Th className="text-right">Statut</Th>
            </tr>
          </THead>
          <TBody>
            {demandes.map((r) => (
              <Tr key={r.id}>
                <Td className="font-semibold whitespace-nowrap text-ink-strong">
                  {r.employeeName}
                </Td>
                <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                <Td className="whitespace-nowrap tabular-nums">
                  <Periode demande={r} />
                </Td>
                <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                <Td>
                  <div className="flex justify-end">
                    <StatutAbsence
                      statut={r.status}
                      etape={r.etapeAttendue}
                      titre={resumeVisas(r)}
                    />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
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

/** Le jour courant, dans le calendrier LOCAL — `toISOString()` donnerait la date UTC. */
function aujourdhui(): string {
  const d = new Date();
  const p2 = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * Qui est absent, et qui le sera sous trente jours : un complément de la
 * file, pas la file — la carte garde sa taille.
 */
function CalendrierDesAbsences() {
  const absences = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });
  const jour = aujourdhui();
  const liste = absences.data ?? [];
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>Calendrier des absences</CardTitle>
      </CardHeader>
      {absences.isLoading ? (
        <div className="px-2 pb-2">
          <Squelette />
        </div>
      ) : liste.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Icon name="event_busy" size={22} />}
          title="Personne d'absent à l'horizon"
          description="Aucune absence approuvée dans les 30 prochains jours."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Nom</Th>
              <Th>Type</Th>
              <Th>Début</Th>
              <Th>Fin</Th>
              <Th className="text-right">Jours</Th>
              <Th>Statut</Th>
            </tr>
          </THead>
          <TBody>
            {liste.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium text-ink-strong">{r.employeeName}</Td>
                <Td>{r.absenceTypeName}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                <Td className="text-right tabular-nums">{r.daysCount}</Td>
                <Td>
                  {r.startDate <= jour ? (
                    <Badge tone="success" className="whitespace-nowrap">
                      En cours
                    </Badge>
                  ) : (
                    <Badge tone="primary" className="whitespace-nowrap">
                      À venir
                    </Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
