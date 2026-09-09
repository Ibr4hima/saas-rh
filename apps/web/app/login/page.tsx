'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginInputSchema, type LoginInput, type SessionUser } from '@teranga/contracts';
import { BoutonOeil, ChampMarque, EcranMarque, SaisieMarque } from '../../components/ecran-marque';
import { BoutonMarque } from '../../components/bouton-marque';
import { api, ApiError } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [majuscules, setMajuscules] = useState(false);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: values });
      router.replace('/');
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Connexion impossible — réessayez.');
    }
  });

  return (
    <EcranMarque
      titre="Connexion"
      sousTitre={
        <>
          Accédez à votre espace avec votre compte{' '}
          <span className="font-semibold text-ink">@apix.sn</span>
        </>
      }
      pied={
        <>
          Pas encore de compte ?{' '}
          <Link
            href="/register"
            className="font-bold text-primary underline-offset-4 hover:underline"
          >
            Créer une organisation
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <ChampMarque id="email" label="Adresse email" icone="mail" erreur={errors.email?.message}>
          <SaisieMarque
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="Entrez votre adresse email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-erreur' : undefined}
            {...form.register('email')}
          />
        </ChampMarque>

        <ChampMarque
          id="password"
          label="Mot de passe"
          icone="lock"
          erreur={errors.password?.message}
          ton="alerte"
          indication={majuscules ? 'Verrouillage majuscules activé sur votre clavier.' : undefined}
        >
          <SaisieMarque
            id="password"
            type={showPwd ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            className="pr-11"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              [
                errors.password ? 'password-erreur' : null,
                majuscules ? 'password-indication' : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            {...form.register('password')}
            // Le verrouillage majuscules est LA cause silencieuse d'échec sur
            // un champ masqué : le mot de passe est juste, la casse ne l'est pas.
            onKeyUp={(e) => setMajuscules(e.getModifierState?.('CapsLock') ?? false)}
          />
          <BoutonOeil visible={showPwd} onToggle={() => setShowPwd((v) => !v)} />
        </ChampMarque>

        {serverError ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
          >
            {serverError}
          </p>
        ) : null}

        <BoutonMarque enCours={isSubmitting} libelleEnCours="Connexion…">
          Se connecter
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
