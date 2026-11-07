'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';
import {
  cniGroupee,
  majusculesDesLieux,
  majusculesInitiales,
  premiereMajuscule,
} from '@teranga/contracts';
import { Button, Card, CardTitle, cn, Field, Input, Select } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';
import { formatDate } from '../lib/hooks';
import { champDuMontant } from '../lib/montant';
import { Icon } from './icons';

/*
   Les pièces des fiches que la DCH renseigne pour un document sans agent
   (ADR-0094, ADR-0098, ADR-0100, ADR-0102, ADR-0106) : le contrat de stage,
   les contrats de travail, les décisions de disponibilité, la domiciliation
   bancaire, la déclaration de mouvement du travailleur. Les mêmes champs s'y
   saisissent de la même façon, en sections d'un seul bloc, le
   « Préremplissage » (ADR-0121).
*/

/** Le cadre des champs de la page, celui de ses listes déroulantes. */
export const CADRE = 'h-9 rounded-controle px-3 text-[12.5px] font-medium text-ink-strong';

/**
 * Une section du préremplissage : son intitulé, puis ses champs, trois par
 * ligne quand le bloc est assez large (ADR-0168), quatre quand la section
 * tient en quatre champs courts, deux sur une tablette, un seul sur un
 * téléphone. Aucun champ ne reste seul au bout d'une ligne : chaque fiche
 * range les siens pour remplir les lignes. La largeur se mesure au bloc, pas
 * à l'écran : le menu en prend sa part. Chaque champ occupe trois rangées que
 * ses voisins de ligne partagent (`subgrid`) : l'intitulé, la saisie, le
 * message. Un intitulé sur deux lignes ne décale donc pas la saisie d'à côté.
 * Les sections se suivent dans le bloc, séparées d'un filet.
 */
