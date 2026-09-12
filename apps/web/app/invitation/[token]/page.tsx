'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AcceptResult, InvitationInfo } from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { BoutonMarque } from '../../../components/bouton-marque';
import {
  BoutonOeil,
  ChampMarque,
  EcranMarque,
  ReglesMotDePasse,
  SaisieMarque,
} from '../../../components/ecran-marque';
import { api, ApiError } from '../../../lib/api';

/**
 * L'accueil s'accorde avec la personne invitée. Sans genre au dossier, la
 * forme inclusive : mieux vaut « Apixien·ne » qu'un masculin posé au hasard
 * sur quelqu'un dont on n'a pas l'information.
 */
function apixien(gender: 'female' | 'male' | null | undefined): string {
  if (gender === 'female') return 'Apixienne';
  if (gender === 'male') return 'Apixien';
  return 'Apixien·ne';
}

const INVALID_MESSAGES: Record<string, string> = {
  expired: 'Cette invitation a expiré. Demandez à votre service RH de vous en renvoyer une.',
  used: 'Cette invitation a déjà été utilisée. Connectez-vous avec votre compte.',
  not_found: "Ce lien d'invitation n'est pas valide.",
};

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationInfo>(`/invitations/${token}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api<AcceptResult>(`/invitations/${token}/accept`, { method: 'POST', body: { password } }),
    onSuccess: () => router.replace('/moi'),
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Activation impossible — réessayez.'),
  });

  if (info.isLoading) {
    return (
      <EcranMarque titre="Activation du compte">
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </EcranMarque>
    );
  }

  if (!info.data?.valid) {
    return (
      <EcranMarque
        titre="Invitation indisponible"
        sousTitre={INVALID_MESSAGES[info.data?.reason ?? 'not_found']}
        pied={
          <Link href="/login" className="font-bold text-primary underline-offset-4 hover:underline">
            Aller à la connexion
          </Link>
        }
      >
        <div />
      </EcranMarque>
    );
  }

  const invite = info.data;
  const discordance = confirm.length > 0 && password !== confirm;

  return (
    <EcranMarque
      titre={`Bienvenue, ${invite.givenName}`}
      sousTitre={<>Rejoignez-nous en tant qu’{apixien(invite.gender)}.</>}
    >
      <form
        className="mt-6 flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          accept.mutate();
        }}
      >
        {/* L'identifiant se lit comme les autres champs, mais ne se saisit pas :
            il vient de l'invitation. `readOnly` plutôt que `disabled` — le
            champ reste sélectionnable, copiable et annoncé. */}
        <ChampMarque id="identifiant" label="Votre identifiant" icone="mail">
          <SaisieMarque
            id="identifiant"
            type="email"
            value={invite.email ?? ''}
            readOnly
            aria-readonly
            onFocus={(e) => e.currentTarget.select()}
            className="cursor-default text-ink-muted"
          />
        </ChampMarque>

        <div>
          <ChampMarque id="password" label="Choisissez un mot de passe" icone="lock">
            <SaisieMarque
              id="password"
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              placeholder="12 caractères minimum"
              className="pr-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <BoutonOeil visible={showPwd} onToggle={() => setShowPwd((v) => !v)} />
          </ChampMarque>
          {/* Les règles s'affichent, mais ne VERROUILLENT pas le bouton : ce
              champ porte aussi le mot de passe d'un compte déjà existant, qui
              n'a pas à satisfaire une règle adoptée depuis. C'est le serveur
              qui tranche, lui seul sachant si le compte est à créer. */}
          <ReglesMotDePasse password={password} email={invite.email ?? ''} />
        </div>

        <ChampMarque
          id="confirm"
          label="Confirmez le mot de passe"
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
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={discordance ? true : undefined}
            aria-describedby={discordance ? 'confirm-erreur' : undefined}
          />
          <BoutonOeil visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
        </ChampMarque>

        {serverError ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {serverError}
          </p>
        ) : null}

        <BoutonMarque
          enCours={accept.isPending}
          libelleEnCours="Activation…"
          disabled={password.length === 0 || confirm.length === 0 || discordance}
        >
          Activer mon compte
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
