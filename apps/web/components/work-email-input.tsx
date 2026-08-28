'use client';

import * as React from 'react';

/**
 * Domaine des adresses professionnelles.
 *
 * En dur pour l'instant : l'employeur est unique et son domaine ne change pas.
 * Le jour où le produit sert un second organisme, cette constante devient un
 * paramètre du tenant — d'où le fait qu'elle vive à UN seul endroit plutôt que
 * dans le libellé de chaque champ.
 */
export const WORK_EMAIL_DOMAIN = 'apix.sn';

/** Recompose l'adresse complète, ou rien si la partie locale est vide. */
export function composeWorkEmail(local: string): string | undefined {
  const clean = local.trim();
  return clean ? `${clean}@${WORK_EMAIL_DOMAIN}` : undefined;
}

/**
 * Partie locale d'une adresse enregistrée, pour pré-remplir le champ.
 * Une adresse d'un autre domaine (import ancien) n'est PAS réécrite pour
 * autant : le formulaire n'envoie que les champs modifiés, si bien qu'une
 * adresse qu'on ne touche pas reste telle quelle en base.
 */
export function localWorkEmail(email: string | null | undefined): string {
  return (email ?? '').split('@')[0] ?? '';
}

/**
 * Champ d'adresse professionnelle : on ne saisit que ce qui varie.
 *
 * Le domaine est affiché DANS le champ, à droite, en gris — il fait partie de
 * l'adresse, pas d'une explication à côté. L'utilisateur voit donc l'adresse
 * complète se former à mesure qu'il tape, sans pouvoir se tromper de domaine
 * ni le saisir deux fois.
 */
export function WorkEmailInput({
  id,
  value,
  onChange,
  placeholder = 'prenom.nom',
}: {
  id?: string;
  value: string;
  onChange: (local: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex h-10 w-full items-center rounded-md border border-line bg-surface transition-colors duration-150 ease-out focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary/40">
      <input
        id={id}
        type="text"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none"
        placeholder={placeholder}
        value={value}
        // Coller « f.sall@apix.sn » ne doit pas produire « f.sall@apix.sn@apix.sn » :
        // tout ce qui suit un @ appartient au domaine, que le champ porte déjà.
        onChange={(e) => onChange(e.target.value.split('@')[0] ?? '')}
      />
      <span
        aria-hidden
        className="shrink-0 border-l border-line-soft px-3 text-sm text-ink-muted select-none"
      >
        @{WORK_EMAIL_DOMAIN}
      </span>
    </div>
  );
}
