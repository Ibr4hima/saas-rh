'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { LienDeReinitialisation } from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { BoutonMarque, LienMarque } from '../../../components/bouton-marque';
import {
  BoutonOeil,
  ChampMarque,
  EcranMarque,
  motDePasseConforme,
  ReglesMotDePasse,
  SaisieMarque,
  SANS_COPIER_COLLER,
} from '../../../components/ecran-marque';
import { Icon } from '../../../components/icons';
import { api, ApiError } from '../../../lib/api';

/**
 * Le lien reçu par courriel : on choisit son nouveau mot de passe. Il sert
 * une fois, une heure durant ; ensuite, toutes les sessions du compte sont
 * fermées et l'on se reconnecte.
 */
export default function ReinitialisationPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [perime, setPerime] = useState(false);

  const lien = useQuery({
    queryKey: ['reinitialisation', token],
    queryFn: () => api<LienDeReinitialisation>(`/auth/reinitialisation/${token}`),
    retry: false,
    // Le lien ne se relit pas en revenant sur l'onglet : il vient de servir.
    refetchOnWindowFocus: false,
  });

  const enregistrement = useMutation({
    mutationFn: () =>
      api<void>(`/auth/reinitialisation/${token}`, { method: 'POST', body: { password } }),
    onError: (err) => {
      if (err instanceof ApiError && err.problem.status === 410) return setPerime(true);
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible, réessayez.');
    },
  });

  if (lien.isLoading) {
    return (
      <EcranMarque titre="Nouveau mot de passe">
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </EcranMarque>
    );
  }

  if (enregistrement.isSuccess) {
    return (
      <EcranMarque
        titre="Mot de passe modifié"
        sousTitre="Vous pouvez désormais vous connecter avec votre nouveau mot de passe."
      >
        <div className="mt-7 flex flex-col items-center gap-5">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <Icon name="check_circle" size={30} />
          </span>
          <LienMarque href="/login">Aller à la connexion</LienMarque>
        </div>
      </EcranMarque>
    );
  }

  if (perime || !lien.data?.valide) {
    return (
      <EcranMarque titre="Lien expiré" sousTitre="Ce lien n’est plus valable.">
        <div className="mt-7">
          <LienMarque href="/mot-de-passe-oublie">Demander un nouveau lien</LienMarque>
        </div>
      </EcranMarque>
    );
  }

  const email = lien.data.email;
  const conforme = motDePasseConforme(password, email);
  const discordance = conforme && confirm.length > 0 && password !== confirm;

  return (
    <EcranMarque
      titre="Nouveau mot de passe"
      sousTitre="Choisissez un mot de passe que vous n’utilisez nulle part ailleurs."
    >
      <form
        className="mt-6 flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setErreur(null);
          enregistrement.mutate();
        }}
      >
        <ChampMarque id="identifiant" label="Votre identifiant" icone="mail">
          <SaisieMarque
            id="identifiant"
            type="email"
            value={email}
            readOnly
            aria-readonly
            autoComplete="username"
            onFocus={(e) => e.currentTarget.select()}
            className="cursor-default text-ink-muted"
          />
        </ChampMarque>

        <div>
          <ChampMarque id="password" label="Nouveau mot de passe" icone="lock">
            <SaisieMarque
              id="password"
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              placeholder="12 caractères minimum"
              className="pr-11"
              value={password}
              onChange={(e) => {
                setErreur(null);
                setPassword(e.target.value);
                // Redevenu non conforme : la confirmation repart de zéro.
                if (!motDePasseConforme(e.target.value, email)) setConfirm('');
              }}
              {...SANS_COPIER_COLLER}
            />
            <BoutonOeil visible={showPwd} onToggle={() => setShowPwd((v) => !v)} />
          </ChampMarque>
          <ReglesMotDePasse password={password} email={email} />
        </div>

        <ChampMarque
          id="confirm"
          label="Confirmer le mot de passe"
          icone="check_circle"
          erreur={discordance ? 'Les deux mots de passe ne correspondent pas.' : undefined}
        >
          <SaisieMarque
            id="confirm"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            className="pr-11"
            value={confirm}
            disabled={!conforme}
            onChange={(e) => {
              setErreur(null);
              setConfirm(e.target.value);
            }}
            aria-invalid={discordance ? true : undefined}
            aria-describedby={discordance ? 'confirm-erreur' : undefined}
            {...SANS_COPIER_COLLER}
          />
          <BoutonOeil
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            disabled={!conforme}
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

        <BoutonMarque
          enCours={enregistrement.isPending}
          libelleEnCours="Enregistrement…"
          disabled={!conforme || confirm.length === 0 || discordance}
        >
          Enregistrer le mot de passe
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
