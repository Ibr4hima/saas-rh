'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  DOCUMENT_CATEGORY_LABELS,
  type MembreHabilite,
  type PieceATraiterView,
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
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
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
import { api, apiUrl } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Les pièces justificatives à vérifier pour la DCH.

   Un agent dépose une pièce (pièce d'identité, diplôme…) depuis son espace ;
   elle ne rejoint son dossier qu'une fois vérifiée. Des données sensibles :
   le directeur du Capital Humain les vérifie, ou les confie aux membres de
   sa direction qu'il choisit.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;
const LIGNE =
  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover';

export default function PiecesAVerifierPage() {
  const queryClient = useQueryClient();
  const pieces = useQuery({
    queryKey: ['pieces', 'file'],
    queryFn: () => api<PieceATraiterView[]>('/employee-documents/a-verifier'),
  });
  const membres = useMembresDCH().data?.membres ?? [];
  const [message, setMessage] = useState<Message>(null);
  const [rejet, setRejet] = useState<PieceATraiterView | null>(null);
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<ViewableDoc | null>(null);
  const [aConfier, setAConfier] = useState<PieceATraiterView | null>(null);
  const [proposition, setProposition] = useState<MembreHabilite | null>(null);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['pieces'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
  };
  const echec = (err: unknown) => setMessage({ ton: 'erreur', texte: texteErreur(err) });

  const verifier = useMutation({
    mutationFn: (v: { piece: PieceATraiterView; decision: 'approved' | 'rejected' }) =>
      api(`/employee-documents/${v.piece.id}/review`, {
        method: 'POST',
        body: {
          decision: v.decision,
          ...(v.decision === 'rejected' && motif.trim() ? { comment: motif.trim() } : {}),
        },
      }),
    onSuccess: async (_, v) => {
      setRejet(null);
      setMotif('');
      setMessage({
        ton: 'ok',
        texte:
          v.decision === 'approved'
            ? `« ${v.piece.label} » ajoutée au dossier de ${v.piece.employeeName}.`
            : `« ${v.piece.label} » rejetée — un message est envoyé à ${v.piece.employeeName}.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  const confier = useConfier('pieces', rafraichir);
  const confierA = (p: PieceATraiterView, employeeId: string | null) =>
    confier.mutate(
      { id: p.id, employeeId },
      {
        onSuccess: (res) => {
          setAConfier(null);
          const m = membres.find((x) => x.employeeId === employeeId);
          setMessage({
            ton: 'ok',
            texte: m
              ? `Pièce de ${p.employeeName} confiée à ${m.nom} — une notification lui est envoyée.`
              : `Vous reprenez la pièce de ${p.employeeName}.`,
          });
          if (res?.proposerHabilitation && m) setProposition(m);
        },
        onError: echec,
      },
    );

  const ouvrir = (p: PieceATraiterView) =>
    setApercu({
      url: apiUrl(`/employee-documents/${p.id}/content`),
      filename: p.filename,
      contentType: p.contentType,
      titre: `${p.label} — ${p.employeeName}`,
    });

  const toutes = pieces.data ?? [];
  const aVerifier = toutes.filter((p) => p.status === 'pending' && p.traitement?.pourMoi);
  const ailleurs = toutes.filter((p) => p.status === 'pending' && !p.traitement?.pourMoi);
  const verifiees = toutes.filter((p) => p.status !== 'pending');
  const dirige = toutes.some((p) => p.traitement?.peutConfier);

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      <Card className="shrink-0">
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>À vérifier</CardTitle>
          {aVerifier.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(aVerifier.length, 'pièce')}
            </span>
          ) : null}
        </CardHeader>
        <div className="px-2 pb-2">
          {pieces.isLoading ? (
            <Squelette />
          ) : aVerifier.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="upload_file" size={22} />}
              title="Rien à vérifier"
              description="Quand un agent dépose une pièce sur son dossier, elle arrive ici, avec une notification."
            />
          ) : (
            <ul className="flex flex-col">
              {aVerifier.map((p) => (
                <li key={p.id} className={LIGNE}>
                  <Resume piece={p} />
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => ouvrir(p)}>
                      <Icon name="visibility" size={15} />
                      Voir
                    </Button>
                    {p.traitement?.peutConfier && membres.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMessage(null);
                          setAConfier(p);
                        }}
                      >
                        Confier
                      </Button>
                    ) : null}
                    {p.canReview ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setMessage(null);
                            setMotif('');
                            setRejet(p);
                          }}
                        >
                          Rejeter
                        </Button>
                        <Button
                          size="sm"
                          loading={verifier.isPending && verifier.variables?.piece.id === p.id}
                          disabled={verifier.isPending}
                          onClick={() => {
                            setMessage(null);
                            verifier.mutate({ piece: p, decision: 'approved' });
                          }}
                        >
                          Valider
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

      {ailleurs.length > 0 ? (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle>{dirige ? 'Confiées' : 'Chez un autre membre de la DCH'}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col px-2 pb-2">
            {ailleurs.map((p) => (
              <li key={p.id} className={LIGNE}>
                <Resume piece={p} attendu={quiTraite(p.traitement)} />
                {p.traitement?.peutConfier ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    loading={confier.isPending && confier.variables?.id === p.id}
                    onClick={() => {
                      setMessage(null);
                      confierA(p, null);
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

      <CartePleine>
        <CardHeader className="shrink-0">
          <CardTitle>Vérifiées ces trente derniers jours</CardTitle>
        </CardHeader>
        <CorpsDefilant className="px-2 pb-2">
          {pieces.isLoading ? (
            <Squelette />
          ) : verifiees.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="upload_file" size={22} />}
              title="Aucune pièce vérifiée"
              description="Les pièces validées ou rejetées s’afficheront ici."
            />
          ) : (
            <ul className="flex flex-col">
              {verifiees.map((p) => (
                <li key={p.id} className={LIGNE}>
                  <Resume
                    piece={p}
                    attendu={[
                      p.reviewedByName ? `Par ${p.reviewedByName}` : null,
                      p.status === 'rejected' && p.reviewComment
                        ? `Motif : ${p.reviewComment}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <Badge tone={p.status === 'approved' ? 'success' : 'danger'} className="ml-auto">
                    {p.status === 'approved' ? 'Validée' : 'Rejetée'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CorpsDefilant>
      </CartePleine>

      {rejet ? (
        <Modal
          open
          onClose={() => setRejet(null)}
          title={`Rejeter « ${rejet.label} »`}
          subtitle={rejet.employeeName}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejet(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={verifier.isPending}
                onClick={() => verifier.mutate({ piece: rejet, decision: 'rejected' })}
              >
                Rejeter la pièce
              </Button>
            </div>
          }
        >
          <Field
            label="Motif"
            htmlFor="motif-rejet-piece"
            hint="Facultatif — il est transmis à l’agent, qui pourra déposer la pièce à nouveau."
          >
            <Textarea
              id="motif-rejet-piece"
              value={motif}
              maxLength={500}
              placeholder="Ex. : le scan est illisible — merci de déposer une version plus nette."
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {aConfier ? (
        <ModalConfier
          titre={`Confier la pièce de ${aConfier.employeeName}`}
          sousTitre={aConfier.label}
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
          capacite="demandes.pieces"
          onFait={(texte) => {
            setProposition(null);
            setMessage({ ton: 'ok', texte });
          }}
          onClose={() => setProposition(null)}
        />
      ) : null}

      <FenetreDocument doc={apercu} onClose={() => setApercu(null)} />
    </Page>
  );
}

function Resume({ piece: p, attendu }: { piece: PieceATraiterView; attendu?: string | null }) {
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="truncate text-[13px] font-semibold text-ink-strong">
        {p.employeeName}
        <span className="ml-2 font-mono text-[10.5px] font-normal text-ink-muted">
          {p.employeeNumber}
        </span>
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">
        {DOCUMENT_CATEGORY_LABELS[p.category]} · « {p.label} » · déposée le{' '}
        {formatDate(p.createdAt.slice(0, 10))}
      </p>
      {attendu ? <p className="mt-0.5 text-[11.5px] text-ink-muted">{attendu}</p> : null}
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
