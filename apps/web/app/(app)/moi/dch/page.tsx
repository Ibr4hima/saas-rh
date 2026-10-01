'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { peut, type AbsenceRequestView, type MembreHabilite } from '@teranga/contracts';
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
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { StatutAbsence } from '../../../../components/statut-absence';
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
import { resumeVisas } from '../../../../lib/absences';
import { api, apiUrl } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Absences & Congés » — les demandes de congé, pour la Direction du
   Capital Humain : la file à traiter et, sous elle, qui est absent.

   Le circuit de l'APIX : le N+1 vise d'abord ; la demande passe ensuite au
   directeur du Capital Humain, qui la traite — ou la confie : une à une
   (ici), ou toutes, en habilitant des membres de sa direction
   (« Déléguer des tâches »). Cet écran sert à tous :

     — au DIRECTEUR : ce qui l'attend, et ce qu'il a confié (qu'il peut
       reprendre) ;
     — aux MEMBRES habilités, ou à qui une demande est confiée : ce qui les
       attend, eux ;
     — à qui CONSULTE les dossiers : les demandes en cours et traitées, et
       le calendrier des absences, sans décision à prendre.

   Il remplace l'ancienne « Gestion des demandes » (/absences, qui y mène) :
   une seule page pour les mêmes demandes.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

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
  const [aConfier, setAConfier] = useState<AbsenceRequestView | null>(null);
  /** Après une demande confiée à la main : confier aussi les suivantes ? */
  const [proposition, setProposition] = useState<MembreHabilite | null>(null);
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

  const confier = useConfier('conges', rafraichir);
  const confierA = (demande: AbsenceRequestView, employeeId: string | null) =>
    confier.mutate(
      { id: demande.id, employeeId },
      {
        onSuccess: (res) => {
          setAConfier(null);
          const m = membres.find((x) => x.employeeId === employeeId);
          setMessage({
            ton: 'ok',
            texte: m
              ? `Demande de ${demande.employeeName} confiée à ${m.nom} — une notification lui est envoyée.`
              : `Vous reprenez la demande de ${demande.employeeName}.`,
          });
          if (res?.proposerHabilitation && m) setProposition(m);
        },
        onError: echec,
      },
    );

  const toutes = demandes.data ?? [];
  const aTraiter = toutes
    .filter((r) => r.canDecide && r.etapeAttendue === 'dch' && r.traitement?.pourMoi)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const confiees = estDirecteur
    ? toutes.filter(
        (r) => r.status === 'pending' && r.etapeAttendue === 'dch' && !r.traitement?.pourMoi,
      )
    : [];
  // Qui traite les congés pour la DCH — ou se voit confier une demande. Les
  // autres consultent : pas de file vide à leur montrer, mais tout le suivi.
  const traite = estDirecteur || peut(me.data, 'demandes.conges') || aTraiter.length > 0;
  const suivi = toutes
    .filter((r) => !aTraiter.includes(r) && !confiees.includes(r))
    .filter((r) => r.status !== 'pending' || estDirecteur || !traite)
    .slice(0, 40);
  const habilites = membres.filter((m) => m.capacites.includes('demandes.conges'));

  const chargement = demandes.isLoading;

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {estDirecteur ? (
        <p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="arrow_split" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            {habilites.length > 0
              ? `Les demandes de congé vont directement à ${habilites.map((m) => m.nom).join(' et ')}, une fois visées par le N+1. Vous les voyez toutes, et gardez la main.`
              : 'Vous traitez vous-même les demandes de congé. Vous pouvez les confier aux membres de votre direction.'}
          </span>
          <Link
            href="/moi/delegations"
            className="shrink-0 font-semibold text-primary hover:underline"
          >
            Déléguer des tâches
          </Link>
        </p>
      ) : peut(me.data, 'demandes.conges') ? (
        <p className="flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="how_to_reg" size={16} className="shrink-0 text-primary" />
          La DCH vous confie les demandes de congé : elles vous arrivent directement, une fois
          visées par le N+1.
        </p>
      ) : null}

      {/* ———— À traiter ———— */}
      {traite ? (
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
            {chargement ? (
              <Squelette />
            ) : aTraiter.length === 0 ? (
              <EmptyState
                className="py-8"
                icon={<Icon name="how_to_reg" size={22} />}
                title="Rien à traiter"
                description="Une fois visée par le N+1, une demande de congé arrive ici, avec une notification."
              />
            ) : (
              <ul className="flex flex-col">
                {aTraiter.map((r) => (
                  <li key={r.id} className={LIGNE}>
                    <Resume demande={r} />
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {r.documentName ? (
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
                      ) : null}
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      {/* ———— Confiées (le directeur) ———— */}
      {confiees.length > 0 ? (
        <Card className="shrink-0">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Confiées</CardTitle>
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(confiees.length, 'demande')}
            </span>
          </CardHeader>
          <ul className="flex flex-col px-2 pb-2">
            {confiees.map((r) => (
              <li key={r.id} className={LIGNE}>
                <Resume demande={r} attendu={quiTraite(r.traitement)} />
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={confier.isPending && confier.variables?.id === r.id}
                    onClick={() => {
                      setMessage(null);
                      confierA(r, null);
                    }}
                  >
                    Reprendre
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <CalendrierDesAbsences />

      {/* ———— Suivi ———— */}
      <CartePleine>
        <CardHeader className="flex shrink-0 items-center justify-between gap-3">
          <CardTitle>Suivi</CardTitle>
        </CardHeader>
        <CorpsDefilant className="px-2 pb-2">
          {chargement ? (
            <Squelette />
          ) : suivi.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="free_cancellation" size={22} />}
              title="Rien à suivre pour le moment"
              description="Les demandes traitées — et, pour le directeur, celles qui attendent encore leur N+1 — s’affichent ici."
            />
          ) : (
            <ul className="flex flex-col">
              {suivi.map((r) => (
                <li key={r.id} className={LIGNE}>
                  <Resume demande={r} />
                  <div className="ml-auto flex shrink-0 items-center">
                    <StatutAbsence
                      statut={r.status}
                      etape={r.etapeAttendue}
                      titre={resumeVisas(r)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CorpsDefilant>
      </CartePleine>

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

      {/* ———— Confier une demande ———— */}
      {aConfier ? (
        <ModalConfier
          titre={`Confier la demande de ${aConfier.employeeName}`}
          sousTitre={`${aConfier.absenceTypeName} · ${formatDate(aConfier.startDate)} → ${formatDate(aConfier.endDate)}`}
          membres={membres}
          exclure={aConfier.employeeId}
          enCours={confier.isPending}
          onConfier={(employeeId) => confierA(aConfier, employeeId)}
          onClose={() => setAConfier(null)}
        />
      ) : null}

      {/* ———— Et les suivantes ? ———— */}
      {proposition ? (
        <ModalLesSuivantes
          membre={proposition}
          capacite="demandes.conges"
          onFait={(texte) => {
            setProposition(null);
            setMessage({ ton: 'ok', texte });
          }}
          onClose={() => setProposition(null)}
        />
      ) : null}

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

const LIGNE =
  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover';

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

/** Qui, quoi, quand — et, s'il y a lieu, qui la demande attend. */
function Resume({ demande: r, attendu }: { demande: AbsenceRequestView; attendu?: string | null }) {
  const n1 = r.circuit.find((e) => e.etape === 'n1');
  const origine =
    r.status === 'pending' && r.etapeAttendue === 'dch'
      ? n1?.etat === 'visee'
        ? `Visée par ${n1.qui}, son N+1`
        : 'Sans N+1 disponible'
      : null;
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="truncate text-[13px] font-semibold text-ink-strong">{r.employeeName}</p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted" style={TABULAIRE}>
        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)} ·{' '}
        {compte(r.daysCount, 'jour')}
      </p>
      {attendu || origine || r.reason ? (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-muted">
          {[attendu ?? origine, r.reason].filter(Boolean).join(' · ')}
        </p>
      ) : null}
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
