import * as React from 'react';
import { Label } from './label';

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  /** Précision sous le champ : ce que la saisie implique, pas une répétition du label. */
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** Champ de formulaire : label + contrôle + erreur inline (ch. 05 : les erreurs disent quoi faire). */
export function Field({ label, htmlFor, error, hint, required, children }: FieldProps) {
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {children}
      {/* L'erreur prime sur l'indication : deux messages sous un champ se
          concurrencent, et c'est l'erreur qui demande une action. */}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
