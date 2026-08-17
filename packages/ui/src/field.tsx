import * as React from 'react';
import { Label } from './label';

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** Champ de formulaire : label + contrôle + erreur inline (ch. 05 : les erreurs disent quoi faire). */
export function Field({ label, htmlFor, error, required, children }: FieldProps) {
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
