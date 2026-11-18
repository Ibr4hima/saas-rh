'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  LONGUEUR_DU_CODE,
  codeSaisi,
  type EtatDeLAttente,
  type InfoDuCode,
  type SessionUser,
} from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { BoutonMarque } from '../../../components/bouton-marque';
import { ChampMarque, EcranMarque, SaisieMarque } from '../../../components/ecran-marque';
import { api, ApiError } from '../../../lib/api';
import { ouvrirSession } from '../../../lib/session';
import { memoire, pageDeRetour, useEcranDeConnexion } from '../connexion';

/* ────────────────────────────────────────────────────────────────
   Le code reçu par email (ADR-0204). La connexion en cours vit côté
   serveur, derrière un cookie : rechargée, la page la retrouve ; expirée,
   on revient au premier écran.
   ──────────────────────────────────────────────────────────────── */

/** Ce que l'écran dit en tête, après une demande ou un renvoi. */
const INFOS: Record<InfoDuCode, { texte: string; attente: boolean }> = {
  renvoye: {
    texte: 'Si vos informations sont correctes, un nouveau code vous a été envoyé.',
    attente: false,
  },
  quota: {
    texte:
      'Trop de codes ont été demandés récemment. Utilisez le dernier code reçu, ou patientez 15 minutes.',
    attente: true,
  },
  trop_tot: {
    texte: 'Un code vient d’être envoyé. Patientez un instant avant d’en demander un nouveau.',
    attente: true,
  },
};

const CODE_INCORRECT = 'Code incorrect. Vérifiez le code reçu par email.';

export default function CodePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ecran = useEcranDeConnexion();
  const champ = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState<string | null>(memoire.attente?.email ?? null);
  const [info, setInfo] = useState<InfoDuCode | null>(memoire.attente?.info ?? null);
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [verification, setVerification] = useState(false);
  const [renvoi, setRenvoi] = useState(false);

  /** La connexion a pris fin : retour au premier écran, avec ce qu'il faut dire. */
  const recommencer = (message: string | null) => {
    memoire.erreur = message;
    router.replace(ecran('/login'));
  };

  // La connexion en cours, telle que le serveur la garde : la page rechargée
  // la retrouve ; sans elle, rien à saisir ici.
  useEffect(() => {
    let actif = true;
    api<EtatDeLAttente>('/auth/code')
      .then((etat) => {
        if (!actif) return;
        if (etat.enAttente) setEmail(etat.email);
        else recommencer(null);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
    // Une fois, à l'arrivée sur l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Une erreur du serveur : la connexion expirée ramène au début, le reste s'affiche ici. */
  const signaler = (err: unknown, sinon: string) => {
    if (err instanceof ApiError && err.problem.code === 'auth.connexion_expiree') {
      return recommencer(err.message);
    }
    setErreur(err instanceof ApiError ? err.message : sinon);
  };

  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    const saisi = codeSaisi(code);
    if (!saisi) return champ.current?.focus();
    // Un code trop court ne coûte pas un des cinq essais.
    if (saisi.length !== LONGUEUR_DU_CODE) return setErreur(CODE_INCORRECT);
    setErreur(null);
    setVerification(true);
    try {
      await api<{ user: SessionUser }>('/auth/code', { method: 'POST', body: { code: saisi } });
      Object.assign(memoire, { nom: '', email: '', attente: null, erreur: null });
      // Rien de ce qu'un autre compte a lu dans cet onglet ne lui survit.
      ouvrirSession(queryClient);
      router.replace(pageDeRetour());
    } catch (err) {
      signaler(err, 'Vérification impossible, réessayez.');
      setVerification(false);
      champ.current?.select();
    }
  };

  const renvoyer = async () => {
    setRenvoi(true);
    try {
      const r = await api<{ info: InfoDuCode }>('/auth/code/renvoi', { method: 'POST' });
      setErreur(null);
      setInfo(r.info);
    } catch (err) {
      signaler(err, 'Envoi impossible, réessayez.');
    } finally {
      setRenvoi(false);
    }
  };

  const enTete = info ? INFOS[info] : null;

  return (
    <EcranMarque
      titre="Saisissez votre code"
      sousTitre={
        email ? (
          <>
            Si vos informations sont correctes, un code de {LONGUEUR_DU_CODE}&nbsp;caractères vient
            d’être envoyé à <span className="font-semibold text-ink">{email}</span>.
          </>
        ) : null
      }
      pied={
        // Sur un petit écran, l'un sous l'autre : le point ne reste pas en bout de ligne.
        <span className="flex flex-col items-center gap-1.5 sm:flex-row sm:justify-center sm:gap-2.5">
          <button
            type="button"
            onClick={renvoyer}
            disabled={renvoi}
            className="font-bold text-primary underline-offset-4 hover:underline disabled:opacity-60"
          >
            Renvoyer un code
          </button>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <Link
            href={ecran('/login')}
            className="font-bold text-primary underline-offset-4 hover:underline"
          >
            Modifier mes informations
          </Link>
        </span>
      }
      note={{
        icone: 'mail',
        texte:
          'Le code peut mettre quelques minutes à arriver. Regardez aussi dans vos courriers indésirables et, sur Outlook, dans l’onglet Autres.',
      }}
    >
      <form method="post" onSubmit={valider} className="mt-6 flex flex-col gap-4" noValidate>
        {enTete ? (
          <p
            role="status"
            className={cn(
              'rounded-lg border px-3.5 py-2.5 text-center text-[12.5px] leading-relaxed font-medium text-ink',
              enTete.attente
                ? 'border-warning/25 bg-warning-soft'
                : 'border-primary/15 bg-primary-soft',
            )}
          >
            {enTete.texte}
          </p>
        ) : null}

        <ChampMarque id="code" label="Code reçu par email" erreur={erreur ?? undefined}>
          <SaisieMarque
            ref={champ}
            id="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder="······"
            aria-invalid={erreur ? true : undefined}
            aria-describedby={erreur ? 'code-erreur' : undefined}
            className="pl-3 text-center indent-[0.35em] text-[22px] font-bold tracking-[0.35em] tabular-nums placeholder:font-normal placeholder:text-ink-muted/60"
            value={code}
            onChange={(e) => {
              setErreur(null);
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, '')
                  .slice(0, LONGUEUR_DU_CODE),
              );
            }}
          />
        </ChampMarque>

        <BoutonMarque enCours={verification} libelleEnCours="Vérification…">
          Valider
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
