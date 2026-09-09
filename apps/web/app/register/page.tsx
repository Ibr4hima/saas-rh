'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { registerInputSchema, type RegisterInput, type SessionUser } from '@teranga/contracts';
import { BoutonMarque } from '../../components/bouton-marque';
import {
  BoutonOeil,
  ChampMarque,
  EcranMarque,
  ReglesMotDePasse,
  SaisieMarque,
} from '../../components/ecran-marque';
import { api, ApiError } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirm, setConfirm] = useState('');
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerInputSchema) });
  const { errors, isSubmitting } = form.formState;

  // Suivis en direct pour cocher les règles à la frappe.
  const password = form.watch('password') ?? '';
  const email = form.watch('email') ?? '';
  // La confirmation ne vit pas dans le schéma : c'est une garde de saisie, pas
  // une donnée que l'API reçoit.
  const discordance = confirm.length > 0 && password !== confirm;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api<{ user: SessionUser }>('/auth/register', { method: 'POST', body: values });
      router.replace('/');
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Inscription impossible — réessayez.');
    }
  });

  return (
    <EcranMarque
      titre="Créer un compte"
      sousTitre={
        <>
          Réservé aux agents disposant d&apos;une adresse{' '}
          <span className="font-semibold text-ink">@apix.sn</span>
        </>
      }
      pied={
        <>
          Déjà un compte ?{' '}
          <Link href="/login" className="font-bold text-primary underline-offset-4 hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <ChampMarque
          id="organizationName"
          label="Organisation"
          icone="folder_managed"
          erreur={errors.organizationName?.message}
        >
          <SaisieMarque
            id="organizationName"
            autoFocus
            placeholder="Ex : APIX"
            aria-invalid={errors.organizationName ? true : undefined}
            aria-describedby={errors.organizationName ? 'organizationName-erreur' : undefined}
            {...form.register('organizationName')}
          />
        </ChampMarque>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ChampMarque
            id="givenName"
            label="Prénom"
            icone="badge"
            erreur={errors.givenName?.message}
          >
            <SaisieMarque
              id="givenName"
              autoComplete="given-name"
              placeholder="Prénom"
              aria-invalid={errors.givenName ? true : undefined}
              aria-describedby={errors.givenName ? 'givenName-erreur' : undefined}
              {...form.register('givenName')}
            />
          </ChampMarque>
          <ChampMarque
            id="familyName"
            label="Nom"
            icone="badge"
            erreur={errors.familyName?.message}
          >
            <SaisieMarque
              id="familyName"
              autoComplete="family-name"
              placeholder="Nom"
              aria-invalid={errors.familyName ? true : undefined}
              aria-describedby={errors.familyName ? 'familyName-erreur' : undefined}
              {...form.register('familyName')}
            />
          </ChampMarque>
        </div>

        <ChampMarque id="email" label="Adresse email" icone="mail" erreur={errors.email?.message}>
          <SaisieMarque
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Entrez votre adresse email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-erreur' : undefined}
            {...form.register('email')}
          />
        </ChampMarque>

        <div>
          <ChampMarque
            id="password"
            label="Mot de passe"
            icone="lock"
            erreur={errors.password?.message}
          >
            <SaisieMarque
              id="password"
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="12 caractères minimum"
              className="pr-11"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-erreur' : undefined}
              {...form.register('password')}
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
          enCours={isSubmitting}
          libelleEnCours="Création…"
          disabled={confirm.length === 0 || discordance}
        >
          Créer mon compte
        </BoutonMarque>
      </form>
    </EcranMarque>
  );
}
