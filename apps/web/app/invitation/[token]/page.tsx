'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AcceptResult, InvitationInfo } from '@teranga/contracts';
import { Button, Card, CardContent, Field, Input, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';

const ROLE_LABELS: Record<string, string> = {
  hr: 'RH',
  payroll: 'Gestionnaire de paie',
  manager: 'Manager',
  employee: 'Employé·e',
};

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

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      {info.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !info.data?.valid ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="mb-2 text-sm font-semibold text-ink-strong">Invitation indisponible</p>
            <p className="text-sm text-ink-muted">
              {INVALID_MESSAGES[info.data?.reason ?? 'not_found']}
            </p>
            <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
              Aller à la connexion
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-ink">
              T
            </div>
            <h1 className="text-xl font-bold text-ink-strong">
              Bienvenue, {info.data.givenName} 👋
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Vous êtes invité·e à rejoindre <strong>{info.data.organizationName}</strong> en tant
              que {ROLE_LABELS[info.data.role ?? ''] ?? info.data.role}.
            </p>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="text-xs text-ink-muted">Votre identifiant</p>
                <p className="text-sm font-medium text-ink-strong">{info.data.email}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Si un compte Teranga RH existe déjà avec cet email, saisissez son mot de passe
                  actuel pour le relier.
                </p>
              </div>
              <Field label="Choisissez un mot de passe" htmlFor="password" required>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1 text-xs text-ink-muted">12 caractères minimum.</p>
              </Field>
              <Field
                label="Confirmez le mot de passe"
                htmlFor="confirm"
                error={mismatch ? 'Les deux mots de passe ne correspondent pas' : undefined}
                required
              >
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {serverError ? (
                <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                  {serverError}
                </p>
              ) : null}
              <Button
                onClick={() => {
                  setServerError(null);
                  accept.mutate();
                }}
                disabled={password.length < 12 || password !== confirm}
                loading={accept.isPending}
              >
                Activer mon compte
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
