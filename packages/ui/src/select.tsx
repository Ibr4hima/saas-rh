'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

/**
 * Liste de choix.
 *
 * POURQUOI CE N'EST PAS UN SIMPLE `<select>`. La boîte d'un `<select>` se
 * style ; la LISTE qui s'en déroule, non — elle est dessinée par le système
 * d'exploitation, avec ses propres marges, sa propre police et ses propres
 * couleurs. Sur un écran qu'on a réglé au pixel, elle arrive comme une pièce
 * rapportée. On dessine donc la liste nous-mêmes.
 *
 * MAIS LE `<select>` RESTE LÀ, caché sous le bouton. Il tient la valeur, il
 * porte le `name`, et c'est LUI que `react-hook-form` enregistre — la moitié
 * des listes de l'application arrivent par `{...form.register(…)}`, qui pose
 * une référence sur l'élément natif et lit sa valeur directement dans le DOM.
 * Le remplacer par un composant à état aurait cassé chaque formulaire de la
 * fiche employé. Choisir une option écrit donc dans le `<select>` par le
 * mutateur natif, puis émet un vrai événement `change` : les gestionnaires
 * existants reçoivent l'événement qu'ils attendaient, au bon endroit.
 *
 * L'inverse est vrai aussi : quand `reset()` change la valeur par la
 * référence, aucun événement n'est émis. On relit donc la valeur du `<select>`
 * après chaque rendu — c'est la seule façon de rester d'accord avec lui.
 *
 * Le clavier suit le motif « combobox » : le focus ne quitte JAMAIS le bouton,
 * et `aria-activedescendant` désigne l'option courante. La liste part dans un
 * portail, sinon le moindre parent en `overflow: hidden` — une carte, un corps
 * de fenêtre qui défile — la couperait en deux.
 */

interface Choix {
  valeur: string;
  /** Ce que montre la LISTE. */
  libelle: string;
  /** Ce que montre le bouton une fois refermé — l'attribut `label` de
      l'`<option>` quand il est posé, le libellé sinon. */
  court: string;
  desactive: boolean;
}

/** Le texte d'un nœud, quel que soit son emballage : « {c.name} (+{c.dial}) ». */
function texte(n: React.ReactNode): string {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(texte).join('');
  if (React.isValidElement(n)) return texte((n.props as { children?: React.ReactNode }).children);
  return '';
}

/** Les `<option>` passées en enfants, mises à plat. */
function lireChoix(children: React.ReactNode): Choix[] {
  const out: Choix[] = [];
  React.Children.forEach(children, (enfant) => {
    if (!React.isValidElement(enfant) || enfant.type !== 'option') return;
    const p = enfant.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
      children?: React.ReactNode;
    };
    const libelle = texte(p.children);
    out.push({
      valeur: p.value === undefined ? libelle : String(p.value),
      libelle,
      // `<option label="SEN">SEN · +221</option>` : l'attribut existe en HTML
      // pour cela, et le `<select>` caché s'en sert de la même façon.
      court: p.label ?? libelle,
      desactive: Boolean(p.disabled),
    });
  });
  return out;
}

/** Écrit dans le `<select>` natif comme l'aurait fait un clic, événement compris. */
function poserLaValeur(el: HTMLSelectElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(el, v);
  else el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Deux références sur un même élément.
 *
 * Indispensable, et pas décoratif : `{...form.register('gender')}` apporte SA
 * référence dans les propriétés étalées. La nôtre l'écrasait — react-hook-form
 * n'avait plus de prise sur le `<select>`, ne pouvait plus y écrire lors d'un
 * `reset()` ni en relire la valeur à l'enregistrement, et le formulaire partait
 * avec un champ marqué modifié dont la valeur était `undefined`.
 */
function fusionnerRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (el: T | null) => {
    for (const r of refs) {
      if (typeof r === 'function') r(el);
      else if (r) (r as React.RefObject<T | null>).current = el;
    }
  };
}

