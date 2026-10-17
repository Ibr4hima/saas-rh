'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { BoutonMarque, LienMarque } from '../../components/bouton-marque';
import { ChampMarque, EcranMarque, SaisieMarque } from '../../components/ecran-marque';
import { Icon } from '../../components/icons';
import { api, ApiError } from '../../lib/api';

/* ————————————————————————————————————————————————————————————————
   Mot de passe oublié.

   On donne son adresse ; un lien, valable une heure, y part. Le lien mène à
   /reinitialisation/<jeton>, où l'on choisit le nouveau mot de passe.

   L'écran qui suit dit la même chose que l'adresse ait un compte ou non :
   le serveur ne le dit pas non plus.
   ———————————————————————————————————————————————————————————————— */

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const demande = useMutation({
    mutationFn: () =>
      api<void>('/auth/mot-de-passe-oublie', { method: 'POST', body: { email: email.trim() } }),
    onSuccess: () => setEnvoye(true),
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.'),
  });

  // Seul un compte de l'APIX reçoit un lien : le bouton attend une adresse
  // complète en @apix.sn, pas la première lettre tapée.
  const emailValide = /^[^\s@]+@apix\.sn$/i.test(email.trim());

  if (envoye) {
    return (
      <EcranMarque
        titre="Vérifiez votre boîte"
        sousTitre={
          <>
            Si <span className="font-semibold text-ink">{email.trim()}</span> est l’adresse d’un
            compte, un lien vient d’y partir.
          </>
        }
        pied={
          <>
            Rien reçu ?{' '}
            <button
              type="button"
              onClick={() => {
                setErreur(null);
                setEnvoye(false);
              }}
              className="font-bold text-primary underline-offset-4 hover:underline"
            >
              Recommencer
            </button>
          </>
        }
      >
        <div className="mt-7 flex flex-col items-center gap-5">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name="mail" size={30} />
          </span>
          <LienMarque href="/login">Aller à la connexion</LienMarque>
        </div>
      </EcranMarque>
    );
  }

  return (
    <EcranMarque
      titre="Mot de passe oublié"
      sousTitre={
        <>
          Indiquez l&apos;adresse de votre compte{' '}
          <span className="font-semibold text-ink">@apix.sn</span> : un lien vous y sera envoyé.
        </>
      }
      pied={
        <>
          Vous vous en souvenez ?{' '}
          <Link href="/login" className="font-bold text-primary underline-offset-4 hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErreur(null);
          if (!emailValide) return setErreur('Indiquez votre adresse @apix.sn.');
          demande.mutate();
        }}
        className="mt-6 flex flex-col gap-4"
        noValidate
      >
        <ChampMarque id="email" label="Adresse email" icone="mail">
          <SaisieMarque
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="Entrez votre adresse email"
            value={email}
            onChange={(e) => {
              setErreur(null);
              setEmail(e.target.value);
            }}
          />
        </ChampMarque>

        {erreur ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {erreur}
          </p>
        ) : null}

        <BoutonMarque enCours={demande.isPending} libelleEnCours="Envoi…" disabled={!emailValide}>
          Recevoir le lien
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