export function Groupe({
  titre,
  colonnes = 3,
  children,
}: {
  titre: string;
  colonnes?: 3 | 4;
  children: ReactNode;
}) {
  return (
    <section className="@container border-t border-line-soft px-5 pt-4 pb-1.5">
      <h3 className="mb-3.5 text-[13.5px] font-bold text-ink-strong">{titre}</h3>
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-x-3.5 *:row-span-3 *:grid *:grid-rows-subgrid *:items-start *:pb-3.5 @lg:grid-cols-2',
          colonnes === 4 ? '@4xl:grid-cols-4' : '@3xl:grid-cols-3',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Une section d'un seul choix, l'agent ou le stage : son intitulé à gauche,
 * le choix à droite, comme celui du document au-dessus. Sur téléphone,
 * l'intitulé passe au-dessus.
 */
export function Choix({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line-soft px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
      <h3 className="min-w-0 flex-1 text-[13.5px] font-bold text-ink-strong">{titre}</h3>
      <div className="w-full sm:w-[23rem] sm:shrink-0">{children}</div>
    </section>
  );
}

/**
 * Oui ou Non, à la mesure des onglets (36 px), sur toute la largeur du choix :
 * la question est l'intitulé de la section (ADR-0176).
 */
export function OuiNon({
  libelle,
  oui,
  onChoisir,
}: {
  /** La question, pour les lecteurs d'écran. */
  libelle: string;
  oui: boolean;
  onChoisir: (oui: boolean) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={libelle}
      className="flex gap-1 rounded-groupe border border-line-soft bg-bg p-[3px]"
    >
      {[
        { reponse: true, label: 'Oui' },
        { reponse: false, label: 'Non' },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={oui === o.reponse}
          onClick={() => onChoisir(o.reponse)}
          className={cn(
            'h-7 flex-1 rounded-controle-sm px-3.5 text-[12.5px] font-bold whitespace-nowrap transition-colors',
            'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
            oui === o.reponse
              ? 'bg-surface text-primary shadow-sm'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Un champ sur deux colonnes : une adresse, une affectation, un nom d'unité. */
export const SUR_DEUX_COLONNES = '@lg:col-span-2';

/**
 * Le dernier champ d'une liste qui s'allonge, les enfants d'une déclaration
 * de mouvement : seul sur sa ligne de trois, il en prend deux.
 */
export const ALLONGE_EN_FIN_DE_LISTE = '@3xl:col-span-2';

/** Un champ sur toute la ligne : une phrase à écrire, comme une disposition particulière. */
export const PLEINE_LIGNE = 'col-span-full';

/**
 * Un champ qui ouvre une ligne quand elles sont de trois : la ligne d'avant
 * s'arrête, comme celle de la naissance avant celle de la CNI.
 */
export const EN_DEBUT_DE_LIGNE = '@3xl:col-start-1';

/**
 * Le bloc « Préremplissage » : tout ce que la DCH saisit pour un document,
 * en sections, et « Valider » au pied. Le document ne se génère qu'à la
 * validation. Validé, le bloc se replie à la hauteur de celui du choix du
 * document, 68 px, et « Modifier » le rouvre sur ce qui avait été saisi : les
 * sections restent montées, cachées, et gardent tout.
 */
export function Preremplissage({
  valide,
  pret,
  onValider,
  onModifier,
  children,
}: {
  valide: boolean;
  /** Tout est saisi : « Valider » s'ouvre. */
  pret: boolean;
  onValider: () => void;
  onModifier: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      {/* Replié, il prend la forme du bloc du choix du document : sur
          téléphone, l'intitulé au-dessus et le bouton sur toute la largeur. */}
      <div
        className={cn(
          'flex px-5 py-4',
          valide ? 'flex-col gap-3 sm:flex-row sm:items-center sm:gap-5' : 'items-center gap-5',
        )}
      >
        <CardTitle className="min-w-0 flex-1">Préremplissage</CardTitle>
        {valide ? (
          <Button variant="secondary" className="h-9 w-full sm:w-auto" onClick={onModifier}>
            <Icon name="edit" size={15} />
            Modifier
          </Button>
        ) : (
          // Sur écran large, la ligne du titre garde sa hauteur, ouverte ou repliée.
          <span aria-hidden className="hidden h-9 sm:block" />
        )}
      </div>
      <div hidden={valide}>
        {children}
        <div className="flex justify-end border-t border-line-soft px-5 py-4">
          <Button className="h-9 px-5" disabled={!pret} onClick={onValider}>
            Valider
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Les champs de texte d'une fiche : leur identifiant, leur valeur, leur
 * frappe ; ceux qui posent leurs capitales à la frappe, sans que le curseur
 * bouge.
 */
export function champsDeTexte<T>(id: string, valeur: T, poser: (champ: Partial<T>) => void) {
  const texte = (champ: keyof T & string, max?: number) => ({
    id: `${id}-${champ}`,
    value: String(valeur[champ] ?? ''),
    maxLength: max,
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      poser({ [champ]: e.target.value } as Partial<T>),
    className: CADRE,
  });
  /**
   * `aLaFin` : la règle entière, posée quand on quitte le champ, si la frappe
   * en a laissé une part en attente.
   */
  const avecCapitales = (
    champ: keyof T & string,
    max: number,
    capitales: (texte: string) => string,
    clavier: 'words' | 'sentences',
    aLaFin: (texte: string) => string = capitales,
  ) => ({
    ...texte(champ, max),
    autoCapitalize: clavier,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const saisi = e.target;
      const corrige = capitales(saisi.value);
      if (corrige !== saisi.value) {
        const { selectionStart, selectionEnd } = saisi;
        saisi.value = corrige;
        saisi.setSelectionRange(selectionStart, selectionEnd);
      }
      poser({ [champ]: corrige } as Partial<T>);
    },
    onBlur: (e: ChangeEvent<HTMLInputElement>) => {
      const fini = aLaFin(e.target.value);
      if (fini !== e.target.value) poser({ [champ]: fini } as Partial<T>);
    },
  });
  return {
    texte,
    /** Un prénom, un nom : « dos santos » s'écrit « Dos Santos ». */
    nomPropre: (champ: keyof T & string, max = 80) =>
      avecCapitales(champ, max, majusculesInitiales, 'words'),
    /** Un lieu, une adresse : « patte d’oie » s'écrit « Patte d’Oie ». */
    lieu: (champ: keyof T & string, max: number) =>
      avecCapitales(
        champ,
        max,
        (t) => majusculesDesLieux(t, { enCours: true }),
        'words',
        majusculesDesLieux,
      ),
    /** Une formation, un poste : « assistante archiviste » s'écrit « Assistante archiviste ». */
    intitule: (champ: keyof T & string, max: number) =>
      avecCapitales(champ, max, premiereMajuscule, 'sentences'),
  };
}

/** Une règle que Zod dit enfreinte : son code, le champ qu'elle vise, son message. */
type Probleme = { code: string; path: readonly PropertyKey[]; message: string };

/**
 * Les règles qu'enfreint une fiche, champ par champ (ADR-0133) : une date
 * dans l'avenir, une fin avant son début. `problemes` : ce que Zod dit des
 * champs ; `croisees` : les règles qui lient deux dates, que Zod tait tant
 * qu'une liste de la fiche n'est pas choisie. Un champ vide se tait :
 * « Valider » attend déjà qu'il soit rempli. `fiche` : ce qui part à l'API ;
 * un champ imbriqué se nomme par son chemin (« visa.le »).
 */
export function reglesEnfreintes(
  fiche: unknown,
  problemes: readonly Probleme[] | undefined,
  croisees: Record<string, string> = {},
): Record<string, string> {
  const rempli = (chemin: readonly PropertyKey[]) => {
    const valeur = chemin.reduce<unknown>(
      (v, cle) =>
        v !== null && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[cle] : undefined,
      fiche,
    );
    return !(
      valeur === undefined ||
      valeur === '' ||
      (Array.isArray(valeur) && valeur.length === 0)
    );
  };
  const erreurs: Record<string, string> = {};
  for (const p of problemes ?? []) {
    if (p.code === 'custom' && rempli(p.path)) erreurs[p.path.map(String).join('.')] ??= p.message;
  }
  for (const [chemin, message] of Object.entries(croisees)) {
    if (rempli(chemin.split('.'))) erreurs[chemin] ??= message;
  }
  return erreurs;
}

/** Madame ou Monsieur. */
export function ChampDeLaCivilite({
  id,
  civilite,
  fige = false,
  onSaisir,
}: {
  id: string;
  civilite: '' | 'madame' | 'monsieur';
  /** Reprise du dossier de l'agent, au titre d'une demande : elle ne se corrige pas. */
  fige?: boolean;
  onSaisir: (civilite: 'madame' | 'monsieur') => void;
}) {
  if (fige) {
    return (
      <Field label="Civilité" htmlFor={id}>
        <ChampFige id={id} valeur={civilite === 'madame' ? 'Madame' : 'Monsieur'} />
      </Field>
    );
  }
  return (
    <Field label="Civilité" htmlFor={id} required>
      <Select
        id={id}
        aria-label="Civilité"
        value={civilite}
        onChange={(e) => onSaisir(e.target.value as 'madame' | 'monsieur')}
        className={CADRE}
      >
        <option value="" hidden>
          Choisir
        </option>
        <option value="madame">Madame</option>
        <option value="monsieur">Monsieur</option>
      </Select>
    </Field>
  );
}

/**
 * Un champ que la fiche reprend du dossier de l'agent, au titre de sa
 * demande (ADR-0190) : grisé, il se lit et se copie, mais ne se saisit pas.
 * Hors du parcours au clavier, qui va de saisie en saisie.
 */
export function ChampFige({ id, valeur }: { id: string; valeur: string }) {
  return (
    <Input
      id={id}
      value={valeur}
      readOnly
      aria-readonly
      tabIndex={-1}
      className={cn(
        CADRE,
        'cursor-not-allowed bg-bg text-ink-muted focus-visible:border-line focus-visible:outline-none',
      )}
    />
  );
}

/** « 02/11/2026 » : une date figée, telle qu'un champ de date l'écrit. */
export const jourEcrit = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Le numéro de la CNI, groupé à la frappe comme sur la carte : « 1 234 0000
 * 12345 ». Quitté incomplet, il le dit.
 */
export function ChampDeLaCNI({
  id,
  cni,
  className,
  onSaisir,
}: {
  id: string;
  cni: string;
  /** Sa place dans la grille : `EN_DEBUT_DE_LIGNE`. */
  className?: string;
  onSaisir: (cni: string) => void;
}) {
  const [quitte, setQuitte] = useState(false);
  const champ = champDeChiffres({ chiffres: cni, max: 13, grouper: cniGroupee, onSaisir });
  const incomplet = quitte && cni.length > 0 && cni.length < 13;
  return (
    <Field
      label="N° de la CNI"
      htmlFor={id}
      required
      className={className}
      error={incomplet ? 'Treize chiffres attendus' : undefined}
    >
      <Input
        {...champ}
        id={id}
        aria-invalid={incomplet || undefined}
        onBlur={() => setQuitte(true)}
        className={cn(CADRE, 'tabular-nums', incomplet && 'border-danger')}
      />
    </Field>
  );
}

/**
 * Une durée en mois, à choisir ; la fin qui s'en déduit s'écrit dessous :
 * « Fin du stage : 18 nov. 2025 ».
 */
export function ChampDeLaDuree({
  id,
  libelle,
  mois,
  max,
  fin,
  onSaisir,
}: {
  id: string;
  libelle: string;
  mois: string;
  max: number;
  /** « Fin du stage » et la date, quand le début et la durée sont connus. */
  fin: { libelle: string; date: string } | null;
  onSaisir: (mois: string) => void;
}) {
  return (
    <Field
      label={libelle}
      htmlFor={id}
      required
      hint={fin ? `${fin.libelle} : ${formatDate(fin.date)}` : undefined}
    >
      <Select
        id={id}
        aria-label={libelle}
        value={mois}
        onChange={(e) => onSaisir(e.target.value)}
        className={CADRE}
      >
        <option value="" hidden>
          Choisir
        </option>
        {Array.from({ length: max }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m} mois
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** La saisie d'un montant en francs CFA : les milliers séparés à la frappe, l'unité au bout. */
export function SaisieDuMontant({
  id,
  montant,
  zeroPermis = false,
  onSaisir,
  'aria-label': libelle,
  'aria-describedby': decrit,
}: {
  id: string;
  montant: number | null;
  /** Zéro se saisit : un sursalaire peut être nul. */
  zeroPermis?: boolean;
  onSaisir: (montant: number | null) => void;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const champ = champDuMontant(montant, onSaisir, { zeroPermis });
  return (
    <div className="relative">
      <Input
        {...champ}
        id={id}
        aria-label={libelle}
        aria-describedby={decrit}
        className={cn(CADRE, 'pr-14 tabular-nums')}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] font-semibold text-ink-muted"
      >
        FCFA
      </span>
    </div>
  );
}

/** Un montant en francs CFA, les milliers séparés à la frappe. */
export function ChampDuMontant({
  id,
  libelle,
  montant,
  zeroPermis = false,
  indication,
  onSaisir,
}: {
  id: string;
  libelle: string;
  montant: number | null;
  /** Zéro se saisit : un sursalaire peut être nul. */
  zeroPermis?: boolean;
  indication?: string;
  onSaisir: (montant: number | null) => void;
}) {
  return (
    <Field label={libelle} htmlFor={id} required hint={indication}>
      <SaisieDuMontant id={id} montant={montant} zeroPermis={zeroPermis} onSaisir={onSaisir} />
    </Field>
  );
}
