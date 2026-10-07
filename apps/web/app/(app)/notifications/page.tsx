'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type Canal,
  type GroupeDeSujets,
  LIBELLES_CANAL,
  LIBELLES_GROUPE,
  numeroWhatsApp,
  type ReglageDeSujet,
  type ReglagesNotifications,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Input,
  Skeleton,
} from '@teranga/ui';
import { Page } from '../../../components/gabarit';
import { Icon, type IconName } from '../../../components/icons';
import { PhoneInput } from '../../../components/phone-input';
import { BandeauMessage, texteErreur, type Message } from '../../../components/traitement-dch';
import { api } from '../../../lib/api';
import { composePhone, splitPhone } from '../../../lib/countries';

/* Notifications : où chacun les reçoit.

   Une ligne par sujet que son profil peut recevoir (son espace, son équipe
   s'il en a une, ce que ses délégations lui confient), une colonne par
   canal : la plateforme, le courriel, WhatsApp. En tête de chaque groupe,
   une case par canal coche ou décoche tout le groupe. Chaque coche
   s'enregistre d'elle-même.

   WhatsApp demande un numéro prouvé par un code ; tant qu'il manque, sa
   colonne reste grisée. */

const CLE = ['notifications', 'reglages'] as const;
const GROUPES: GroupeDeSujets[] = ['moi', 'equipe', 'gestion'];

