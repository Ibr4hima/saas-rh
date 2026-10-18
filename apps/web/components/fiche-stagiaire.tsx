'use client';

import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  CATEGORIE_MAX,
  cniGroupee,
  DUREE_DE_STAGE_MAX,
  finDuStage,
  majusculesInitiales,
  premiereMajuscule,
} from '@teranga/contracts';
import { Card, CardHeader, CardTitle, cn, Field, Input, Select } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';
import { formatDate } from '../lib/hooks';
import { champDuMontant } from '../lib/montant';

/*
   Ce que la DCH renseigne pour un contrat de stage (ADR-0094, ADR-0096) : la
   personne n'est pas encore dans l'application. Son état civil d'abord, puis
   le stage ; la fin du stage se déduit du début et de la durée. Tout est
   obligatoire. À la frappe, les prénoms, les noms, le lieu de naissance et
   l'adresse prennent une capitale à chaque mot, la formation et le poste à
   leur première lettre (ADR-0097) ; le numéro de la CNI se groupe comme sur
   la carte.
*/

/** La fiche telle qu'elle se tape : du texte, une durée choisie, un montant. */
export type SaisieDuStagiaire = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  naissanceLe: string;
  naissanceA: string;
  cni: string;
  perePrenom: string;
  merePrenom: string;
  mereNom: string;
  adresse: string;
  formation: string;
  poste: string;
  debut: string;
  duree: string;
  categorie: string;
  allocation: number | null;
};

export const STAGIAIRE_VIDE: SaisieDuStagiaire = {
  civilite: '',
  prenom: '',
  nom: '',
  naissanceLe: '',
  naissanceA: '',
  cni: '',
  perePrenom: '',
  merePrenom: '',
  mereNom: '',
  adresse: '',
  formation: '',
  poste: '',
  debut: '',
  duree: '',
  categorie: '',
  allocation: null,
};

/**
 * La fiche telle que l'API la valide (`ficheStagiaireSchema`) : les blancs
 * ôtés, la catégorie en capitales ; une liste pas encore choisie, un montant
 * pas encore saisi, absents.
 */
export function versLaFiche(s: SaisieDuStagiaire) {
  return {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    naissanceLe: s.naissanceLe,
    naissanceA: s.naissanceA.trim(),
    cni: s.cni,
    perePrenom: s.perePrenom.trim(),
    merePrenom: s.merePrenom.trim(),
    mereNom: s.mereNom.trim(),
    adresse: s.adresse.trim(),
    formation: s.formation.trim(),
    poste: s.poste.trim(),
    debut: s.debut,
    duree: s.duree ? Number(s.duree) : undefined,
    categorie: s.categorie.trim().toLocaleUpperCase('fr-FR'),
    allocation: s.allocation ?? undefined,
  };
}

/** Le cadre des champs de la page, celui de ses listes déroulantes. */
const CADRE = 'h-9 rounded-[10px] px-3 text-[12.5px] font-medium text-ink-strong';

/** Deux colonnes dès que la largeur le permet ; une seule sur un téléphone. */
function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
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

