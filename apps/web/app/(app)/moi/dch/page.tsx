'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  AbsenceRequestView,
  EtatDelegation,
  MembreDCH,
  MyEmployeeView,
} from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Select,
  Skeleton,
  Textarea,
} from '@teranga/ui';
import { BoutonDecision } from '../../../../components/bouton-decision';
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { StatutAbsence } from '../../../../components/statut-absence';
import { resumeVisas, visaAttendu } from '../../../../lib/absences';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Les congés à traiter pour la Direction du Capital Humain.

   Le circuit de l'APIX : le N+1 vise d'abord ; la demande passe ensuite au
   directeur du Capital Humain, qui la traite — ou la confie à un membre de
   sa direction. Cet écran sert aux deux :

     — au DIRECTEUR : ce qui l'attend, ce qu'il a confié (et qu'il peut
       reprendre), et sa délégation — confier toutes les demandes à un
       membre, qui les reçoit alors directement ;
     — au MEMBRE à qui l'on a confié : ce qui l'attend, lui.

   Le menu ne le montre qu'à eux : c'est l'organigramme qui en décide.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

type Message = { ton: 'ok' | 'erreur'; texte: string } | null;

export default function CongesATraiterPage() {
  const queryClient = useQueryClient();
  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const delegation = useQuery({
    queryKey: ['delegation'],
    queryFn: () => api<EtatDelegation>('/absences/delegation'),
  });
  const demandes = useQuery({
    queryKey: ['absence-requests', 'dch'],
    queryFn: () => api<AbsenceRequestView[]>('/absence-requests?limit=100'),
  });

  const [message, setMessage] = useState<Message>(null);
  const [refus, setRefus] = useState<AbsenceRequestView | null>(null);
  const [motif, setMotif] = useState('');
  const [aConfier, setAConfier] = useState<AbsenceRequestView | null>(null);
  const [membre, setMembre] = useState('');
  /** Après une demande confiée à la main : confier aussi les suivantes ? */
  const [proposition, setProposition] = useState<MembreDCH | null>(null);
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
    await queryClient.invalidateQueries({ queryKey: ['delegation'] });
  };
  const echec = (err: unknown) =>
    setMessage({
      ton: 'erreur',
      texte: err instanceof ApiError ? err.message : 'Action impossible.',
    });

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

  const confier = useMutation({
    mutationFn: (v: { demande: AbsenceRequestView; employeeId: string | null }) =>
      api<{ proposerRegle: boolean }>(`/absence-requests/${v.demande.id}/confier`, {
        method: 'POST',
        body: { employeeId: v.employeeId },
      }),
    onSuccess: async (res, v) => {
      setAConfier(null);
      const m = (delegation.data?.membres ?? []).find((x) => x.employeeId === v.employeeId);
      setMessage({
        ton: 'ok',
        texte: m
          ? `Demande de ${v.demande.employeeName} confiée à ${m.nom} — elle est prévenue.`
          : `Vous reprenez la demande de ${v.demande.employeeName}.`,
      });
      if (res?.proposerRegle && m) setProposition(m);
      await rafraichir();
    },
    onError: echec,
  });

  const deleguer = useMutation({
    mutationFn: (delegueEmployeeId: string | null) =>
      api('/absences/delegation', {
        method: 'PUT',
        body: { typeDemande: 'conges', delegueEmployeeId },
      }),
    onSuccess: async (_, delegueEmployeeId) => {
      setProposition(null);
      const m = (delegation.data?.membres ?? []).find((x) => x.employeeId === delegueEmployeeId);
      setMessage({
        ton: 'ok',
        texte: m
          ? `Les demandes de congé vont désormais directement à ${m.nom}.`
          : 'Vous traitez vous-même les demandes de congé.',
      });
      await rafraichir();
    },
    onError: echec,
  });

  const d = delegation.data;
  const monId = moi.data?.employeeId;
  const toutes = demandes.data ?? [];
  const aTraiter = toutes
    .filter((r) => r.canDecide && r.etapeAttendue === 'dch' && r.traitant?.employeeId === monId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const confiees = d?.estDirecteur
    ? toutes.filter(
        (r) =>
          r.status === 'pending' &&
          r.etapeAttendue === 'dch' &&
          r.traitant &&
          r.traitant.employeeId !== monId,
      )
    : [];
  const suivi = toutes
    .filter((r) => !aTraiter.includes(r) && !confiees.includes(r))
    .filter((r) => r.status !== 'pending' || d?.estDirecteur)
    .slice(0, 40);

  const chargement = demandes.isLoading || delegation.isLoading || moi.isLoading;

  return (
    <Page>
      {message ? <Bandeau message={message} /> : null}

      {d?.estDirecteur ? (
        <CarteDelegation
          etat={d}
          enCours={deleguer.isPending}
          onChoisir={(id) => {
            setMessage(null);
            deleguer.mutate(id);
          }}
        />
      ) : d?.estDelegue && d.directeur ? (
        <p className="flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="how_to_reg" size={16} className="shrink-0 text-primary" />
          {d.directeur.nom}, qui dirige la DCH, vous confie les demandes de congé : elles vous
          arrivent directement, une fois visées par le N+1.
        </p>
      ) : null}

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
                    {r.peutConfier && (d?.membres.length ?? 0) > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMessage(null);
                          setMembre('');
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
                <Resume demande={r} attendu={`Confiée à ${r.traitant!.nom}`} />
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={confier.isPending && confier.variables?.demande.id === r.id}
                    onClick={() => {
                      setMessage(null);
                      confier.mutate({ demande: r, employeeId: null });
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
                  <Resume demande={r} attendu={visaAttendu(r)} />
                  <div className="ml-auto flex shrink-0 items-center">
                    <StatutAbsence statut={r.status} titre={resumeVisas(r)} />
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
        <Modal
          open
          onClose={() => setAConfier(null)}
          title={`Confier la demande de ${aConfier.employeeName}`}
          subtitle={`${aConfier.absenceTypeName} · ${formatDate(aConfier.startDate)} → ${formatDate(aConfier.endDate)}`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setAConfier(null)}>
                Annuler
              </Button>
              <Button
                disabled={!membre}
                loading={confier.isPending}
                onClick={() => confier.mutate({ demande: aConfier, employeeId: membre })}
              >
                Confier
              </Button>
            </div>
          }
        >
          <Field
            label="À un membre de la DCH"
            htmlFor="confier-a"
            hint="Le membre reçoit une notification et la traite à votre place. Vous la voyez toujours, et pouvez la reprendre."
          >
            <Select id="confier-a" value={membre} onChange={(e) => setMembre(e.target.value)}>
              <option value="">— Choisir</option>
              {(d?.membres ?? [])
                .filter((m) => m.employeeId !== aConfier.employeeId)
                .map((m) => (
                  <option key={m.employeeId} value={m.employeeId}>
                    {m.nom}
                    {m.poste ? ` — ${m.poste}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
        </Modal>
      ) : null}

      {/* ———— Et les suivantes ? ———— */}
      {proposition ? (
        <Modal
          open
          onClose={() => setProposition(null)}
          title={`Confier aussi les prochaines à ${proposition.nom} ?`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setProposition(null)}>
                Non, pas maintenant
              </Button>
              <Button
                loading={deleguer.isPending}
                onClick={() => deleguer.mutate(proposition.employeeId)}
              >
                Oui, désormais
              </Button>
            </div>
          }
        >
          <p className="text-[13px] leading-relaxed text-ink">
            Les demandes de congé iront directement à {proposition.nom}, une fois visées par le N+1.
            Vous ne recevrez plus de notification, mais vous les verrez toutes et pourrez reprendre
            la main à tout moment. Si {proposition.nom} quitte la DCH ou part en congé, elles vous
            reviennent.
          </p>
        </Modal>
      ) : null}

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

const LIGNE =
  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover';

/**
 * La délégation du directeur : à qui vont les demandes de congé. Une panne —
 * le membre est parti, ou en congé — se dit ici, en orange : c'est une
 * décision qui l'attend.
 */
function CarteDelegation({
  etat,
  enCours,
  onChoisir,
}: {
  etat: EtatDelegation;
  enCours: boolean;
  onChoisir: (employeeId: string | null) => void;
}) {
  const [choix, setChoix] = useState('');
  const actif = etat.choix === 'delegue' && etat.delegue && etat.delegueIndisponible !== 'parti';
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>Délégation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {etat.delegueIndisponible === 'parti' && etat.delegue ? (
          <p className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-accent-text ring-1 ring-current/15 ring-inset">
            <Icon name="error" size={16} className="mt-px shrink-0" />
            <span>
              {etat.delegue.nom} ne fait plus partie de la DCH : les demandes de congé vous
              reviennent. Voulez-vous les confier à un autre membre de votre direction ?
            </span>
          </p>
        ) : etat.delegueIndisponible === 'absent' && etat.delegue ? (
          <p className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-accent-text ring-1 ring-current/15 ring-inset">
            <Icon name="event_busy" size={16} className="mt-px shrink-0" />
            <span>
              {etat.delegue.nom} est en congé aujourd’hui : les demandes vous reviennent le temps de
              son absence.
            </span>
          </p>
        ) : null}
        <p className="text-[12.5px] leading-relaxed text-ink">
          {actif ? (
            <>
              Les demandes de congé vont directement à{' '}
              <span className="font-semibold text-ink-strong">{etat.delegue!.nom}</span>, une fois
              visées par le N+1. Vous ne recevez plus de notification, mais vous les voyez toutes et
              pouvez reprendre la main.
            </>
          ) : (
            <>
              Vous traitez vous-même les demandes de congé. Vous pouvez les confier à un membre de
              la DCH : elles lui arriveront directement.
            </>
          )}
        </p>
        {etat.membres.length === 0 ? (
          <p className="text-[12px] text-ink-muted">
            Aucun autre membre de la DCH n’a encore accès au portail.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 sm:max-w-sm">
              <Field label={actif ? 'Confier à un autre membre' : 'Confier à'} htmlFor="delegue">
                <Select id="delegue" value={choix} onChange={(e) => setChoix(e.target.value)}>
                  <option value="">— Choisir un membre de la DCH</option>
                  {etat.membres
                    .filter((m) => !actif || m.employeeId !== etat.delegue?.employeeId)
                    .map((m) => (
                      <option key={m.employeeId} value={m.employeeId}>
                        {m.nom}
                        {m.poste ? ` — ${m.poste}` : ''}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Button
              size="sm"
              disabled={!choix}
              loading={enCours}
              onClick={() => {
                onChoisir(choix);
                setChoix('');
              }}
            >
              Confier les demandes
            </Button>
            {actif ? (
              <Button size="sm" variant="ghost" loading={enCours} onClick={() => onChoisir(null)}>
                Les traiter moi-même
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Bandeau({ message }: { message: NonNullable<Message> }) {
  return (
    <p
      role="status"
      className={
        message.ton === 'ok'
          ? 'flex shrink-0 items-center gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset'
          : 'flex shrink-0 items-center gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset'
      }
    >
      <Icon name={message.ton === 'ok' ? 'check_circle' : 'error'} size={16} />
      {message.texte}
    </p>
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
