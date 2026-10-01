'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { peut, type AbsenceRequestView, type MembreHabilite } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
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
import { Page } from '../../../../components/gabarit';
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
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-primary/[0.06] py-2 pr-2 pl-3.5 text-[12.5px] text-ink">
          <Icon name="arrow_split" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            {habilites.length > 0
              ? `${listePrenoms(habilites)} ${habilites.length > 1 ? 'traitent' : 'traite'} les demandes d’absence et de congé.`
              : 'Vous pouvez déléguer cette tâche à votre équipe.'}
          </span>
          <Deleguer
            membres={membres}
            onFait={(texte) => setMessage({ ton: 'ok', texte })}
            onErreur={echec}
          />
        </div>
      ) : peut(me.data, 'demandes.conges') ? (
        <p className="flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="how_to_reg" size={16} className="shrink-0 text-primary" />
          La DCH vous confie les demandes de congé : elles vous arrivent directement, une fois
          visées par le N+1.
        </p>
      ) : null}

      {/* ———— Demandes à traiter ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Demandes à traiter</CardTitle>
          {enAttente.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(enAttente.length, 'demande')}
            </span>
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
                  <Td>
                    <CelluleEmploye demande={r} />
                  </Td>
                  <Td>
                    <CelluleType demande={r} />
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Periode demande={r} />
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                  <Td>{justificatif(r)}</Td>
                  <Td>
                    {traite ? (
                      <div className="flex items-center justify-end gap-1.5">
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

      {/* ———— Confiées (le directeur) ———— */}
      {confiees.length > 0 ? (
        <Card className="shrink-0">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Confiées</CardTitle>
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(confiees.length, 'demande')}
            </span>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <Th>Employé</Th>
                <Th>Type</Th>
                <Th>Période</Th>
                <Th className="text-right">Jours</Th>
                <Th>Chez</Th>
                <Th className="text-right">Reprendre</Th>
              </tr>
            </THead>
            <TBody>
              {confiees.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <CelluleEmploye demande={r} />
                  </Td>
                  <Td>
                    <CelluleType demande={r} />
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Periode demande={r} />
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                  <Td className="text-[12px] text-ink-muted">{quiTraite(r.traitement) ?? '—'}</Td>
                  <Td>
                    <div className="flex justify-end">
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
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

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

/** « Awa », « Awa et Khady », « Awa, Khady et Moussa ». */
function listePrenoms(membres: MembreHabilite[]): string {
  const p = membres.map((m) => m.prenom);
  return p.length > 1 ? `${p.slice(0, -1).join(', ')} et ${p[p.length - 1]}` : (p[0] ?? '');
}

/** Qui demande, et d'où vient la demande — visée par son N+1, ou sans N+1. */
function CelluleEmploye({ demande: r }: { demande: AbsenceRequestView }) {
  const n1 = r.circuit.find((e) => e.etape === 'n1');
  const origine =
    r.status === 'pending' && r.etapeAttendue === 'dch'
      ? n1?.etat === 'visee'
        ? `Visée par ${n1.qui}`
        : 'Sans N+1 disponible'
      : null;
  return (
    <>
      <p className="font-semibold whitespace-nowrap text-ink-strong">{r.employeeName}</p>
      {origine ? <p className="mt-0.5 text-[11px] text-ink-muted">{origine}</p> : null}
    </>
  );
}

/** Le type d'absence, et le motif que l'agent en donne. */
function CelluleType({ demande: r }: { demande: AbsenceRequestView }) {
  return (
    <>
      <p className="whitespace-nowrap">{r.absenceTypeName}</p>
      {r.reason ? (
        <p className="mt-0.5 line-clamp-1 max-w-56 text-[11px] text-ink-muted" title={r.reason}>
          {r.reason}
        </p>
      ) : null}
    </>
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
      <CardHeader className="p-0">
        <button
          type="button"
          aria-expanded={ouvert}
          onClick={() => setOuvert((o) => !o)}
          className="flex w-full items-center gap-2 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          <CardTitle className="min-w-0 flex-1">Demandes traitées</CardTitle>
          {demandes.length > 0 ? (
            <span
              className="rounded-full bg-primary/[0.09] px-1.5 py-px text-[10px] font-extrabold text-primary"
              style={TABULAIRE}
            >
              {demandes.length}
            </span>
          ) : null}
          <Icon
            name="chevron_right"
            size={18}
            className={cn(
              'shrink-0 text-ink-muted transition-transform duration-200',
              ouvert && 'rotate-90',
            )}
          />
        </button>
      </CardHeader>
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
                <Td className="font-semibold text-ink-strong">{r.employeeName}</Td>
                <Td>
                  <CelluleType demande={r} />
                </Td>
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

/**
 * « Déléguer » : les membres de la DCH, à cocher — ceux qui traiteront les
 * demandes d'absence et de congé. « Valider » demande confirmation, en les
 * nommant, avant de rien changer.
 */
function Deleguer({
  membres,
  onFait,
  onErreur,
}: {
  membres: MembreHabilite[];
  onFait: (texte: string) => void;
  onErreur: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const actuels = membres.filter((m) => m.capacites.includes('demandes.conges'));
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<string[]>([]);
  const [confirmer, setConfirmer] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  // Ouvert, le menu part de l'état réel ; Échap et un clic ailleurs le referment.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('pointerdown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  const avant = new Set(actuels.map((m) => m.employeeId));
  const apres = new Set(choix);
  const change = membres.some((m) => avant.has(m.employeeId) !== apres.has(m.employeeId));
  const retenus = membres.filter((m) => apres.has(m.employeeId));

  const appliquer = useMutation({
    mutationFn: async () => {
      // Un membre à la fois : chacun l'apprend par sa propre notification.
      for (const m of membres) {
        const accordee = apres.has(m.employeeId);
        if (accordee === avant.has(m.employeeId)) continue;
        await api('/habilitations', {
          method: 'PUT',
          body: { employeeId: m.employeeId, capacite: 'demandes.conges', accordee },
        });
      }
    },
    onSuccess: async () => {
      setConfirmer(false);
      setOuvert(false);
      onFait(
        retenus.length > 0
          ? `${listePrenoms(retenus)} ${retenus.length > 1 ? 'traiteront' : 'traitera'} désormais les demandes d’absence et de congé.`
          : 'Vous traitez de nouveau vous-même les demandes d’absence et de congé.',
      );
      await queryClient.invalidateQueries({ queryKey: ['habilitations'] });
      await queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
    },
    onError: (err) => {
      setConfirmer(false);
      onErreur(err);
    },
  });

  return (
    <div ref={racine} className="relative shrink-0">
      <Button
        size="sm"
        variant="secondary"
        aria-haspopup="true"
        aria-expanded={ouvert}
        onClick={() => {
          if (!ouvert) setChoix(actuels.map((m) => m.employeeId));
          setOuvert((o) => !o);
        }}
      >
        Déléguer
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            '-mr-1 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </Button>
      {ouvert ? (
        <div className="tg-menu absolute top-full right-0 z-30 mt-1.5 w-72 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg">
          {membres.length === 0 ? (
            <p className="px-2.5 py-3 text-[12px] text-ink-muted">
              Aucun autre membre dans votre direction.
            </p>
          ) : (
            <ul role="group" aria-label="Membres de la DCH" className="max-h-72 overflow-y-auto">
              {membres.map((m) => {
                const coche = apres.has(m.employeeId);
                return (
                  <li key={m.employeeId}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors duration-150 hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={coche}
                        onChange={() =>
                          setChoix((c) =>
                            coche ? c.filter((x) => x !== m.employeeId) : [...c, m.employeeId],
                          )
                        }
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink-strong">
                          {m.nom}
                        </span>
                        {m.poste || m.absent ? (
                          <span className="block truncate text-[11px] text-ink-muted">
                            {[m.poste, m.absent ? 'Absent aujourd’hui' : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-1 flex justify-end border-t border-line-soft px-1 pt-1.5">
            <Button
              size="sm"
              disabled={!change}
              onClick={() => {
                setOuvert(false);
                setConfirmer(true);
              }}
            >
              Valider
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmer}
        onClose={() => setConfirmer(false)}
        title="Déléguer les absences et congés"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmer(false)}>
              Annuler
            </Button>
            <Button loading={appliquer.isPending} onClick={() => appliquer.mutate()}>
              Confirmer
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          {retenus.length > 0
            ? `${listePrenoms(retenus)} ${retenus.length > 1 ? 'traiteront' : 'traitera'} désormais les demandes d’absence et de congé, une fois visées par le N+1, conformément au circuit de validation. Vous les verrez toutes et pourrez reprendre la main à tout moment.`
            : 'Vous traiterez de nouveau vous-même les demandes d’absence et de congé, une fois visées par le N+1, conformément au circuit de validation.'}
        </p>
      </Modal>
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