export function FicheDuStagiaire({
  valeur,
  onChange,
}: {
  valeur: SaisieDuStagiaire;
  onChange: (valeur: SaisieDuStagiaire) => void;
}) {
  const id = useId();
  const [cniQuittee, setCniQuittee] = useState(false);
  const poser = (champ: Partial<SaisieDuStagiaire>) => onChange({ ...valeur, ...champ });
  const cni = champDeChiffres({
    chiffres: valeur.cni,
    max: 13,
    grouper: cniGroupee,
    onSaisir: (chiffres) => poser({ cni: chiffres }),
  });
  const allocation = champDuMontant(valeur.allocation, (montant) => poser({ allocation: montant }));

  type ChampDeTexte = Exclude<keyof SaisieDuStagiaire, 'civilite' | 'cni' | 'allocation'>;

  /** Ce qu'un champ de texte reçoit : son identifiant, sa valeur, sa frappe. */
  const texte = (champ: ChampDeTexte, max?: number) => ({
    id: `${id}-${champ}`,
    value: valeur[champ],
    maxLength: max,
    onChange: (e: ChangeEvent<HTMLInputElement>) => poser({ [champ]: e.target.value }),
    className: CADRE,
  });

  /** Un champ de texte qui pose ses capitales à la frappe, sans que le curseur bouge. */
  const avecCapitales = (
    champ: ChampDeTexte,
    max: number,
    capitales: (texte: string) => string,
    clavier: 'words' | 'sentences',
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
      poser({ [champ]: corrige });
    },
  });
  /** Un prénom, un nom, un lieu, une adresse : « dos santos » s'écrit « Dos Santos ». */
  const nomPropre = (champ: ChampDeTexte, max = 80) =>
    avecCapitales(champ, max, majusculesInitiales, 'words');
  /** Une formation, un poste : « assistante archiviste » s'écrit « Assistante archiviste ». */
  const intitule = (champ: ChampDeTexte, max: number) =>
    avecCapitales(champ, max, premiereMajuscule, 'sentences');

  const fin = valeur.debut && valeur.duree ? finDuStage(valeur.debut, Number(valeur.duree)) : null;
  const cniIncomplete = cniQuittee && valeur.cni.length > 0 && valeur.cni.length < 13;

  return (
    <>
      <Groupe titre="Renseigner l’état civil">
        <Field label="Civilité" htmlFor={`${id}-civilite`} required>
          <Select
            id={`${id}-civilite`}
            aria-label="Civilité"
            value={valeur.civilite}
            onChange={(e) => poser({ civilite: e.target.value as SaisieDuStagiaire['civilite'] })}
            className={CADRE}
          >
            <option value="" hidden>
              Choisir
            </option>
            <option value="madame">Madame</option>
            <option value="monsieur">Monsieur</option>
          </Select>
        </Field>
        <Field
          label="N° de la CNI"
          htmlFor={`${id}-cni`}
          required
          error={cniIncomplete ? 'Treize chiffres attendus' : undefined}
        >
          <Input
            {...cni}
            id={`${id}-cni`}
            aria-invalid={cniIncomplete || undefined}
            onBlur={() => setCniQuittee(true)}
            className={cn(CADRE, 'tabular-nums', cniIncomplete && 'border-danger')}
          />
        </Field>
        <Field label="Prénom" htmlFor={`${id}-prenom`} required>
          <Input {...nomPropre('prenom')} />
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required>
          <Input {...nomPropre('nom')} />
        </Field>
        <Field label="Date de naissance" htmlFor={`${id}-naissanceLe`} required>
          <Input type="date" {...texte('naissanceLe')} className={cn(CADRE, 'tabular-nums')} />
        </Field>
        <Field label="Lieu de naissance" htmlFor={`${id}-naissanceA`} required>
          <Input {...nomPropre('naissanceA', 120)} />
        </Field>
        <Field label="Prénom du père" htmlFor={`${id}-perePrenom`} required>
          <Input {...nomPropre('perePrenom')} />
        </Field>
        <Field label="Prénom de la mère" htmlFor={`${id}-merePrenom`} required>
          <Input {...nomPropre('merePrenom')} />
        </Field>
        <Field label="Nom de la mère" htmlFor={`${id}-mereNom`} required>
          <Input {...nomPropre('mereNom')} />
        </Field>
        <Field label="Adresse" htmlFor={`${id}-adresse`} required>
          <Input {...nomPropre('adresse', 200)} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner le stage">
        <Field label="Formation suivie" htmlFor={`${id}-formation`} required>
          <Input {...intitule('formation', 200)} />
        </Field>
        <Field label="Poste" htmlFor={`${id}-poste`} required>
          <Input {...intitule('poste', 120)} />
        </Field>
        <Field label="Date de début" htmlFor={`${id}-debut`} required>
          <Input type="date" {...texte('debut')} className={cn(CADRE, 'tabular-nums')} />
        </Field>
        <Field
          label="Durée du stage"
          htmlFor={`${id}-duree`}
          required
          hint={fin ? `Fin du stage : ${formatDate(fin)}` : undefined}
        >
          <Select
            id={`${id}-duree`}
            aria-label="Durée du stage"
            value={valeur.duree}
            onChange={(e) => poser({ duree: e.target.value })}
            className={CADRE}
          >
            <option value="" hidden>
              Choisir
            </option>
            {Array.from({ length: DUREE_DE_STAGE_MAX }, (_, i) => i + 1).map((mois) => (
              <option key={mois} value={mois}>
                {mois} mois
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Catégorie" htmlFor={`${id}-categorie`} required>
          <Input {...texte('categorie', CATEGORIE_MAX)} className={cn(CADRE, 'uppercase')} />
        </Field>
        <Field label="Allocation mensuelle TTC" htmlFor={`${id}-allocation`} required>
          <div className="relative">
            <Input
              {...allocation}
              id={`${id}-allocation`}
              className={cn(CADRE, 'pr-14 tabular-nums')}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] font-semibold text-ink-muted"
            >
              FCFA
            </span>
          </div>
        </Field>
      </Groupe>
    </>
  );
}
