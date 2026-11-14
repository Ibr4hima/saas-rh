'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

/**
 * Champ de date.
 *
 * POURQUOI PAS `<input type="date">` TEL QUEL. Le navigateur y dessine ses
 * propres segments (« mm/dd/yyyy » sur une machine réglée en anglais), sa
 * propre icône et un calendrier du système, à ses couleurs et dans sa
 * langue : la seule pièce de la page qui ne ressemble pas à l'application.
 * Le champ se tape donc ici en jj/mm/aaaa, les barres posées à la frappe, et
 * l'icône ouvre notre calendrier.
 *
 * L'`<input type="date">` reste là, caché, comme le `<select>` sous nos
 * listes : il tient la valeur en AAAA-MM-JJ, porte le `name` et la référence
 * de `react-hook-form`. Une date complète s'y écrit par le mutateur natif,
 * suivie d'un vrai événement : les `onChange` existants reçoivent ce qu'ils
 * recevaient, `e.target.value` compris. Une date incomplète ou impossible
 * (31/02) y laisse une valeur vide : le formulaire ne la croit pas saisie.
 */

type Jour = { a: number; m: number; j: number };
type Vue = 'jours' | 'mois' | 'annees';

const deux = (n: number) => String(n).padStart(2, '0');
const joursDuMois = (a: number, m: number) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
const existe = (a: number, m: number, j: number) =>
  a >= 1000 && a <= 9999 && m >= 0 && m < 12 && j >= 1 && j <= joursDuMois(a, m);
const versIso = ({ a, m, j }: Jour) => `${a}-${deux(m + 1)}-${deux(j)}`;
const memeJour = (x: Jour | null, y: Jour | null) =>
  x !== null && y !== null && x.a === y.a && x.m === y.m && x.j === y.j;
/** Pour comparer deux jours : 20240312. */
const rang = ({ a, m, j }: Jour) => a * 10000 + m * 100 + j;

function lireIso(iso: string | undefined): Jour | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!r) return null;
  const a = Number(r[1]);
  const m = Number(r[2]) - 1;
  const j = Number(r[3]);
  return existe(a, m, j) ? { a, m, j } : null;
}

const enTexte = (d: Jour | null) => (d ? `${deux(d.j)}/${deux(d.m + 1)}/${d.a}` : '');

function aujourdhui(): Jour {
  const n = new Date();
  return { a: n.getFullYear(), m: n.getMonth(), j: n.getDate() };
}

/** Le lendemain, la veille, la semaine suivante : `jours` peut être négatif. */
function decaler({ a, m, j }: Jour, jours: number): Jour {
  const d = new Date(Date.UTC(a, m, j + jours));
  return { a: d.getUTCFullYear(), m: d.getUTCMonth(), j: d.getUTCDate() };
}

/** Le même jour un mois plus tard, ou plus tôt ; le 31 devient le dernier du mois. */
function decalerDeMois({ a, m, j }: Jour, mois: number): Jour {
  const total = a * 12 + m + mois;
  const na = Math.floor(total / 12);
  const nm = total - na * 12;
  return { a: na, m: nm, j: Math.min(j, joursDuMois(na, nm)) };
}

/**
 * Ce qui se tape, mis en forme : « 12032024 » donne « 12/03/2024 », chaque
 * barre posée quand le morceau suivant commence, pour qu'un retour arrière ne
 * bute pas sur elle. Une barre, un point ou un tiret tapés ferment le
 * morceau : « 1/3/2024 » se lit aussi. Une date collée en AAAA-MM-JJ
 * s'écrit à la française.
 */
export function mettreEnForme(brut: string): string {
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(brut);
  if (iso) return `${deux(Number(iso[3]))}/${deux(Number(iso[2]))}/${iso[1]}`;
  const morceaux = ['', '', ''];
  let k = 0;
  for (const c of brut) {
    if (/\d/.test(c)) {
      const plein = morceaux[k]!.length === (k === 2 ? 4 : 2);
      if (plein) {
        if (k === 2) break;
        k += 1;
      }
      morceaux[k] += c;
    } else if (morceaux[k] !== '' && k < 2) {
      k += 1;
    }
  }
  return morceaux[0] + (k >= 1 ? `/${morceaux[1]}` : '') + (k >= 2 ? `/${morceaux[2]}` : '');
}

/** La date d'un texte complet, « 1/3/2024 » ou « 01/03/2024 » ; null sinon. */
export function lireTexte(texte: string): Jour | null {
  const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte);
  if (!r) return null;
  const j = Number(r[1]);
  const m = Number(r[2]) - 1;
  const a = Number(r[3]);
  return existe(a, m, j) ? { a, m, j } : null;
}

