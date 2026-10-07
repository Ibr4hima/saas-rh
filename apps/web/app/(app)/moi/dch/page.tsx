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
import {
  FenetreAnnulation,
  FenetreRappel,
  MentionConge,
} from '../../../../components/conge-valide';
import { DeleguerMembres } from '../../../../components/deleguer-membres';
import { FenetreDemandeAbsence } from '../../../../components/fenetre-demande-absence';
import { JoindreJustificatif } from '../../../../components/joindre-justificatif';
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { Pagination, usePagination } from '../../../../components/pagination';
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
import { compte, de } from '../../../../lib/mots';

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
  // Un congé validé en cours, ou à venir : le rappeler, l'annuler.
  const [rappel, setRappel] = useState<AbsenceRequestView | null>(null);
  const [annulation, setAnnulation] = useState<AbsenceRequestView | null>(null);
  // Saisir pour un agent qui ne le peut pas (sans portail, hospitalisé).
  const [saisie, setSaisie] = useState(false);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['absences-upcoming'] });
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
        texte: `Congé de ${v.demande.employeeName} ${v.decision === 'approved' ? 'approuvé' : 'refusé'}. Un message lui est envoyé.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  // Le retour anticipé d'un agent dont le N+1 est absent : la DCH le confirme.
  const confirmer = useMutation({
    mutationFn: (v: { demande: AbsenceRequestView; decision: 'approved' | 'rejected' }) =>
      api(`/absence-requests/${v.demande.id}/reprise/decision`, {
        method: 'POST',
        body: { decision: v.decision },
      }),
    onSuccess: async (_, v) => {
      setMessage({
        ton: 'ok',
        texte: `Retour ${de(v.demande.employeeName)} ${v.decision === 'approved' ? 'confirmé' : 'refusé'}. Un message lui est envoyé.`,
      });
      await rafraichir();
    },
    onError: echec,
  });
  const occupe = decider.isPending || confirmer.isPending;

  // Ce que l'appelant peut décider à l'étape de la DCH (pour le directeur,
  // tout, délégué ou non), et les retours qu'il confirme.
  const toutes = demandes.data ?? [];
  const aTraiter = toutes
    .filter((r) => (r.canDecide && r.etapeAttendue === 'dch') || r.gestes.confirmerReprise)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  // Qui traite les congés pour la DCH — ou se voit confier une demande. Les
  // autres consultent : ils voient la file telle qu'elle est, sans geste.
  const traite = estDirecteur || peut(me.data, 'demandes.conges') || aTraiter.length > 0;
  const enAttente = traite
    ? aTraiter
    : toutes
        .filter((r) => r.status === 'pending' && r.etapeAttendue === 'dch')
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const traitees = toutes.filter((r) => r.status !== 'pending');
  const file = usePagination(enAttente);
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
    ) : r.justificatifAttendu ? (
      r.gestes.joindreJustificatif ? (
        <JoindreJustificatif
          demande={r}
          onFait={() => void rafraichir()}
          onErreur={(texte) => setMessage({ ton: 'erreur', texte })}
        />
      ) : (
        <Badge tone="orange">Attendu</Badge>
      )
    ) : null;

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
          {traite ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setMessage(null);
                setSaisie(true);
              }}
            >
              <Icon name="add" size={16} />
              Saisir une demande
            </Button>
          ) : null}
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
          <>
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
                {file.tranche.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-semibold whitespace-nowrap text-ink-strong">
                      {r.employeeName}
                      {r.saisiePar ? (
                        <p className="text-[11.5px] font-normal text-ink-muted">
                          Saisie par {r.saisiePar}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      <Periode demande={r} />
                      <MentionConge demande={r} />
                    </Td>
                    <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                    <Td>{justificatif(r)}</Td>
                    <Td>
                      {r.gestes.confirmerReprise ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <BoutonDecision
                            geste="approuver"
                            employe={r.employeeName}
                            objet="le retour"
                            enCours={
                              confirmer.isPending &&
                              confirmer.variables?.demande.id === r.id &&
                              confirmer.variables.decision === 'approved'
                            }
                            bloque={occupe}
                            onClick={() => {
                              setMessage(null);
                              confirmer.mutate({ demande: r, decision: 'approved' });
                            }}
                          />
                          <BoutonDecision
                            geste="refuser"
                            employe={r.employeeName}
                            objet="le retour"
                            enCours={
                              confirmer.isPending &&
                              confirmer.variables?.demande.id === r.id &&
                              confirmer.variables.decision === 'rejected'
                            }
                            bloque={occupe}
                            onClick={() => {
                              setMessage(null);
                              confirmer.mutate({ demande: r, decision: 'rejected' });
                            }}
                          />
                        </div>
                      ) : traite ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <BoutonDecision
                            geste="approuver"
                            employe={r.employeeName}
                            enCours={
                              decider.isPending &&
                              decider.variables?.demande.id === r.id &&
                              decider.variables.decision === 'approved'
                            }
                            // Un type qui l'exige se valide avec son justificatif.
                            bloque={occupe || r.justificatifAttendu}
                            onClick={() => {
                              setMessage(null);
                              decider.mutate({ demande: r, decision: 'approved' });
                            }}
                          />
                          <BoutonDecision
                            geste="refuser"
                            employe={r.employeeName}
                            enCours={false}
                            bloque={occupe}
                            onClick={() => {
                              setMessage(null);
                              setMotif('');
                              setRefus(r);
                            }}
                          />
                        </div>
                      ) : (
                        <p className="text-right text-[12px] text-ink-muted">
                          {quiTraite(r.traitement)}
                        </p>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination {...file.barre} className="py-4" />
          </>
        )}
      </Card>

      <CalendrierDesAbsences
        onRappeler={(r) => {
          setMessage(null);
          setRappel(r);
        }}
        onAnnuler={(r) => {
          setMessage(null);
          setAnnulation(r);
        }}
      />

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
            hint="Facultatif. Il est transmis à l’agent avec le refus."
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

      {rappel ? (
        <FenetreRappel
          demande={rappel}
          onClose={() => setRappel(null)}
          onFait={async () => {
            setMessage({ ton: 'ok', texte: `Rappel envoyé à ${rappel.employeeName}.` });
            setRappel(null);
            await rafraichir();
          }}
        />
      ) : null}
      {annulation ? (
        <FenetreAnnulation
          demande={annulation}
          sienne={false}
          onClose={() => setAnnulation(null)}
          onFait={async () => {
            setMessage({
              ton: 'ok',
              texte: `Congé ${de(annulation.employeeName)} annulé. Un message lui est envoyé.`,
            });
            setAnnulation(null);
            await rafraichir();
          }}
        />
      ) : null}

      {saisie ? (
        <FenetreDemandeAbsence
          pourAutrui
          onClose={() => setSaisie(false)}
          onEnvoyee={async () => {
            setSaisie(false);
            setMessage({ ton: 'ok', texte: 'Demande enregistrée.' });
            await rafraichir();
          }}
        />
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
  const { tranche, barre } = usePagination(demandes);
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
        <>
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
              {tranche.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {r.employeeName}
                  </Td>
                  <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Periode demande={r} />
                    <MentionConge demande={r} />
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
          <Pagination {...barre} className="py-4" />
        </>
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
function CalendrierDesAbsences({
  onRappeler,
  onAnnuler,
}: {
  onRappeler: (r: AbsenceRequestView) => void;
  onAnnuler: (r: AbsenceRequestView) => void;
}) {
  const absences = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });
  const jour = aujourdhui();
  const liste = absences.data ?? [];
  const { tranche, barre } = usePagination(liste);
  // La colonne des gestes n'existe que pour qui peut rappeler ou annuler.
  const gestes = liste.some((r) => r.gestes.rappeler || r.gestes.annuler);
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
        <>
          <Table>
            <THead>
              <tr>
                <Th>Nom</Th>
                <Th>Type</Th>
                <Th>Début</Th>
                <Th>Fin</Th>
                <Th className="text-right">Jours</Th>
                <Th>Statut</Th>
                {gestes ? (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {tranche.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium whitespace-nowrap text-ink-strong">
                    {r.employeeName}
                    <MentionConge demande={r} />
                  </Td>
                  <Td>{r.absenceTypeName}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                  <Td className="text-right tabular-nums">{r.daysCount}</Td>
                  <Td>
                    {r.startDate <= jour ? (
                      <Badge tone="teal">En cours</Badge>
                    ) : (
                      <Badge tone="bleu">À venir</Badge>
                    )}
                  </Td>
                  {gestes ? (
                    <Td className="text-right">
                      {r.gestes.rappeler ? (
                        <Button size="sm" variant="ghost" onClick={() => onRappeler(r)}>
                          Rappeler
                        </Button>
                      ) : r.gestes.annuler ? (
                        <Button size="sm" variant="ghost" onClick={() => onAnnuler(r)}>
                          Annuler
                        </Button>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination {...barre} className="py-4" />
        </>
      )}
    </Card>
  );
}
