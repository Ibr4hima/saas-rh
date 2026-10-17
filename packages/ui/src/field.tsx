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
  const messageId = htmlFor && (error || hint) ? `${htmlFor}-message` : undefined;
  // Le message sous le champ doit être ANNONCÉ par le lecteur d'écran, pas
  // seulement affiché : sans aria-describedby, « Facultatif — DCH… » et les
  // motifs d'erreur n'existent que pour les voyants. On relie donc le message
  // au contrôle, quand celui-ci est un élément unique qu'on peut enrichir.
  const described =
    messageId && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby':
            [
              (children as React.ReactElement<{ 'aria-describedby'?: string }>).props[
                'aria-describedby'
              ],
              messageId,
            ]
              .filter(Boolean)
              .join(' ') || undefined,
        })
      : children;
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      {described}
      {/* L'erreur prime sur l'indication : deux messages sous un champ se
          concurrencent, et c'est l'erreur qui demande une action. */}
      {error ? (
        <p id={messageId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
