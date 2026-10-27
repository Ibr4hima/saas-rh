'use client';

import Link from 'next/link';
import * as React from 'react';

const ACTION =
  'inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-controle border border-transparent bg-primary px-5 text-[14.5px] font-semibold tracking-[0.01em] text-primary-ink shadow-bouton transition-[background-color,box-shadow] duration-150 ease-out hover:bg-primary-hover active:shadow-bouton-enfonce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * L'action unique de ces écrans, comme dans e-Voting : pleine largeur, un
 * rectangle aux coins à peine adoucis, le mot seul.
 */
export function BoutonMarque({
  enCours,
  libelleEnCours,
  disabled,
  children,
}: {
  enCours: boolean;
  libelleEnCours: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={enCours || disabled}
      className={`${ACTION} mt-0.5 disabled:pointer-events-none disabled:opacity-65`}
    >
      {enCours ? (
        <>
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {libelleEnCours}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Le même bouton quand l'action mène ailleurs : vers la connexion, une fois le geste fait. */
export function LienMarque({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={ACTION}>
      {children}
    </Link>
  );
}
