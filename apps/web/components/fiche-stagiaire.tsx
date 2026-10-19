'use client';

import { useId } from 'react';
import {
  CATEGORIE_MAX,
  DUREE_DE_STAGE_MAX,
  ficheStagiaireSchema,
  finDuStage,
  neAuPlusTard,
} from '@teranga/contracts';
import { cn, Field, Input } from '@teranga/ui';
import {
  CADRE,
  champsDeTexte,
  ChampDeLaCivilite,
  ChampDeLaCNI,
  ChampDeLaDuree,
  ChampDuMontant,
  Groupe,
  reglesEnfreintes,
} from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour un contrat de stage (ADR-0094, ADR-0096) : la
   personne n'est pas encore dans l'application. Son état civil d'abord, puis
   le stage ; la fin du stage se déduit du début et de la durée. Tout est
   obligatoire. À la frappe, les prénoms, les noms, le lieu de naissance et
   l'adresse prennent une capitale à chaque mot, sauf aux petits mots d'un
   lieu (« Patte d’Oie », ADR-0098), la formation et le poste à leur première
   lettre (ADR-0097) ; le numéro de la CNI se groupe comme sur la carte.
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

export function FicheDuStagiaire({
  valeur,
  onChange,
}: {
  valeur: SaisieDuStagiaire;
  onChange: (valeur: SaisieDuStagiaire) => void;
}) {
  const id = useId();
  const poser = (champ: Partial<SaisieDuStagiaire>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, lieu, intitule } = champsDeTexte(id, valeur, poser);
  const fin = valeur.debut && valeur.duree ? finDuStage(valeur.debut, Number(valeur.duree)) : null;
  // Les règles des dates, dites sous les champs (ADR-0133).
  const fiche = versLaFiche(valeur);
  const erreurs = reglesEnfreintes(fiche, ficheStagiaireSchema.safeParse(fiche).error?.issues);

  return (
    <>
      <Groupe titre="Renseigner l’état civil">
        <ChampDeLaCivilite
          id={`${id}-civilite`}
          civilite={valeur.civilite}
          onSaisir={(civilite) => poser({ civilite })}
        />
        <ChampDeLaCNI id={`${id}-cni`} cni={valeur.cni} onSaisir={(cni) => poser({ cni })} />
        <Field label="Prénom" htmlFor={`${id}-prenom`} required>
          <Input {...nomPropre('prenom')} />
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required>
          <Input {...nomPropre('nom')} />
        </Field>
        <Field
          label="Date de naissance"
          htmlFor={`${id}-naissanceLe`}
          required
          error={erreurs.naissanceLe}
        >
          <Input
            type="date"
            {...texte('naissanceLe')}
            max={neAuPlusTard()}
            aria-invalid={erreurs.naissanceLe ? true : undefined}
            className={cn(CADRE, 'tabular-nums')}
          />
        </Field>
        <Field label="Lieu de naissance" htmlFor={`${id}-naissanceA`} required>
          <Input {...lieu('naissanceA', 120)} />
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
          <Input {...lieu('adresse', 200)} />
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
        <ChampDeLaDuree
          id={`${id}-duree`}
          libelle="Durée du stage"
          mois={valeur.duree}
          max={DUREE_DE_STAGE_MAX}
          fin={fin ? { libelle: 'Fin du stage', date: fin } : null}
          onSaisir={(duree) => poser({ duree })}
        />
        <Field label="Catégorie" htmlFor={`${id}-categorie`} required>
          <Input {...texte('categorie', CATEGORIE_MAX)} className={cn(CADRE, 'uppercase')} />
        </Field>
        <ChampDuMontant
          id={`${id}-allocation`}
          libelle="Allocation mensuelle TTC"
          montant={valeur.allocation}
          onSaisir={(allocation) => poser({ allocation })}
        />
      </Groupe>
    </>
  );
}