type Changement = Pick<ReglageDeSujet, 'sujet' | 'plateforme' | 'courriel' | 'whatsapp'>;

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

  const canaux: Canal[] = r.whatsapp.disponible
    ? ['plateforme', 'courriel', 'whatsapp']
    : ['plateforme', 'courriel'];
  const verifie = Boolean(r.whatsapp.numero);

  const changer = (lignes: ReglageDeSujet[], canal: Canal, valeur: boolean) =>
    sujets.mutate(
      lignes.map((l) => ({
        sujet: l.sujet,
        plateforme: l.plateforme,
        courriel: l.courriel,
        whatsapp: l.whatsapp,
        [canal]: valeur,
      })),
    );

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      <div
        className={cn(
          'grid shrink-0 grid-cols-1 gap-4',
          r.whatsapp.disponible && r.pauseConges !== null && 'lg:grid-cols-[3fr_2fr]',
        )}
      >
        {r.whatsapp.disponible ? <CarteWhatsApp reglages={r} onMessage={setMessage} /> : null}
        {r.pauseConges !== null ? <CartePause reglages={r} onMessage={setMessage} /> : null}
      </div>

      {GROUPES.map((groupe) => {
        const lignes = r.sujets.filter((s) => s.groupe === groupe);
        if (lignes.length === 0) return null;
        return (
          <Card key={groupe} className="shrink-0">
            <CardHeader className={cn('grid items-end gap-x-2 pb-3', colonnes(canaux.length))}>
              <CardTitle className="self-center">{LIBELLES_GROUPE[groupe]}</CardTitle>
              {canaux.map((canal) => {
                const coches = lignes.filter((l) => l[canal]).length;
                const ferme = canal === 'whatsapp' && !verifie;
                return (
                  <label
                    key={canal}
                    className={cn(
                      'flex flex-col items-center gap-1.5',
                      ferme ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                    title={ferme ? 'Vérifiez d’abord votre numéro WhatsApp' : undefined}
                  >
                    <span className="text-[10px] font-bold tracking-[0.06em] text-ink-muted uppercase sm:text-[10.5px]">
                      {LIBELLES_CANAL[canal]}
                    </span>
                    <Checkbox
                      aria-label={`${LIBELLES_CANAL[canal]} : tout ${LIBELLES_GROUPE[groupe]}`}
                      checked={coches === lignes.length}
                      indeterminate={coches > 0 && coches < lignes.length}
                      disabled={ferme}
                      onChange={() => changer(lignes, canal, coches < lignes.length)}
                    />
                  </label>
                );
              })}
            </CardHeader>
            <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
              {lignes.map((l) => (
                <li
                  key={l.sujet}
                  className={cn('grid items-center gap-x-2 px-5 py-3', colonnes(canaux.length))}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="hidden size-[30px] shrink-0 place-items-center rounded-[9px] bg-primary/[0.07] text-primary sm:grid">
                      <Icon name={l.icone as IconName} size={16} />
                    </span>
                    <span className="min-w-0 text-[12.5px] leading-snug font-medium text-ink-strong">
                      {l.libelle}
                    </span>
                  </span>
                  {canaux.map((canal) => (
                    <span key={canal} className="flex justify-center">
                      <Checkbox
                        aria-label={`${l.libelle} : ${LIBELLES_CANAL[canal]}`}
                        checked={l[canal]}
                        disabled={canal === 'whatsapp' && !verifie}
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

/** Le libellé, puis une colonne étroite par canal. */
const colonnes = (n: number) =>
  n === 3
    ? 'grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(3,6rem)]'
    : 'grid-cols-[minmax(0,1fr)_repeat(2,4.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(2,6rem)]';

/** Le logo de WhatsApp, à sa couleur. */
function LogoWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('fill-[#25D366]', className)}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

/** Une réponse du serveur remplace l'écran ; une erreur s'affiche en tête. */
function useReglage<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  onMessage: (m: Message) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: T) => api<ReglagesNotifications>(url, { method, body }),
    onMutate: () => onMessage(null),
    onSuccess: (r) => queryClient.setQueryData(CLE, r),
    onError: (err) => onMessage({ ton: 'erreur', texte: texteErreur(err) }),
  });
}

/** Le numéro WhatsApp : le saisir, le prouver par un code, le garder ou le retirer. */
function CarteWhatsApp({
  reglages: r,
  onMessage,
}: {
  reglages: ReglagesNotifications;
  onMessage: (m: Message) => void;
}) {
  const w = r.whatsapp;
  // Le pays d'abord, puis le numéro local : comme sur la fiche d'un employé.
  const [pays, setPays] = useState(() => splitPhone(w.numeroDuDossier).country);
  const [local, setLocal] = useState(() => splitPhone(w.numeroDuDossier).local);
  const saisie = composePhone(pays, local) ?? '';
  const [code, setCode] = useState('');
  // « Changer » rouvre la saisie sans retirer le numéro en service.
  const [changer, setChanger] = useState(false);
  const demander = useReglage<{ numero: string }>(
    '/notifications/reglages/whatsapp/code',
    'POST',
    onMessage,
  );
  const verifier = useReglage<{ code: string }>(
    '/notifications/reglages/whatsapp/verification',
    'POST',
    onMessage,
  );
  const retirer = useReglage<undefined>('/notifications/reglages/whatsapp', 'DELETE', onMessage);
  const calme = useReglage<{ heuresCalmes: boolean }>('/notifications/reglages', 'PUT', onMessage);

  const enAttente = w.codeEnvoyeA && (changer || !w.numero);
  const numeroValide = numeroWhatsApp(saisie) !== null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex items-center gap-2">
        <LogoWhatsApp className="size-4" />
        <CardTitle>WhatsApp</CardTitle>
      </CardHeader>
      <div className="flex flex-1 flex-col gap-4 px-5 pb-5">
        {w.numero && !changer ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[15px] font-semibold tracking-[0.01em] text-ink-strong tabular-nums">
              {w.numero}
            </span>
            <Badge tone="teal" size="sm">
              <Icon name="verified" size={12} />
              Vérifié
            </Badge>
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setChanger(true)}>
                Changer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={retirer.isPending}
                onClick={() => retirer.mutate(undefined)}
              >
                Retirer
              </Button>
            </span>
          </div>
        ) : enAttente ? (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              verifier.mutate(
                { code },
                {
                  onSuccess: () => {
                    setCode('');
                    setChanger(false);
                  },
                },
              );
            }}
          >
            <label htmlFor="code-whatsapp" className="text-[12.5px] text-ink">
              Code envoyé au <span className="font-semibold tabular-nums">{w.codeEnvoyeA}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="code-whatsapp"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="h-[34px] w-32 text-center text-[15px] tracking-[0.3em] tabular-nums"
              />
              <Button
                type="submit"
                size="md"
                disabled={code.length !== 6}
                loading={verifier.isPending}
              >
                Vérifier
              </Button>
              <Button
                type="button"
                size="md"
                variant="ghost"
                disabled={!numeroValide}
                loading={demander.isPending}
                onClick={() => demander.mutate({ numero: saisie })}
              >
                Renvoyer
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              demander.mutate({ numero: saisie });
            }}
          >
            <label htmlFor="numero-whatsapp" className="text-[12.5px] text-ink">
              Numéro WhatsApp
            </label>
            <div className="flex flex-wrap gap-2">
              <div className="w-full sm:w-80">
                <PhoneInput
                  id="numero-whatsapp"
                  country={pays}
                  local={local}
                  onCountryChange={(c) => {
                    setPays(c);
                    setLocal('');
                  }}
                  onLocalChange={setLocal}
                  compact
                />
              </div>
              <Button type="submit" size="md" disabled={!numeroValide} loading={demander.isPending}>
                Recevoir le code
              </Button>
              {changer ? (
                <Button type="button" size="md" variant="ghost" onClick={() => setChanger(false)}>
                  Annuler
                </Button>
              ) : null}
            </div>
          </form>
        )}

        {w.numero ? (
          <label className="mt-auto flex cursor-pointer items-center gap-2.5 border-t border-line-soft pt-3.5 text-[12.5px] text-ink">
            <Checkbox
              checked={r.heuresCalmes}
              onChange={() => calme.mutate({ heuresCalmes: !r.heuresCalmes })}
            />
            Pas de WhatsApp le soir, le week-end ni les jours fériés
          </label>
        ) : null}
      </div>
    </Card>
  );
}

/** En congé : la plateforme seulement, ni courriel ni WhatsApp. */
function CartePause({
  reglages: r,
  onMessage,
}: {
  reglages: ReglagesNotifications;
  onMessage: (m: Message) => void;
}) {
  const pause = useReglage<{ pauseConges: boolean }>('/notifications/reglages', 'PUT', onMessage);
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex items-center gap-2">
        <Icon name="event_busy" size={16} className="text-primary" />
        <CardTitle>Pendant mes congés</CardTitle>
      </CardHeader>
      <label className="flex cursor-pointer items-center gap-2.5 px-5 pb-5 text-[12.5px] text-ink">
        <Checkbox
          checked={Boolean(r.pauseConges)}
          onChange={() => pause.mutate({ pauseConges: !r.pauseConges })}
        />
        Dans la plateforme seulement, ni courriel ni WhatsApp
      </label>
    </Card>
  );
}
