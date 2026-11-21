'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CANAUX,
  type Canal,
  type GroupeDeSujets,
  LIBELLES_CANAL,
  LIBELLES_GROUPE,
  type ReglageDeSujet,
  type ReglagesNotifications,
} from '@teranga/contracts';
import { Card, CardHeader, CardTitle, Checkbox, cn, Skeleton } from '@teranga/ui';
import { Page } from '../../../components/gabarit';
import { Icon, type IconName } from '../../../components/icons';
import { BandeauMessage, texteErreur, type Message } from '../../../components/traitement-dch';
import { api } from '../../../lib/api';

/* Notifications : où chacun les reçoit.

   Une ligne par sujet que son profil peut recevoir (son espace, son équipe
   s'il en a une, ce que ses délégations lui confient), une colonne par
   canal : la plateforme et le courriel (ADR-0074). En tête de chaque
   groupe, une case par canal coche ou décoche tout le groupe. Chaque coche
   s'enregistre d'elle-même. */

const CLE = ['notifications', 'reglages'] as const;
const GROUPES: GroupeDeSujets[] = ['moi', 'equipe', 'gestion'];

/** Le libellé, puis une colonne étroite par canal. */
const COLONNES =
  'grid-cols-[minmax(0,1fr)_repeat(2,4.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(2,6rem)]';

type Changement = Pick<ReglageDeSujet, 'sujet' | 'plateforme' | 'courriel'>;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const reglages = useQuery({
    queryKey: CLE,
    queryFn: () => api<ReglagesNotifications>('/notifications/reglages'),
  });
  const [message, setMessage] = useState<Message>(null);

  // La coche suit le geste sans attendre ; la réponse du serveur ne remplace
  // l'écran que s'il n'y a plus d'autre geste en route.
  const sujets = useMutation({
    mutationKey: ['notifications', 'sujets'],
    mutationFn: (liste: Changement[]) =>
      api<ReglagesNotifications>('/notifications/reglages/sujets', {
        method: 'PUT',
        body: { sujets: liste },
      }),
    onMutate: async (liste) => {
      setMessage(null);
      await queryClient.cancelQueries({ queryKey: CLE });
      const avant = queryClient.getQueryData<ReglagesNotifications>(CLE);
      if (avant) {
        const par = new Map(liste.map((c) => [c.sujet, c]));
        queryClient.setQueryData<ReglagesNotifications>(CLE, {
          ...avant,
          sujets: avant.sujets.map((s) => ({ ...s, ...par.get(s.sujet) })),
        });
      }
      return { avant };
    },
    onError: (err, _liste, ctx) => {
      if (ctx?.avant) queryClient.setQueryData(CLE, ctx.avant);
      setMessage({ ton: 'erreur', texte: texteErreur(err) });
    },
    onSuccess: (r) => {
      if (queryClient.isMutating({ mutationKey: ['notifications', 'sujets'] }) <= 1) {
        queryClient.setQueryData(CLE, r);
      }
    },
  });

  const r = reglages.data;
  if (reglages.isLoading || !r) {
    return (
      <Page>
        <Card className="shrink-0 p-5">
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      </Page>
    );
  }

  const changer = (lignes: ReglageDeSujet[], canal: Canal, valeur: boolean) =>
    sujets.mutate(
      lignes.map((l) => ({
        sujet: l.sujet,
        plateforme: l.plateforme,
        courriel: l.courriel,
        [canal]: valeur,
      })),
    );

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {r.pauseConges !== null ? <CartePause reglages={r} onMessage={setMessage} /> : null}

      {GROUPES.map((groupe) => {
        const lignes = r.sujets.filter((s) => s.groupe === groupe);
        if (lignes.length === 0) return null;
        return (
          <Card key={groupe} className="shrink-0">
            <CardHeader className={cn('grid items-end gap-x-2 pb-3', COLONNES)}>
              <CardTitle className="self-center">{LIBELLES_GROUPE[groupe]}</CardTitle>
              {CANAUX.map((canal) => {
                const coches = lignes.filter((l) => l[canal]).length;
                return (
                  <label key={canal} className="flex cursor-pointer flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold tracking-[0.06em] text-ink-muted uppercase sm:text-[10.5px]">
                      {LIBELLES_CANAL[canal]}
                    </span>
                    <Checkbox
                      aria-label={`${LIBELLES_CANAL[canal]} : tout ${LIBELLES_GROUPE[groupe]}`}
                      checked={coches === lignes.length}
                      indeterminate={coches > 0 && coches < lignes.length}
                      onChange={() => changer(lignes, canal, coches < lignes.length)}
                    />
                  </label>
                );
              })}
            </CardHeader>
            <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
              {lignes.map((l) => (
                <li key={l.sujet} className={cn('grid items-center gap-x-2 px-5 py-3', COLONNES)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="hidden size-[30px] shrink-0 place-items-center rounded-bloc bg-primary/[0.07] text-primary sm:grid">
                      <Icon name={l.icone as IconName} size={16} />
                    </span>
                    <span className="min-w-0 text-[12.5px] leading-snug font-medium text-ink-strong">
                      {l.libelle}
                    </span>
                  </span>
                  {CANAUX.map((canal) => (
                    <span key={canal} className="flex justify-center">
                      <Checkbox
                        aria-label={`${l.libelle} : ${LIBELLES_CANAL[canal]}`}
                        checked={l[canal]}
                        onChange={() => changer([l], canal, !l[canal])}
                      />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </Page>
  );
}

/** En congé : la plateforme seulement, pas de courriel. */
function CartePause({
  reglages: r,
  onMessage,
}: {
  reglages: ReglagesNotifications;
  onMessage: (m: Message) => void;
}) {
  const queryClient = useQueryClient();
  const pause = useMutation({
    mutationFn: (pauseConges: boolean) =>
      api<ReglagesNotifications>('/notifications/reglages', {
        method: 'PUT',
        body: { pauseConges },
      }),
    onMutate: () => onMessage(null),
    onSuccess: (reponse) => queryClient.setQueryData(CLE, reponse),
    onError: (err) => onMessage({ ton: 'erreur', texte: texteErreur(err) }),
  });
  return (
    <Card className="flex shrink-0 flex-col">
      <CardHeader className="flex items-center gap-2">
        <Icon name="event_busy" size={16} className="text-primary" />
        <CardTitle>Pendant mes congés</CardTitle>
      </CardHeader>
      <label className="flex cursor-pointer items-center gap-2.5 px-5 pb-5 text-[12.5px] text-ink">
        <Checkbox checked={Boolean(r.pauseConges)} onChange={() => pause.mutate(!r.pauseConges)} />
        Dans la plateforme seulement, sans courriel
      </label>
    </Card>
  );
}
