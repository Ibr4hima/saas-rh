'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DOCUMENT_CATEGORY_LABELS, peut, type PieceATraiterView } from '@teranga/contracts';
import {
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
import { FenetreControleDuTitre } from '../../../../components/controle-titre';
import { DeleguerPieces, detient, TYPES_PIECES } from '../../../../components/deleguer-documents';
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import {
  BandeauDelegation,
  BandeauMessage,
  listePrenoms,
  Pastille,
  texteErreur,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { api, apiUrl } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   « Vérification des documents » — les documents officiels déposés par
   les agents, pour la Direction du Capital Humain.

   Un agent dépose un document (pièce d'identité, diplôme…) depuis son
   espace ; il ne rejoint son dossier qu'une fois vérifié. Son directeur
   peut DÉLÉGUER : les membres qu'il coche peuvent vérifier ces documents —
   et lui aussi, toujours.
   ———————————————————————————————————————————————————————————————— */

export default function PiecesAVerifierPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const estDirecteur = Boolean(me.data?.dirigeLaDCH);
  const pieces = useQuery({
    queryKey: ['pieces', 'file'],
    queryFn: () => api<PieceATraiterView[]>('/employee-documents/a-verifier'),
  });
  const membres = useMembresDCH().data?.membres ?? [];
  const [message, setMessage] = useState<Message>(null);
  const [rejet, setRejet] = useState<PieceATraiterView | null>(null);
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<ViewableDoc | null>(null);
  // Le titre d'identité de la fiche, en cours de vérification.
  const [aControler, setAControler] = useState<PieceATraiterView | null>(null);

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
            ? `« ${v.piece.label} » ajouté au dossier de ${v.piece.employeeName}.`
            : `« ${v.piece.label} » rejeté. Un message est envoyé à ${v.piece.employeeName}.`,
      });
      await rafraichir();
    },
    onError: echec,
  });

  const ouvrir = (p: PieceATraiterView) =>
    setApercu({
      url: apiUrl(`/employee-documents/${p.id}/content`),
      filename: p.filename,
      contentType: p.contentType,
      titre: `${p.label} — ${p.employeeName}`,
    });

  // Ce que l'appelant peut vérifier — le directeur, tout, délégué ou non —,
  // et son propre document, qu'il délègue. Qui consulte seulement voit la
  // file entière, sans geste.
  const toutes = pieces.data ?? [];
  // Ce qui est délégué, type par type : à qui, et — au membre — à lui.
  const delegues = membres.filter((m) =>
    TYPES_PIECES.some((t) => t.capacites.some((c) => m.capacites.includes(c))),
  );
  const tousLesTypes = delegues.every((m) => TYPES_PIECES.every((t) => detient(m, t)));
  const miens = TYPES_PIECES.filter((t) => t.capacites.some((c) => peut(me.data, c)));
  const traite = estDirecteur || miens.length > 0 || toutes.some((p) => p.canReview);
  const aVerifier = toutes.filter(
    (p) => p.status === 'pending' && (!traite || p.canReview || Boolean(p.traitement?.aConfier)),
  );

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {estDirecteur ? (
        <BandeauDelegation
          icone="arrow_split"
          texte={
            delegues.length > 0
              ? `${listePrenoms(delegues)} ${delegues.length > 1 ? 'peuvent' : 'peut'} désormais vérifier ${tousLesTypes ? 'les' : 'certains'} documents officiels.`
              : 'Vous pouvez déléguer la vérification des documents à votre équipe.'
          }
          action={<DeleguerPieces membres={membres} onFait={() => setMessage(null)} />}
        />
      ) : miens.length > 0 ? (
        <BandeauDelegation
          icone="how_to_reg"
          texte={
            miens.length === TYPES_PIECES.length
              ? 'La DCH vous a délégué la vérification des documents officiels.'
              : `La DCH vous a délégué la vérification des documents suivants : ${miens.map((t) => t.libelle).join(', ')}.`
          }
        />
      ) : null}

      {/* ———— Demandes à traiter ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center gap-2">
          <CardTitle className="min-w-0 flex-1">Demandes à traiter</CardTitle>
          {aVerifier.length > 0 ? <Pastille n={aVerifier.length} /> : null}
        </CardHeader>
        {pieces.isLoading ? (
          <div className="px-2 pb-2">
            <Squelette />
          </div>
        ) : aVerifier.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<Icon name="upload_file" size={22} />}
            title="Rien à vérifier"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Employé</Th>
                <Th>Type</Th>
                <Th>Document</Th>
                <Th>Déposé le</Th>
                <Th className="text-right">{traite ? 'Décision' : 'Traitée par'}</Th>
              </tr>
            </THead>
            <TBody>
              {aVerifier.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {p.employeeName}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {DOCUMENT_CATEGORY_LABELS[p.category]}
                    {p.renouvellement ? (
                      <span className="block text-[11px] text-ink-muted">Renouvellement</span>
                    ) : null}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => ouvrir(p)}
                      title={`Voir « ${p.label} »`}
                      className="inline-flex max-w-64 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary-soft"
                    >
                      <Icon name="description" size={14} className="shrink-0" />
                      <span className="truncate">{p.label}</span>
                    </button>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {formatDate(p.createdAt.slice(0, 10))}
                  </Td>
                  <Td>
                    {!traite ? (
                      <p className="text-right text-[12px] text-ink-muted">
                        {p.traitement?.traitants ?? '—'}
                      </p>
                    ) : p.canReview ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <BoutonDecision
                          geste="approuver"
                          objet="le document"
                          employe={p.employeeName}
                          enCours={
                            verifier.isPending &&
                            verifier.variables?.piece.id === p.id &&
                            verifier.variables.decision === 'approved'
                          }
                          bloque={verifier.isPending}
                          onClick={() => {
                            setMessage(null);
                            // Le titre de la fiche se vérifie contre elle.
                            if (p.controle) setAControler(p);
                            else verifier.mutate({ piece: p, decision: 'approved' });
                          }}
                        />
                        <BoutonDecision
                          geste="refuser"
                          objet="le document"
                          employe={p.employeeName}
                          enCours={false}
                          bloque={verifier.isPending}
                          onClick={() => {
                            setMessage(null);
                            setMotif('');
                            setRejet(p);
                          }}
                        />
                      </div>
                    ) : (
                      <p className="text-right text-[11.5px] font-semibold text-accent-text">
                        Votre propre document, à déléguer
                      </p>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

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
                Rejeter le document
              </Button>
            </div>
          }
        >
          <Field
            label="Motif"
            htmlFor="motif-rejet-piece"
            hint="Facultatif. Il est transmis à l’agent, qui pourra déposer le document à nouveau."
          >
            <Textarea
              id="motif-rejet-piece"
              value={motif}
              maxLength={500}
              placeholder="Ex. : le scan est illisible, merci de déposer une version plus nette."
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {aControler ? (
        <FenetreControleDuTitre
          piece={aControler}
          employe={aControler.employeeName}
          onFermer={() => setAControler(null)}
          onRejeter={(m) => {
            setMotif(m);
            setRejet(aControler);
            setAControler(null);
          }}
          onValide={async (fiche) => {
            const p = aControler;
            setAControler(null);
            setMessage({
              ton: 'ok',
              texte: `« ${p.label} » ajouté au dossier de ${p.employeeName}${fiche ? '. Sa fiche est mise à jour' : ''}.`,
            });
            await rafraichir();
          }}
        />
      ) : null}

      <FenetreDocument doc={apercu} onClose={() => setApercu(null)} />
    </Page>
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
