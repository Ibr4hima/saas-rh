'use client';

/**
 * Le contrat clavier d'une surface modale, en un seul endroit.
 *
 * Trois manques, invisibles à la souris et rédhibitoires au clavier :
 *  — Tab sortait de la fenêtre et continuait dans la page recouverte ;
 *  — à l'ouverture le focus restait sur le bouton déclencheur, sous le voile ;
 *  — à la fermeture il était perdu, et l'on repartait du haut de la page.
 *
 * Le hook pose les trois, plus le gel du défilement de l'arrière-plan.
 * À étaler sur le PANNEAU de la fenêtre, jamais sur le voile.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Verrous de défilement EN COURS, et l'état du document avant le premier.
 * Le compteur est volontairement global au module : deux fenêtres superposées
 * posent chacune le sien, et c'est la fermeture de la DERNIÈRE qui rend le
 * défilement — sinon la première refermée le rendrait alors qu'une fenêtre est
 * encore à l'écran.
 */
let locks = 0;
let before = { body: '', root: '', paddingRight: '', pane: '' };

/**
 * Le panneau qui défile réellement. Depuis que l'application est une coquille
 * à hauteur d'écran, ce n'est plus le document : geler <body> ne suffit pas,
 * la molette continuerait de faire défiler le contenu DERRIÈRE la fenêtre. Le
 * layout marque ce panneau, à charge pour nous de le figer avec le reste.
 */
function scrollPane(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-scroll-root]');
}

export function useDialogue(active: boolean, label?: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const root = document.documentElement;
    const pane = scrollPane();
    if (locks === 0) {
      // La largeur de l'ascenseur est reportée en marge : le masquer sans
      // compenser élargit la page d'une quinzaine de pixels, et TOUT son
      // contenu sursaute au moment précis où la fenêtre s'ouvre.
      const scrollbar = window.innerWidth - root.clientWidth;
      before = {
        body: body.style.overflow,
        root: root.style.overflow,
        paddingRight: body.style.paddingRight,
        pane: pane?.style.overflow ?? '',
      };
      // Les DEUX : selon la page, l'ascenseur appartient à <body> ou à <html>.
      body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
      if (pane) pane.style.overflow = 'hidden';
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    }
    locks++;
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) {
        // On restitue les valeurs D'AVANT, sans les supposer vides.
        body.style.overflow = before.body;
        root.style.overflow = before.root;
        body.style.paddingRight = before.paddingRight;
        if (pane) pane.style.overflow = before.pane;
      }
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const trigger = document.activeElement as HTMLElement | null;

    // Le panneau prend le focus (tabIndex −1) : le premier Tab part du début
    // de la fenêtre, et un lecteur d'écran annonce le dialogue.
    el.focus({ preventScroll: true });

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // offsetParent écarte les éléments masqués — sauf celui qui a le focus,
      // un élément en position fixe n'ayant pas d'offsetParent.
      const focusable = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (f) => f.offsetParent !== null || f === document.activeElement,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (!el.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (current === first || current === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // En capture : la fenêtre pose ses propres gestionnaires, le piège doit
    // passer avant eux.
    document.addEventListener('keydown', trap, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      // Restitution — seulement si le déclencheur est encore dans la page.
      if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    };
  }, [active]);

  return {
    ref,
    role: 'dialog' as const,
    'aria-modal': true as const,
    tabIndex: -1,
    ...(label ? { 'aria-label': label } : {}),
  };
}
