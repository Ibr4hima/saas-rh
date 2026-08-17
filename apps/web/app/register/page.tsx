'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { registerInputSchema, type RegisterInput, type SessionUser } from '@teranga/contracts';
import { Button, Card, CardContent, Field, Input } from '@teranga/ui';
import { api, ApiError } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerInputSchema) });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api<{ user: SessionUser }>('/auth/register', { method: 'POST', body: values });
      router.replace('/employees');
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Inscription impossible — réessayez.');
    }
  });

  const errors = form.formState.errors;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-bold text-ink-strong">Créer votre organisation</h1>
      <p className="mb-6 text-sm text-ink-muted">Vous serez l&apos;administrateur de cet espace.</p>
      <Card>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              label="Nom de l'organisation"
              htmlFor="organizationName"
              error={errors.organizationName?.message}
              required
            >
              <Input id="organizationName" {...form.register('organizationName')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom" htmlFor="givenName" error={errors.givenName?.message} required>
                <Input id="givenName" autoComplete="given-name" {...form.register('givenName')} />
              </Field>
              <Field label="Nom" htmlFor="familyName" error={errors.familyName?.message} required>
                <Input
                  id="familyName"
                  autoComplete="family-name"
                  {...form.register('familyName')}
                />
              </Field>
            </div>
            <Field label="Email" htmlFor="email" error={errors.email?.message} required>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>
            <Field
              label="Mot de passe"
              htmlFor="password"
              error={errors.password?.message}
              required
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
            </Field>
            {serverError ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" loading={form.formState.isSubmitting}>
              Créer l&apos;organisation
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-ink-muted">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Se connecter
        </Link>
      </p>
    </main>
  );
}