interface Position {
  left: number;
  width: number;
  maxWidth: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export function Select({
  className,
  children,
  disabled,
  id,
  ref: refExterne,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedby,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { ref?: React.Ref<HTMLSelectElement> }) {
  const choix = React.useMemo(() => lireChoix(children), [children]);
  const natif = React.useRef<HTMLSelectElement>(null);
  const declencheur = React.useRef<HTMLButtonElement>(null);
  const liste = React.useRef<HTMLDivElement>(null);
  const frappe = React.useRef({ texte: '', quand: 0 });
  const reactId = React.useId();
  const listeId = `${id ?? reactId}-liste`;

  const [ouvert, setOuvert] = React.useState(false);
  const [actif, setActif] = React.useState(0);
  const [valeur, setValeur] = React.useState('');
  const [position, setPosition] = React.useState<Position | null>(null);

  // Rester d'accord avec le `<select>` : lui seul détient la vérité, qu'elle
  // vienne d'un rendu contrôlé ou d'un `reset()` posé par la référence.
  React.useLayoutEffect(() => {
    const v = natif.current?.value ?? '';
    setValeur((ancienne) => (ancienne === v ? ancienne : v));
  });

  const indexCourant = Math.max(
    0,
    choix.findIndex((c) => c.valeur === valeur),
  );
  const libelleCourant = choix[indexCourant]?.court ?? '';

  const placer = React.useCallback(() => {
    const b = declencheur.current?.getBoundingClientRect();
    if (!b) return;
    const marge = 6;
    const dessous = window.innerHeight - b.bottom - marge - 8;
    const dessus = b.top - marge - 8;
    // Vers le haut seulement si le dessous ne suffit pas ET que le dessus fait
    // mieux : une liste qui saute au-dessus sans raison surprend.
    const versLeHaut = dessous < 180 && dessus > dessous;
    setPosition({
      left: b.left,
      width: b.width,
      // La liste part de la largeur du bouton et grandit avec son contenu :
      // un sélecteur étroit — l'indicatif d'un téléphone, large de trois
      // lettres — ne doit pas couper « SEN · +221 » dans sa propre liste.
      // Bridée à ce qui reste jusqu'au bord de l'écran.
      maxWidth: Math.max(b.width, window.innerWidth - b.left - 8),
      ...(versLeHaut ? { bottom: window.innerHeight - b.top + marge } : { top: b.bottom + marge }),
      maxHeight: Math.max(120, Math.min(300, versLeHaut ? dessus : dessous)),
    });
  }, []);

  const ouvrir = React.useCallback(() => {
    if (disabled || choix.length === 0) return;
    setActif(indexCourant);
    placer();
    setOuvert(true);
  }, [disabled, choix.length, indexCourant, placer]);

  const fermer = React.useCallback(() => {
    setOuvert(false);
    declencheur.current?.focus();
  }, []);

  const choisir = React.useCallback(
    (i: number) => {
      const c = choix[i];
      if (!c || c.desactive || !natif.current) return;
      poserLaValeur(natif.current, c.valeur);
      fermer();
    },
    [choix, fermer],
  );

  // La liste suit son bouton tant qu'elle est ouverte : le panneau qui la
  // porte peut défiler sous elle (une fenêtre de saisie, la page entière).
  React.useLayoutEffect(() => {
    if (!ouvert) return;
    const suivre = () => placer();
    window.addEventListener('scroll', suivre, true);
    window.addEventListener('resize', suivre);
    return () => {
      window.removeEventListener('scroll', suivre, true);
      window.removeEventListener('resize', suivre);
    };
  }, [ouvert, placer]);

  React.useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (liste.current?.contains(cible) || declencheur.current?.contains(cible)) return;
      setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  // L'option courante reste visible quand on descend au clavier.
  React.useEffect(() => {
    if (!ouvert) return;
    liste.current?.querySelector<HTMLElement>(`[data-rang="${actif}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [actif, ouvert]);

  /** Saisie au vol : taper « sén » sélectionne « Sénégalaise ». */
  const chercher = (lettre: string) => {
    const maintenant = Date.now();
    const f = frappe.current;
    f.texte = maintenant - f.quand > 800 ? lettre : f.texte + lettre;
    f.quand = maintenant;
    const cible = f.texte.toLocaleLowerCase('fr');
    const i = choix.findIndex(
      (c) => !c.desactive && c.libelle.toLocaleLowerCase('fr').startsWith(cible),
    );
    if (i < 0) return;
    if (ouvert) setActif(i);
    else choisir(i);
  };

  const auClavier = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      if (!ouvert) return;
      e.preventDefault();
      // Une liste ouverte par-dessus une fenêtre de saisie : Échap ne ferme
      // que la couche du dessus. Les fenêtres écoutent le document au même
      // niveau que React — seul l'arrêt IMMÉDIAT les en empêche.
      e.nativeEvent.stopImmediatePropagation();
      fermer();
      return;
    }
    if (e.key === 'Tab') {
      setOuvert(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!ouvert) return ouvrir();
      const pas = e.key === 'ArrowDown' ? 1 : -1;
      setActif((i) => {
        let j = i;
        for (let n = 0; n < choix.length; n += 1) {
          j = (j + pas + choix.length) % choix.length;
          if (!choix[j]?.desactive) return j;
        }
        return i;
      });
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!ouvert) return;
      e.preventDefault();
      setActif(e.key === 'Home' ? 0 : choix.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (ouvert) choisir(actif);
      else ouvrir();
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      chercher(e.key);
    }
  };

  return (
    <div className="relative">
      {/* Le `<select>` réel : invisible, hors du parcours de tabulation, mais
          présent dans le formulaire. Le focus qu'on lui donnerait — celui que
          react-hook-form pose sur le premier champ en erreur — est renvoyé au
          bouton, qui est la commande visible. */}
      <select
        {...props}
        id={id}
        ref={fusionnerRefs(natif, refExterne)}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onFocus={() => declencheur.current?.focus()}
      >
        {children}
      </select>

      <button
        type="button"
        ref={declencheur}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? listeId : undefined}
        aria-activedescendant={ouvert ? `${listeId}-${actif}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        onClick={() => (ouvert ? setOuvert(false) : ouvrir())}
        onKeyDown={auClavier}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-full border border-line bg-surface px-4 text-left text-sm text-ink',
          'transition-colors duration-150 ease-out',
          'hover:border-primary/40 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          ouvert && 'border-primary',
          className,
        )}
      >
        {/* Le gris est pour l'ABSENCE de choix — le tiret d'une liste
            facultative —, pas pour une valeur vide : « Toutes » d'un filtre
            vaut la chaîne vide et reste un choix à part entière. */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            (libelleCourant === '' || libelleCourant === '—') && 'text-ink-muted',
          )}
        >
          {libelleCourant || '—'}
        </span>
        <Chevron ouvert={ouvert} />
      </button>

      {ouvert && position
        ? createPortal(
            <div
              ref={liste}
              id={listeId}
              role="listbox"
              aria-label={ariaLabel}
              className="tg-menu fixed z-[70] overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-surface p-1.5 shadow-lg"
              style={{
                left: position.left,
                minWidth: position.width,
                width: 'max-content',
                maxWidth: position.maxWidth,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }}
            >
              {choix.map((c, i) => {
                const choisi = c.valeur === valeur;
                return (
                  <div
                    key={`${c.valeur}-${i}`}
                    id={`${listeId}-${i}`}
                    data-rang={i}
                    role="option"
                    aria-selected={choisi}
                    aria-disabled={c.desactive || undefined}
                    onMouseEnter={() => !c.desactive && setActif(i)}
                    // Le focus ne doit pas quitter le bouton : sans cela, le
                    // simple fait d'appuyer ferait perdre `aria-activedescendant`.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choisir(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-[11px] px-3 py-[7px] text-[13px] leading-snug',
                      c.desactive && 'cursor-not-allowed text-ink-muted/50',
                      !c.desactive && i === actif && 'bg-hover',
                      !c.desactive && choisi ? 'font-semibold text-primary' : 'text-ink',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.libelle || '—'}</span>
                    {choisi ? <Coche /> : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Chevron({ ouvert }: { ouvert: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn(
        'size-4 shrink-0 text-ink-muted transition-transform duration-200',
        ouvert && '-rotate-180',
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5 8 10.5 12 6.5" />
    </svg>
  );
}

function Coche() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
