'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  heureEnLettres,
  premierDuMois,
  type EtatHabilitations,
  type FenetreDuPrincipalView,
  type TraitementView,
} from '@teranga/contracts';
import { Button, CardHeader, CardTitle, cn } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { Icon, type IconName } from './icons';

/* ————————————————————————————————————————————————————————————————
   Ce que les files de la DCH ont en commun : qui traite, le retour d'une
   action, le bandeau d'information, la pastille et l'en-tête pliable.

   Toutes les demandes du personnel relèvent de la DCH. Qui la dirige les
   traite, et peut les DÉLÉGUER aux membres de sa direction, depuis
   « Déléguer des tâches » : ils peuvent alors les traiter aussi, et la
   direction toujours.
   ———————————————————————————————————————————————————————————————— */

export type Message = { ton: 'ok' | 'erreur'; texte: string } | null;

export const texteErreur = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Action impossible.';

/** Le retour d'une action, en tête de page. */
export function BandeauMessage({ message }: { message: NonNullable<Message> }) {
  return (
    <p
      role="status"
      className={
        message.ton === 'ok'
          ? 'flex shrink-0 items-center gap-2 rounded-bloc bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset'
          : 'flex shrink-0 items-center gap-2 rounded-bloc bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset'
      }
    >
      <Icon name={message.ton === 'ok' ? 'check_circle' : 'error'} size={16} />
      {message.texte}
    </p>
  );
}

/**
 * Un bandeau d'information en tête de page : sur « Déléguer des tâches »,
 * qui peut modifier les délégations.
 *
 * Le même bandeau, en orange, porte ce qui attend un geste (des dossiers à
 * compléter) : deux bandeaux empilés gardent ainsi la même forme.
 */
export function BandeauDelegation({
  icone,
  texte,
  action,
  ton = 'bleu',
}: {
  icone: IconName;
  texte: React.ReactNode;
  action?: React.ReactNode;
  ton?: 'bleu' | 'orange';
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-bloc pl-3.5 text-[12.5px] text-ink',
        ton === 'orange' ? 'bg-accent/[0.08]' : 'bg-primary/[0.06]',
        action ? 'py-2 pr-2' : 'py-2.5 pr-3.5',
      )}
    >
      <Icon
        name={icone}
        size={16}
        className={cn('shrink-0', ton === 'orange' ? 'text-accent-text' : 'text-primary')}
      />
      <span className="min-w-0 flex-1">{texte}</span>
      {action}
    </div>
  );
}

/** Le nombre d'une liste, en pastille à côté de son titre. */
export function Pastille({ n }: { n: number }) {
  return (
    <span
      className="shrink-0 rounded-full bg-primary/[0.09] px-1.5 py-px text-[10px] font-extrabold text-primary"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {n}
    </span>
  );
}

/** L'en-tête d'une carte pliée par défaut — « Demandes traitées » : on l'ouvre quand on cherche. */
export function EnTetePliable({
  titre,
  n,
  ouvert,
  onBasculer,
}: {
  titre: string;
  n: number;
  ouvert: boolean;
  onBasculer: () => void;
}) {
  return (
    <CardHeader className="shrink-0 p-0">
      <button
        type="button"
        aria-expanded={ouvert}
        onClick={onBasculer}
        className="flex w-full items-center gap-2 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      >
        <CardTitle className="min-w-0 flex-1">{titre}</CardTitle>
        {n > 0 ? <Pastille n={n} /> : null}
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
  );
}

/**
 * Les membres de la DCH et ce qui leur est confié : pour qui la dirige (à
 * qui confier), et pour l'administrateur (qui peut quoi, en lecture).
 */
export function useMembresDCH() {
  const me = useMe();
  return useQuery({
    queryKey: ['habilitations'],
    queryFn: () => api<EtatHabilitations>('/habilitations'),
    enabled: Boolean(me.data?.dirigeLaDCH || me.data?.role === 'admin'),
  });
}

/** « Confiée à Awa Diop », « Awa Diop ou Khady Fall la traite » — en une ligne. */
export function quiTraite(t: TraitementView | null | undefined): string | null {
  if (!t) return null;
  if (t.aConfier) return 'Déléguer à un membre de la DCH';
  if (t.confiee) return `Confiée à ${t.confiee.nom}`;
  if (t.traitants)
    return `${t.traitants} la ${t.traitants.includes(' ou ') ? 'traitent' : 'traite'}`;
  return 'Personne pour la traiter en ce moment';
}

/** « 21 oct. à 10 h » : la fin de la fenêtre de 48 heures, à Dakar. */
function jusquAu(iso: string): string {
  const d = new Date(iso);
  const jour = premierDuMois(
    d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Dakar',
    }),
  );
  const heure = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Africa/Dakar',
  });
  return `${jour} à ${heureEnLettres(heure)}`;
}

/**
 * Pour les backups qui attendent la fin de la fenêtre (ADR-0128) : la demande,
 * qui la traite, et jusqu'à quand.
 */
export function AuPrincipal({ fenetre }: { fenetre: FenetreDuPrincipalView }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
      <Icon name="schedule" size={14} className="shrink-0" />
      <span>
        {fenetre.principal} la traite jusqu’au {jusquAu(fenetre.jusquAu)}
      </span>
    </span>
  );
}

/**
 * La personne principale confie la demande aux backups avant la fin de la
 * fenêtre (ADR-0128) : les backups la reçoivent aussitôt et la traitent aussi.
 */
export function ConfierAuxBackups({
  chemin,
  employe,
  onFait,
  onErreur,
}: {
  /** La route du geste : `/absence-requests/:id/ouvrir`, `/demandes/:type/:id/ouvrir`. */
  chemin: string;
  employe: string;
  onFait: () => void | Promise<void>;
  onErreur: (texte: string) => void;
}) {
  const confier = useMutation({
    mutationFn: () => api(chemin, { method: 'POST' }),
    onSuccess: onFait,
    onError: (err) => onErreur(texteErreur(err)),
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={confier.isPending}
      onClick={() => confier.mutate()}
      title={`Confier aux backups la demande de ${employe}`}
      className="whitespace-nowrap"
    >
      {confier.isPending ? null : <Icon name="group" size={15} />}
      Confier aux backups
    </Button>
  );
}