/** L'endroit du texte qui suit son n-ième chiffre : le curseur ne saute pas à la fin. */
function apresLeChiffre(texte: string, n: number): number {
  if (n <= 0) return 0;
  let vus = 0;
  for (let i = 0; i < texte.length; i += 1) {
    if (/\d/.test(texte[i]!)) vus += 1;
    if (vus === n) return i + 1;
  }
  return texte.length;
}

function poserLaValeur(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, v);
  else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function fusionnerRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (el: T | null) => {
    for (const r of refs) {
      if (typeof r === 'function') r(el);
      else if (r) (r as React.RefObject<T | null>).current = el;
    }
  };
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const MOIS_COURTS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const JOURS_COURTS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const capitale = (t: string) => t.charAt(0).toLocaleUpperCase('fr') + t.slice(1);
/** Lundi d'abord : 0 pour un lundi, 6 pour un dimanche. */
const rangDansLaSemaine = ({ a, m, j }: Jour) => (new Date(Date.UTC(a, m, j)).getUTCDay() + 6) % 7;
const LARGEUR = 296;

interface Position {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

/** Sous le champ, ou au-dessus quand le dessous manque ; jamais hors de l'écran. */
function placerSous(b: DOMRect): Position {
  const width = Math.min(LARGEUR, window.innerWidth - 16);
  const left = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
  const dessous = window.innerHeight - b.bottom - 14;
  const dessus = b.top - 14;
  const versLeHaut = dessous < 340 && dessus > dessous;
  return versLeHaut
    ? { left, width, bottom: window.innerHeight - b.top + 6 }
    : { left, width, top: b.bottom + 6 };
}

export function DateInput({
  className,
  value,
  defaultValue,
  onChange,
  onBlur,
  onKeyDown,
  min,
  max,
  disabled,
  id,
  name,
  required,
  autoFocus,
  ref: refExterne,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  const natif = React.useRef<HTMLInputElement>(null);
  const champ = React.useRef<HTMLInputElement>(null);
  const conteneur = React.useRef<HTMLDivElement>(null);
  const reactId = React.useId();
  const calendrierId = `${id ?? reactId}-calendrier`;

  // La valeur : celle que la page donne, ou celle du champ caché quand un
  // formulaire la tient par la référence (`reset()` l'y écrit sans événement).
  const [valeurLue, setValeurLue] = React.useState(
    value === undefined ? String(defaultValue ?? '') : '',
  );
  React.useLayoutEffect(() => {
    if (value !== undefined) return;
    const v = natif.current?.value ?? '';
    setValeurLue((ancienne) => (ancienne === v ? ancienne : v));
  });
  const iso = value === undefined ? valeurLue : String(value ?? '');
  const choisie = lireIso(iso);

  // Ce que la frappe a laissé tant que ce n'est pas une date entière ; null :
  // le champ montre la valeur.
  const [brouillon, setBrouillon] = React.useState<string | null>(null);
  const [focus, setFocus] = React.useState(false);
  const ecrite = React.useRef(iso);
  // Une valeur venue d'ailleurs (déduite par la page, remise à zéro) remplace
  // le brouillon.
  React.useEffect(() => {
    if (iso !== ecrite.current) {
      ecrite.current = iso;
      setBrouillon(null);
    }
  }, [iso]);

  const ecrire = (v: string) => {
    ecrite.current = v;
    if (natif.current && natif.current.value !== v) poserLaValeur(natif.current, v);
    else if (value === undefined) setValeurLue(v);
  };

  const signalee = ariaInvalid === true || ariaInvalid === 'true';
  const texte = brouillon ?? enTexte(choisie);
  const tapee = lireTexte(texte);
  const complet = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(texte);
  const mauvaise = texte !== '' && !tapee && (complet || !focus);

  const [ouvert, setOuvert] = React.useState(false);
  const [auClavier, setAuClavier] = React.useState(false);
  const ouvrir = (clavier: boolean) => {
    if (disabled) return;
    setAuClavier(clavier);
    setOuvert(true);
  };
  const fermer = React.useCallback((rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) champ.current?.focus();
  }, []);

  const frapper = (e: React.ChangeEvent<HTMLInputElement>) => {
    const saisi = e.target;
    const curseur = saisi.selectionStart ?? saisi.value.length;
    const chiffresAvant = saisi.value.slice(0, curseur).replace(/\D/g, '').length;
    const forme = mettreEnForme(saisi.value);
    if (forme !== saisi.value) {
      saisi.value = forme;
      const ici = apresLeChiffre(forme, chiffresAvant);
      saisi.setSelectionRange(ici, ici);
    }
    setBrouillon(forme);
    const lu = lireTexte(forme);
    const v = lu ? versIso(lu) : '';
    if (v !== iso) ecrire(v);
  };

  const quitter = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocus(false);
    // Une date entière s'écrit à la française une fois le champ quitté :
    // « 1/3/2024 » devient « 01/03/2024 ».
    if (brouillon !== null && (brouillon === '' || lireTexte(brouillon))) setBrouillon(null);
    const vers = e.relatedTarget as Node | null;
    if (vers && document.getElementById(calendrierId)?.contains(vers)) return;
    // Le départ du champ, annoncé au formulaire depuis l'élément qu'il connaît.
    natif.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };

  const auClavierDuChamp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!ouvert) ouvrir(true);
      else
        document
          .getElementById(calendrierId)
          ?.querySelector<HTMLElement>('[data-actif="vrai"]')
          ?.focus();
    } else if (e.key === 'Escape' && ouvert) {
      e.preventDefault();
      // Le calendrier ouvert sur une fenêtre de saisie : Échap ne ferme que lui.
      e.nativeEvent.stopImmediatePropagation();
      fermer(false);
    } else if (e.key === 'Tab' && ouvert) {
      setOuvert(false);
    }
  };

  return (
    <div ref={conteneur} className="relative">
      <input
        ref={fusionnerRefs(natif, refExterne)}
        type="date"
        name={name}
        {...(value === undefined ? { defaultValue } : { value: iso })}
        onChange={(e) => {
          if (value === undefined) setValeurLue(e.target.value);
          onChange?.(e);
        }}
        onBlur={onBlur}
        readOnly={value !== undefined && !onChange}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        // Le focus qu'un formulaire lui donnerait, sur une erreur, revient au champ visible.
        onFocus={() => champ.current?.focus()}
      />
      <input
        ref={champ}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="jj/mm/aaaa"
        maxLength={10}
        disabled={disabled}
        value={texte}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        aria-required={required || undefined}
        aria-invalid={mauvaise || signalee ? true : undefined}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-controls={ouvert ? calendrierId : undefined}
        onChange={frapper}
        onFocus={() => setFocus(true)}
        onBlur={quitter}
        onKeyDown={auClavierDuChamp}
        onClick={() => {
          // Au doigt, le clavier numérique s'ouvre déjà : le calendrier attend l'icône.
          if (!ouvert && !window.matchMedia('(pointer: coarse)').matches) ouvrir(false);
        }}
        className={cn(
          'h-10 w-full rounded-controle border border-line bg-surface px-3 text-sm text-ink tabular-nums',
          'placeholder:font-normal placeholder:text-ink-muted/70',
          'transition-colors duration-150 ease-out',
          'focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
          'pr-10',
          (mauvaise || signalee) && 'border-danger',
          ouvert && 'border-primary',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Ouvrir le calendrier"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (ouvert ? fermer(true) : ouvrir(true))}
        className={cn(
          'absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-controle-sm text-ink-muted transition-colors duration-150',
          'hover:bg-hover hover:text-ink-strong disabled:pointer-events-none disabled:opacity-50',
          ouvert && 'text-primary',
        )}
      >
        <IconeCalendrier />
      </button>
      {ouvert ? (
        <CalendrierFlottant
          id={calendrierId}
          ancre={conteneur}
          valeur={tapee ? versIso(tapee) : iso}
          min={typeof min === 'string' ? min : undefined}
          max={typeof max === 'string' ? max : undefined}
          libelle={ariaLabel}
          auClavier={auClavier}
          onChoisir={(v) => {
            setBrouillon(null);
            ecrire(v);
            fermer(true);
          }}
          onFermer={fermer}
        />
      ) : null}
    </div>
  );
}

/**
 * Le calendrier qui s'ouvre sous un champ ou une puce : les jours, les mois,
 * les années, et « Aujourd’hui » ; « Effacer » quand la date peut se retirer.
 * Il suit son ancre quand la page défile, se ferme d'un clic ailleurs, d'Échap
 * ou de Tab. Ouvert au clavier (`auClavier`), le jour désigné prend le focus.
 */
export function CalendrierFlottant({
  id,
  ancre,
  valeur,
  min,
  max,
  libelle,
  auClavier = false,
  effacable = false,
  onChoisir,
  onFermer,
}: {
  id?: string;
  /** Ce sous quoi il s'ouvre : un clic dessus ne le ferme pas. */
  ancre: React.RefObject<HTMLElement | null>;
  /** La date montrée, en AAAA-MM-JJ ; vide : aujourd'hui, ramené dans les bornes. */
  valeur: string;
  min?: string;
  max?: string;
  libelle?: string;
  auClavier?: boolean;
  effacable?: boolean;
  /** La date choisie, en AAAA-MM-JJ ; vide pour « Effacer ». */
  onChoisir: (iso: string) => void;
  /** `rendreLeFocus` : fermé au clavier, le focus revient à l'ancre. */
  onFermer: (rendreLeFocus: boolean) => void;
}) {
  const calendrier = React.useRef<HTMLDivElement>(null);
  const choisie = lireIso(valeur);
  const borneMin = lireIso(min);
  const borneMax = lireIso(max);
  const horsBornes = (d: Jour) =>
    (borneMin !== null && rang(d) < rang(borneMin)) ||
    (borneMax !== null && rang(d) > rang(borneMax));
  const auj = aujourdhui();

  const [vue, setVue] = React.useState<Vue>('jours');
  const [actif, setActif] = React.useState<Jour>(() => {
    if (choisie) return choisie;
    if (borneMax && rang(auj) > rang(borneMax)) return borneMax;
    if (borneMin && rang(auj) < rang(borneMin)) return borneMin;
    return auj;
  });
  // La frappe dans le champ déplace le calendrier ouvert.
  React.useEffect(() => {
    const d = lireIso(valeur);
    if (d) setActif(d);
  }, [valeur]);

  const [position, setPosition] = React.useState<Position | null>(null);
  // Au clavier, le jour désigné prend le focus, à chaque pas, et dès que le
  // calendrier est posé.
  const rejoindre = React.useRef(auClavier);
  const pose = position !== null;
  React.useEffect(() => {
    if (!pose || !rejoindre.current || vue !== 'jours') return;
    calendrier.current?.querySelector<HTMLElement>('[data-actif="vrai"]')?.focus();
  }, [pose, vue, actif]);

  React.useLayoutEffect(() => {
    const placer = () => {
      const b = ancre.current?.getBoundingClientRect();
      if (b) setPosition(placerSous(b));
    };
    placer();
    window.addEventListener('scroll', placer, true);
    window.addEventListener('resize', placer);
    return () => {
      window.removeEventListener('scroll', placer, true);
      window.removeEventListener('resize', placer);
    };
  }, [ancre]);

  const fermeture = React.useRef(onFermer);
  fermeture.current = onFermer;
  React.useEffect(() => {
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (calendrier.current?.contains(cible) || ancre.current?.contains(cible)) return;
      fermeture.current(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ancre]);

  const choisir = (d: Jour) => {
    if (!horsBornes(d)) onChoisir(versIso(d));
  };

  const auClavierDuCalendrier = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      // Ouvert sur une fenêtre de saisie : Échap ne ferme que le calendrier.
      e.nativeEvent.stopImmediatePropagation();
      onFermer(true);
      return;
    }
    if (vue !== 'jours') return;
    const pas: Record<string, () => Jour> = {
      ArrowLeft: () => decaler(actif, -1),
      ArrowRight: () => decaler(actif, 1),
      ArrowUp: () => decaler(actif, -7),
      ArrowDown: () => decaler(actif, 7),
      Home: () => decaler(actif, -rangDansLaSemaine(actif)),
      End: () => decaler(actif, 6 - rangDansLaSemaine(actif)),
      PageUp: () => decalerDeMois(actif, e.shiftKey ? -12 : -1),
      PageDown: () => decalerDeMois(actif, e.shiftKey ? 12 : 1),
    };
    const suivant = pas[e.key];
    if (suivant) {
      e.preventDefault();
      rejoindre.current = true;
      setActif(suivant());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choisir(actif);
    }
  };

  if (!position) return null;
  return createPortal(
    <div
      ref={calendrier}
      id={id}
      role="dialog"
      aria-label={libelle ? `Calendrier : ${libelle}` : 'Calendrier'}
      onKeyDown={auClavierDuCalendrier}
      // Un clic dans le calendrier laisse le focus où il est : dans le champ,
      // on continue de taper.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault();
      }}
      className="tg-menu fixed z-[70] rounded-bloc border border-line bg-surface p-3 shadow-lg"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
      }}
    >
      <Calendrier
        vue={vue}
        actif={actif}
        choisie={choisie}
        aujourdhui={auj}
        horsBornes={horsBornes}
        borneMin={borneMin}
        borneMax={borneMax}
        onVue={setVue}
        onActif={(d) => {
          rejoindre.current = false;
          setActif(d);
        }}
        onChoisir={choisir}
      />
      {vue === 'jours' && (effacable || !horsBornes(auj)) ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-soft pt-2">
          {effacable ? (
            <button
              type="button"
              onClick={() => onChoisir('')}
              className="rounded-controle-sm px-2 py-1 text-[12.5px] font-semibold text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink-strong"
            >
              Effacer
            </button>
          ) : (
            <span />
          )}
          {!horsBornes(auj) ? (
            <button
              type="button"
              onClick={() => choisir(auj)}
              className="rounded-controle-sm px-2 py-1 text-[12.5px] font-semibold text-primary transition-colors duration-150 hover:bg-primary-soft"
            >
              Aujourd’hui
            </button>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * Les trois vues du calendrier : les jours d'un mois, les mois d'une année,
 * douze années. Le titre mène de l'une à l'autre : le mois aux mois, l'année
 * aux années, pour une date de naissance sans cent clics.
 */
function Calendrier({
  vue,
  actif,
  choisie,
  aujourdhui: auj,
  horsBornes,
  borneMin,
  borneMax,
  onVue,
  onActif,
  onChoisir,
}: {
  vue: Vue;
  actif: Jour;
  choisie: Jour | null;
  aujourdhui: Jour;
  horsBornes: (d: Jour) => boolean;
  borneMin: Jour | null;
  borneMax: Jour | null;
  onVue: (v: Vue) => void;
  onActif: (d: Jour) => void;
  onChoisir: (d: Jour) => void;
}) {
  const { a, m } = actif;
  const debutDesAnnees = a - (((a % 12) + 12) % 12);
  const anneeHors = (an: number) =>
    (borneMin !== null && an < borneMin.a) || (borneMax !== null && an > borneMax.a);
  const moisHors = (mo: number) =>
    (borneMin !== null && a * 12 + mo < borneMin.a * 12 + borneMin.m) ||
    (borneMax !== null && a * 12 + mo > borneMax.a * 12 + borneMax.m);

  const precedent =
    vue === 'jours'
      ? () => onActif(decalerDeMois(actif, -1))
      : vue === 'mois'
        ? () => onActif(decalerDeMois(actif, -12))
        : () => onActif(decalerDeMois(actif, -144));
  const suivant =
    vue === 'jours'
      ? () => onActif(decalerDeMois(actif, 1))
      : vue === 'mois'
        ? () => onActif(decalerDeMois(actif, 12))
        : () => onActif(decalerDeMois(actif, 144));
  const [avant, apres] =
    vue === 'jours'
      ? ['Mois précédent', 'Mois suivant']
      : vue === 'mois'
        ? ['Année précédente', 'Année suivante']
        : ['Années précédentes', 'Années suivantes'];

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <BoutonDePas libelle={avant} onClick={precedent} sens="avant" />
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          {vue === 'annees' ? (
            <span className="px-2 text-[13.5px] font-semibold text-ink-strong tabular-nums">
              {debutDesAnnees} – {debutDesAnnees + 11}
            </span>
          ) : (
            <>
              {vue === 'jours' ? (
                <button
                  type="button"
                  onClick={() => onVue('mois')}
                  className="rounded-controle-sm px-2 py-1 text-[13.5px] font-semibold text-ink-strong transition-colors duration-150 hover:bg-hover"
                >
                  {capitale(MOIS[m]!)}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onVue('annees')}
                className="rounded-controle-sm px-2 py-1 text-[13.5px] font-semibold text-ink-strong tabular-nums transition-colors duration-150 hover:bg-hover"
              >
                {a}
              </button>
            </>
          )}
        </div>
        <BoutonDePas libelle={apres} onClick={suivant} sens="apres" />
      </div>

      {vue === 'jours' ? (
        <GrilleDesJours
          actif={actif}
          choisie={choisie}
          aujourdhui={auj}
          horsBornes={horsBornes}
          onChoisir={onChoisir}
        />
      ) : vue === 'mois' ? (
        <div className="grid grid-cols-3 gap-1">
          {MOIS_COURTS.map((nom, mo) => {
            const hors = moisHors(mo);
            const courant = choisie !== null && choisie.a === a && choisie.m === mo;
            return (
              <button
                key={nom}
                type="button"
                aria-disabled={hors || undefined}
                onClick={() => {
                  if (hors) return;
                  onActif({ a, m: mo, j: Math.min(actif.j, joursDuMois(a, mo)) });
                  onVue('jours');
                }}
                className={cn(CASE, 'h-11', courant && CASE_CHOISIE, hors && CASE_HORS)}
              >
                {capitale(nom)}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => debutDesAnnees + i).map((an) => {
            const hors = anneeHors(an);
            const courant = choisie !== null && choisie.a === an;
            return (
              <button
                key={an}
                type="button"
                aria-disabled={hors || undefined}
                onClick={() => {
                  if (hors) return;
                  onActif({ a: an, m, j: Math.min(actif.j, joursDuMois(an, m)) });
                  onVue('mois');
                }}
                className={cn(
                  CASE,
                  'h-11 tabular-nums',
                  an === auj.a && !courant && 'font-semibold text-primary',
                  courant && CASE_CHOISIE,
                  hors && CASE_HORS,
                )}
              >
                {an}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CASE =
  'rounded-controle-sm text-[13px] text-ink transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/50';
const CASE_CHOISIE = 'bg-primary font-semibold text-primary-ink hover:bg-primary-hover';
const CASE_HORS = 'cursor-not-allowed text-ink-muted/40 hover:bg-transparent';

/** Les jours du mois du jour désigné, la semaine commençant le lundi. */
function GrilleDesJours({
  actif,
  choisie,
  aujourdhui: auj,
  horsBornes,
  onChoisir,
}: {
  actif: Jour;
  choisie: Jour | null;
  aujourdhui: Jour;
  horsBornes: (d: Jour) => boolean;
  onChoisir: (d: Jour) => void;
}) {
  const { a, m } = actif;
  const decalage = rangDansLaSemaine({ a, m, j: 1 });
  const nombre = joursDuMois(a, m);
  const cases: (Jour | null)[] = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nombre }, (_, i) => ({ a, m, j: i + 1 })),
  ];
  while (cases.length % 7 !== 0) cases.push(null);

  return (
    <div role="grid" aria-label={`${capitale(MOIS[m]!)} ${a}`}>
      <div role="row" className="mb-1 grid grid-cols-7">
        {JOURS_COURTS.map((j, i) => (
          <span
            key={j}
            role="columnheader"
            aria-label={JOURS_LONGS[i]}
            className="grid h-7 place-items-center text-[11.5px] font-semibold text-ink-muted"
          >
            {capitale(j)}
          </span>
        ))}
      </div>
      {Array.from({ length: cases.length / 7 }, (_, l) => (
        <div key={l} role="row" className="grid grid-cols-7 gap-0.5">
          {cases.slice(l * 7, l * 7 + 7).map((d, i) =>
            d === null ? (
              <span key={`vide-${l}-${i}`} role="gridcell" className="h-9" />
            ) : (
              <span key={d.j} role="gridcell">
                <button
                  type="button"
                  data-actif={memeJour(d, actif) ? 'vrai' : undefined}
                  tabIndex={memeJour(d, actif) ? 0 : -1}
                  aria-disabled={horsBornes(d) || undefined}
                  aria-pressed={memeJour(d, choisie)}
                  aria-label={`${JOURS_LONGS[rangDansLaSemaine(d)]} ${d.j === 1 ? '1er' : d.j} ${MOIS[d.m]} ${d.a}`}
                  aria-current={memeJour(d, auj) ? 'date' : undefined}
                  onClick={() => onChoisir(d)}
                  className={cn(
                    CASE,
                    'h-9 w-full tabular-nums',
                    memeJour(d, auj) && !memeJour(d, choisie) && 'font-semibold text-primary',
                    memeJour(d, actif) && !memeJour(d, choisie) && 'bg-hover',
                    memeJour(d, choisie) && CASE_CHOISIE,
                    horsBornes(d) && CASE_HORS,
                  )}
                >
                  {d.j}
                </button>
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function BoutonDePas({
  libelle,
  sens,
  onClick,
}: {
  libelle: string;
  sens: 'avant' | 'apres';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={libelle}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-controle-sm text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink-strong"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn('size-4', sens === 'avant' && 'rotate-180')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.5 4 10.5 8 6.5 12" />
      </svg>
    </button>
  );
}

function IconeCalendrier() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
      <path d="M2.25 6.75h11.5M5.5 1.75v2.5M10.5 1.75v2.5" />
    </svg>
  );
}
