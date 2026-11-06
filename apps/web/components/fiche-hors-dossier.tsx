'use client';

import { useId } from 'react';
import {
  aujourdhuiIso,
  CATEGORIE_MAX,
  datesDeLaPeriode,
  ficheHorsDossierSchema,
  type DocumentHorsDossier,
} from '@teranga/contracts';
import { cn, Field, Input } from '@teranga/ui';
import {
  CADRE,
  champsDeTexte,
  ChampDeLaCivilite,
  Groupe,
  reglesEnfreintes,
} from './saisie-de-fiche';

/*
   Le certificat de travail et l'attestation de stage d'une personne sans
   dossier dans l'application (ADR-0176) : partie avant son arrivée, ou
   stagiaire dont le contrat s'est fait sur une fiche. La DCH renseigne la
   personne, la période et le poste ; pour le certificat, la catégorie du
   poste. Tout est obligatoire. Les deux documents partagent la fiche : ce qui
   est saisi pour l'un se retrouve dans l'autre.
*/

/** La fiche telle qu'elle se tape ; une date, au format AAAA-MM-JJ. */
export type SaisieHorsDossier = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  debut: string;
  fin: string;
  poste: string;
  /** Le certificat de travail seulement. */
  categorie: string;
};

export const HORS_DOSSIER_VIDE: SaisieHorsDossier = {
  civilite: '',
  prenom: '',
  nom: '',
  debut: '',
  fin: '',
  poste: '',
  categorie: '',
};

/**
 * La fiche telle que l'API la valide (`ficheHorsDossierSchema`) : les blancs
 * ôtés, une civilité pas encore choisie absente, la catégorie en capitales
 * comme le certificat l'imprime.
 */
export function versLaFicheHorsDossier(s: SaisieHorsDossier, doc: DocumentHorsDossier) {
  return {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    debut: s.debut,
    fin: s.fin,
    poste: s.poste.trim(),
    ...(doc === 'certificat_travail'
      ? { categorie: s.categorie.trim().toLocaleUpperCase('fr-FR') }
      : {}),
  };
}

/**
 * La personne sur une ligne, puis la période et le poste : le certificat
 * ajoute la catégorie, et sa ligne en prend quatre.
 */
export function FicheHorsDossier({
  doc,
  valeur,
  onChange,
}: {
  doc: DocumentHorsDossier;
  valeur: SaisieHorsDossier;
  onChange: (valeur: SaisieHorsDossier) => void;
}) {
  const id = useId();
  const poser = (champ: Partial<SaisieHorsDossier>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, intitule } = champsDeTexte(id, valeur, poser);
  const certificat = doc === 'certificat_travail';
  // Les règles des dates, dites sous les champs (ADR-0133) : la période a
  // commencé, et son dernier jour ne précède pas le premier.
  const fiche = versLaFicheHorsDossier(valeur, doc);
  const erreurs = reglesEnfreintes(
    fiche,
    ficheHorsDossierSchema(doc).safeParse(fiche).error?.issues,
    datesDeLaPeriode(fiche),
  );
  const date = (champ: 'debut' | 'fin') => ({
    ...texte(champ),
    type: 'date',
    // Le dernier jour peut être à venir : un départ déjà prévu.
    min: champ === 'fin' ? valeur.debut || undefined : undefined,
    max: champ === 'debut' ? aujourdhuiIso() : undefined,
    'aria-invalid': erreurs[champ] ? true : undefined,
    className: cn(CADRE, 'tabular-nums'),
  });

  return (
    <>
      <Groupe titre="Renseigner la personne">
        <ChampDeLaCivilite
          id={`${id}-civilite`}
          civilite={valeur.civilite}
          onSaisir={(civilite) => poser({ civilite })}
        />
        <Field label="Prénom" htmlFor={`${id}-prenom`} required>
          <Input {...nomPropre('prenom')} />
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required>
          <Input {...nomPropre('nom')} />
        </Field>
      </Groupe>

      <Groupe
        titre={certificat ? 'Renseigner l’emploi' : 'Renseigner le stage'}
        colonnes={certificat ? 4 : 3}
      >
        <Field
          label={certificat ? 'Premier jour de travail' : 'Premier jour du stage'}
          htmlFor={`${id}-debut`}
          required
          error={erreurs.debut}
        >
          <Input {...date('debut')} />
        </Field>
        <Field
          label={certificat ? 'Dernier jour de travail' : 'Dernier jour du stage'}
          htmlFor={`${id}-fin`}
          required
          error={erreurs.fin}
        >
          <Input {...date('fin')} />
        </Field>
        <Field
          label={certificat ? 'Dernier poste occupé' : 'Poste occupé'}
          htmlFor={`${id}-poste`}
          required
        >
          <Input {...intitule('poste', 120)} />
        </Field>
        {certificat ? (
          <Field label="Catégorie du poste" htmlFor={`${id}-categorie`} required>
            <Input {...texte('categorie', CATEGORIE_MAX)} className={cn(CADRE, 'uppercase')} />
          </Field>
        ) : null}
      </Groupe>
    </>
  );
}
