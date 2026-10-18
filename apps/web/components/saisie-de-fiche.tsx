'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';
import {
  cniGroupee,
  majusculesDesLieux,
  majusculesInitiales,
  premiereMajuscule,
} from '@teranga/contracts';
import { Card, CardHeader, CardTitle, cn, Field, Input, Select } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';
import { formatDate } from '../lib/hooks';
import { champDuMontant } from '../lib/montant';

/*
   Les pièces des fiches que la DCH renseigne pour un document sans agent
   (ADR-0094, ADR-0098, ADR-0100) : le contrat de stage, les contrats de
   travail, les décisions de disponibilité. Les mêmes champs s'y saisissent de
   la même façon.
*/

/** Le cadre des champs de la page, celui de ses listes déroulantes. */
export const CADRE = 'h-9 rounded-[10px] px-3 text-[12.5px] font-medium text-ink-strong';

/** Deux colonnes dès que la largeur le permet ; une seule sur un téléphone. */
export function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 px-5 pb-5 sm:grid-cols-2">
        {children}
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

/** Madame ou Monsieur. */
export function ChampDeLaCivilite({
  id,
  civilite,
  onSaisir,
}: {
  id: string;
  civilite: '' | 'madame' | 'monsieur';
  onSaisir: (civilite: 'madame' | 'monsieur') => void;
}) {
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
 * Le numéro de la CNI, groupé à la frappe comme sur la carte : « 1 234 0000
 * 12345 ». Quitté incomplet, il le dit.
 */
export function ChampDeLaCNI({
  id,
  cni,
  onSaisir,
}: {
  id: string;
  cni: string;
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
  const champ = champDuMontant(montant, onSaisir, { zeroPermis });
  return (
    <Field label={libelle} htmlFor={id} required hint={indication}>
      <div className="relative">
        <Input {...champ} id={id} className={cn(CADRE, 'pr-14 tabular-nums')} />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] font-semibold text-ink-muted"
        >
          FCFA
        </span>
      </div>
    </Field>
  );
}
