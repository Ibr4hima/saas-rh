'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginInputSchema, type LoginInput, type SessionUser } from '@teranga/contracts';
import { Input } from '@teranga/ui';
import { BrandMark } from '../../components/brand-mark';
import { Icon } from '../../components/icons';
import { api, ApiError } from '../../lib/api';

/**
 * Écran de connexion — la première chose que voit un agent de l'APIX.
 *
 * Il reprend le dôme de marque de la plateforme de gestion des
 * investissements : le même bleu, la même carte posée dans la dissolution,
 * la même signature en bas. Deux produits de la même maison doivent
 * s'ouvrir de la même façon ; c'est ce qui dit à l'agent qu'il est au bon
 * endroit avant même d'avoir lu le titre.
 *
 * Les champs sont écrits ici plutôt que repris de `Field` : cet écran porte
 * la typographie de la marque (micro-libellés capitales, champs hauts à
 * icône) et non celle des formulaires de l'application. Le câblage
 * d'accessibilité que `Field` apporte est refait à la main, pas abandonné —
 * `htmlFor`, `aria-invalid`, `aria-describedby`, et le message d'erreur
 * annoncé.
 */
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
    <main className="login-dome flex min-h-dvh flex-col">
      <div aria-hidden className="login-decor" />
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10">
        {/* ── Marque ── */}
        <div className="login-monte flex flex-col items-center">
          {/* Le logo se pose en blanc pur : sur le bleu du dôme, ses encres
              d'origine — foncées — disparaîtraient. */}
          <BrandMark variant="connexion" />
          <h1 className="sr-only">Connexion à Capital Humain</h1>
          <div className="mt-4 flex items-center gap-3.5">
            <span className="hidden h-px w-11 bg-linear-to-r from-transparent to-white/40 sm:block" />
            <p className="text-center text-[10.5px] font-bold tracking-[0.16em] text-white/[0.78] uppercase">
              Système de Gestion des Ressources Humaines
            </p>
            <span className="hidden h-px w-11 bg-linear-to-r from-white/40 to-transparent sm:block" />
          </div>
        </div>

        {/* ── Carte ── */}
        <div
          className="login-monte relative mt-7 w-full max-w-[26rem]"
          style={{ '--retard': '0.08s' } as React.CSSProperties}
        >
          {/* Halo doux : il détache la carte du dôme sans lui poser d'ombre
              dure, qui trancherait sur un fond dégradé. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-8 left-1/2 h-64 w-[min(34rem,92vw)] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(255_255_255/0.13),transparent)]"
          />

          {/* Le rayon est celui des cartes de l'application : l'écran de
              connexion n'a pas de raison d'avoir sa propre rondeur. */}
          <div className="relative overflow-hidden rounded-[14px] border border-card-line bg-surface shadow-[0_30px_70px_rgb(0_0_0/0.28),0_4px_14px_rgb(0_0_0/0.10)]">
            <div className="px-7 pt-8 pb-6 sm:px-8">
              <p className="text-center text-2xl font-extrabold tracking-[-0.02em] text-ink-strong">
                Connexion
              </p>
              <p className="mt-1.5 text-center text-[13px] leading-relaxed text-ink-muted">
                Accédez à votre espace avec votre compte{' '}
                <span className="font-semibold text-ink">@apix.sn</span>
              </p>

              <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
                <Champ id="email" label="Adresse email" icone="mail" erreur={errors.email?.message}>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="Entrez votre adresse email"
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? 'email-erreur' : undefined}
                    className="h-11 rounded-lg border-[1.5px] bg-surface-raised pr-3 pl-10 text-[14px]"
                    {...form.register('email')}
                  />
                </Champ>

                <Champ
                  id="password"
                  label="Mot de passe"
                  icone="lock"
                  erreur={errors.password?.message}
                  indication={
                    majuscules ? 'Verrouillage majuscules activé sur votre clavier.' : undefined
                  }
                >
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={
                      [
                        errors.password ? 'password-erreur' : null,
                        majuscules ? 'password-caps' : null,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    className="h-11 rounded-lg border-[1.5px] bg-surface-raised pr-11 pl-10 text-[14px]"
                    {...form.register('password')}
                    // Le verrouillage majuscules est LA cause silencieuse
                    // d'échec sur un champ masqué : le mot de passe est juste,
                    // la casse ne l'est pas, et rien ne le dit.
                    onKeyUp={(e) => setMajuscules(e.getModifierState?.('CapsLock') ?? false)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    <Icon name={showPwd ? 'visibility_off' : 'visibility'} size={17} />
                  </button>
                </Champ>

                {serverError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-center text-[12.5px] font-medium text-danger"
                  >
                    {serverError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group mt-0.5 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-bold text-primary-ink shadow-[0_4px_18px_rgb(0_79_145/0.35)] transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_10px_28px_rgb(0_79_145/0.42)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0 disabled:pointer-events-none disabled:opacity-65"
                >
                  {isSubmitting ? (
                    <>
                      <span
                        aria-hidden
                        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                      />
                      Connexion…
                    </>
                  ) : (
                    <>
                      Se connecter
                      <Icon
                        name="arrow_forward"
                        size={16}
                        className="transition-transform duration-150 group-hover:translate-x-1"
                      />
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="border-t border-line-soft bg-surface-raised px-7 py-3.5 text-center text-[13px] text-ink-muted sm:px-8">
              Pas encore de compte ?{' '}
              <Link
                href="/register"
                className="font-bold text-primary underline-offset-4 hover:underline"
              >
                Créer une organisation
              </Link>
            </div>
          </div>
        </div>

        {/* ── Mention d'accès ── */}
        <p
          className="login-monte mt-5 flex max-w-[26rem] items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted"
          style={{ '--retard': '0.2s' } as React.CSSProperties}
        >
          <Icon name="lock" size={13} className="mt-px shrink-0" />
          Accès réservé aux agents de l&apos;APIX disposant d&apos;un compte professionnel
        </p>
      </div>

      {/* ── Pied de page ── */}
      <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-6 py-4 text-[11.5px] text-ink-muted sm:px-10">
        <span>© {new Date().getFullYear()} APIX S.A — DCH. Tous droits réservés.</span>
        <span>Plateforme à usage interne</span>
      </footer>
    </main>
  );
}

/**
 * Un champ de l'écran de connexion : micro-libellé en capitales, icône de
 * tête qui prend la couleur de marque au focus, message sous le champ.
 */
function Champ({
  id,
  label,
  icone,
  erreur,
  indication,
  children,
}: {
  id: string;
  label: string;
  icone: 'mail' | 'lock';
  erreur?: string;
  indication?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[10.5px] font-extrabold tracking-[0.1em] text-primary uppercase"
      >
        {label}
      </label>
      <div className="group relative">
        <Icon
          name={icone}
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted transition-colors duration-150 group-focus-within:text-primary"
        />
        {children}
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} className="mt-1.5 text-xs text-danger">
          {erreur}
        </p>
      ) : indication ? (
        <p id={`${id}-caps`} className="mt-1.5 text-xs text-warning">
          {indication}
        </p>
      ) : null}
    </div>
  );
}
