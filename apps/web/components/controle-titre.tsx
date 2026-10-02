'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { DOCUMENT_CATEGORY_LABELS, type EmployeeDocumentView } from '@teranga/contracts';
import { Button, Field, Input } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { Icon } from './icons';
import { Modal } from './modal';

/* ————————————————————————————————————————————————————————————————
   Vérifier le titre d'identité de la fiche — CNI ou passeport.

   La même pièce : le document doit porter le numéro et les dates de la
   fiche ; conforme, on valide, sinon on rejette. Une nouvelle pièce
   (renouvellement, ou fiche vide) : on vérifie le document, puis on en
   saisit les informations — elles remplacent celles de la fiche.
   ———————————————————————————————————————————————————————————————— */

/** Le motif proposé quand le document ne porte pas ce que dit la fiche. */
const MOTIF_NON_CONFORME = 'Le document ne correspond pas aux informations de votre fiche.';

export function FenetreControleDuTitre({
  piece,
  employe,
  onFermer,
  onRejeter,
  onValide,
}: {
  piece: EmployeeDocumentView;
  employe: string;
  onFermer: () => void;
  /** Rejeter : le motif proposé, à confirmer ou à changer. */
  onRejeter: (motif: string) => void;
  /** Validé ; `fiche` : ses informations ont été mises à jour. */
  onValide: (fiche: boolean) => void;
}) {
  const id = useId();
  const controle = piece.controle!;
  const [mode, setMode] = useState(controle.mode);
  const [numero, setNumero] = useState('');
  const [delivreLe, setDelivreLe] = useState('');
  const [expireLe, setExpireLe] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const nom = DOCUMENT_CATEGORY_LABELS[piece.category];
  const fiche = controle.fiche;

  const valider = useMutation({
    mutationFn: () =>
      api(`/employee-documents/${piece.id}/review`, {
        method: 'POST',
        body: {
          decision: 'approved',
          ...(mode === 'saisie' ? { titre: { numero: numero.trim(), delivreLe, expireLe } } : {}),
        },
      }),
    onSuccess: () => onValide(mode === 'saisie'),
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Validation impossible.'),
  });

  const complet = Boolean(numero.trim() && delivreLe && expireLe);
  const datesInversees = Boolean(delivreLe && expireLe && delivreLe >= expireLe);

  return (
    <Modal
      open
      onClose={onFermer}
      title={nom}
      subtitle={`${employe}${piece.renouvellement ? ' · Renouvellement' : ''}`}
      maxWidth="max-w-lg"
      footer={
        <>
          {erreur ? (
            <p role="alert" className="min-w-0 flex-1 text-[12px] font-semibold text-danger">
              {erreur}
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => onRejeter(mode === 'conformite' ? MOTIF_NON_CONFORME : '')}
          >
            Rejeter
          </Button>
          <Button
            disabled={mode === 'saisie' && (!complet || datesInversees)}
            loading={valider.isPending}
            onClick={() => {
              setErreur(null);
              valider.mutate();
            }}
          >
            {mode === 'conformite' ? 'Conforme — valider' : 'Valider'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <a
          href={apiUrl(`/employee-documents/${piece.id}/content`)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
        >
          <Icon name="description" size={15} />
          Ouvrir le document
        </a>

        {mode === 'conformite' ? (
          <>
            <p className="text-[12.5px] text-ink">
              Vérifiez que le document porte ces informations :
            </p>
            <dl className="grid gap-px overflow-hidden rounded-[12px] border border-line-soft bg-line-soft">
              <Ligne libelle="Numéro de la pièce">
                <span className="font-mono">{fiche.numero}</span>
              </Ligne>
              <Ligne libelle="Date de délivrance">
                {fiche.delivreLe ? formatDate(fiche.delivreLe) : '—'}
              </Ligne>
              <Ligne libelle="Date d’expiration">
                {fiche.expireLe ? formatDate(fiche.expireLe) : '—'}
              </Ligne>
            </dl>
            <button
              type="button"
              onClick={() => setMode('saisie')}
              className="w-fit text-[12px] font-semibold text-ink-muted underline-offset-2 hover:text-primary hover:underline"
            >
              C’est une nouvelle pièce
            </button>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-ink">
              Saisissez les informations de la nouvelle pièce.
            </p>
            <Field label="Numéro de la pièce" htmlFor={`${id}-numero`} required>
              <Input
                id={`${id}-numero`}
                value={numero}
                maxLength={40}
                className="font-mono"
                onChange={(e) => setNumero(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date de délivrance" htmlFor={`${id}-delivre`} required>
                <Input
                  id={`${id}-delivre`}
                  type="date"
                  value={delivreLe}
                  onChange={(e) => setDelivreLe(e.target.value)}
                />
              </Field>
              <Field
                label="Date d’expiration"
                htmlFor={`${id}-expire`}
                required
                error={datesInversees ? 'Elle doit suivre la date de délivrance.' : undefined}
              >
                <Input
                  id={`${id}-expire`}
                  type="date"
                  min={delivreLe || undefined}
                  value={expireLe}
                  onChange={(e) => setExpireLe(e.target.value)}
                />
              </Field>
            </div>
            {fiche.numero ? (
              <p className="text-[11.5px] text-ink-muted">
                Sur la fiche aujourd’hui : <span className="font-mono">{fiche.numero}</span>
                {fiche.delivreLe ? ` · délivrée le ${formatDate(fiche.delivreLe)}` : ''}
                {fiche.expireLe ? ` · expire le ${formatDate(fiche.expireLe)}` : ''}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-surface px-3.5 py-2.5">
      <dt className="text-[12px] text-ink-muted">{libelle}</dt>
      <dd className="text-[13px] font-semibold text-ink-strong">{children}</dd>
    </div>
  );
}
