import * as React from 'react';
import { cn } from './cn';

/**
 * Case à cocher — dessinée, pas native.
 *
 * La case du système ignore la charte : sa taille, son bleu et son rayon
 * viennent de l'OS, et une colonne de sélection cochée en bleu Windows au
 * milieu d'un tableau APIX se voit immédiatement. On garde donc l'`input`
 * natif — c'est lui qui porte le clavier, le focus et l'état indéterminé —
 * mais on le rend transparent et on peint par-dessus.
 *
 * Les trois calques peints sont FRÈRES de l'input, jamais ses neveux : les
 * variantes `peer-*` ne visent que les frères suivants.
 *
 * `indeterminate` n'est pas un attribut HTML mais une propriété du DOM ; elle
 * est posée par une ref.
 */
export function Checkbox({
  className,
  indeterminate = false,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className={cn('relative inline-block size-[15px] shrink-0 align-middle', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      {/* Le cadre */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 rounded-[4px] border border-line bg-surface transition-colors duration-150',
          'peer-hover:border-primary/50',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-indeterminate:border-primary peer-indeterminate:bg-primary',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          'peer-disabled:opacity-40',
        )}
      />
      {/* La coche — toutes les lignes */}
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        fill="none"
        className="pointer-events-none absolute inset-0 m-auto size-3 text-primary-ink opacity-0 peer-checked:opacity-100"
      >
        <path
          d="M2.5 6.2 4.8 8.5 9.5 3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Le trait — une partie des lignes seulement */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[1.8px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-ink opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );
}
