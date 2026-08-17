'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginInputSchema, type LoginInput, type SessionUser } from '@teranga/contracts';
import { Button, Card, CardContent, Field, Input } from '@teranga/ui';
import { api, ApiError } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema) });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: values });
      router.replace('/employees');
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Connexion impossible — réessayez.');
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-bold text-ink-strong">Teranga RH</h1>
      <p className="mb-6 text-sm text-ink-muted">Connectez-vous à votre espace.</p>
      <Card>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              label="Email"
              htmlFor="email"
              error={form.formState.errors.email?.message}
              required
            >
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>
            <Field
              label="Mot de passe"
              htmlFor="password"
              error={form.formState.errors.password?.message}
              required
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
              />
            </Field>
            {serverError ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" loading={form.formState.isSubmitting}>
              Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-ink-muted">
        Pas encore de compte ?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Créer une organisation
        </Link>
      </p>
    </main>
  );
}
