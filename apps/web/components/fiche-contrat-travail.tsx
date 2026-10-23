'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrgUnitView } from '@teranga/contracts';
import {
  aujourdhuiIso,
  CATEGORIE_MAX,
  cniDelivreeAuPlusTot,
  DUREE_DE_CDD_MAX,
  enChiffres,
  ficheDuContratSchema,
  finDuContrat,
  neAuPlusTard,
  orgUnitLabel,
  salaireBrut,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { api } from '../lib/api';
import { COUNTRIES } from '../lib/countries';
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
   Ce que la DCH renseigne pour un contrat de travail (ADR-0098) : la personne
   n'est pas encore dans l'application. Son état civil, son emploi, sa
   rémunération ; tout est obligatoire. La nationalité se choisit dans la
   liste des pays, le contrat en écrit le gentilé ; l'affectation, dans
   l'organigramme. Le salaire brut est la somme de ses trois parts.
*/

export type ContratDeTravail = 'contrat_cdd' | 'contrat_cdi';

/** La fiche telle qu'elle se tape : du texte, des choix, des montants. */
export type SaisieDuContrat = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  naissanceLe: string;
  naissanceA: string;
  cni: string;
  cniDelivreeLe: string;
  cniDelivreeA: string;
  /** Le code du pays. */
  nationalite: string;
  adresse: string;
  poste: string;
  /** L'unité de l'organigramme. */
  affectation: string;
  debut: string;
  duree: string;
  categorie: string;
  salaireDeBase: number | null;
  sursalaire: number | null;
  primeDeTransport: number | null;
  treiziemeMois: '' | 'oui' | 'non';
};

export const CONTRAT_VIDE: SaisieDuContrat = {
  civilite: '',
  prenom: '',
  nom: '',
  naissanceLe: '',
  naissanceA: '',
  cni: '',
  cniDelivreeLe: '',
  cniDelivreeA: '',
  nationalite: '',
  adresse: '',
  poste: '',
  affectation: '',
  debut: '',
  duree: '',
  categorie: '',
  salaireDeBase: null,
  sursalaire: null,
  primeDeTransport: null,
  treiziemeMois: '',
};

/**
 * La fiche telle que l'API la valide (`ficheCddSchema`, `ficheCdiSchema`) :
 * les blancs ôtés, la catégorie en capitales ; une liste pas encore choisie,
 * un montant pas encore saisi, absents. La durée n'est que d'un contrat à
 * durée déterminée.
 */
export function versLaFicheDuContrat(s: SaisieDuContrat, doc: ContratDeTravail) {
  return {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    naissanceLe: s.naissanceLe,
    naissanceA: s.naissanceA.trim(),
    cni: s.cni,
    cniDelivreeLe: s.cniDelivreeLe,
    cniDelivreeA: s.cniDelivreeA.trim(),
    nationalite: s.nationalite || undefined,
    adresse: s.adresse.trim(),
    poste: s.poste.trim(),
    affectation: s.affectation || undefined,
    debut: s.debut,
    ...(doc === 'contrat_cdd' ? { duree: s.duree ? Number(s.duree) : undefined } : {}),
    categorie: s.categorie.trim().toLocaleUpperCase('fr-FR'),
    salaireDeBase: s.salaireDeBase ?? undefined,
    sursalaire: s.sursalaire ?? undefined,
    primeDeTransport: s.primeDeTransport ?? undefined,
    treiziemeMois: s.treiziemeMois ? s.treiziemeMois === 'oui' : undefined,
  };
}

/** Les unités, par ordre alphabétique de leur libellé. */
const parLibelle = (unites: OrgUnitView[]) =>
  [...unites].sort((a, b) => orgUnitLabel(a).localeCompare(orgUnitLabel(b), 'fr'));

export function FicheDuContratDeTravail({
  doc,
  valeur,
  onChange,
}: {
  doc: ContratDeTravail;
  valeur: SaisieDuContrat;
  onChange: (valeur: SaisieDuContrat) => void;
}) {
  const id = useId();
  const poser = (champ: Partial<SaisieDuContrat>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, lieu, intitule } = champsDeTexte(id, valeur, poser);
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });
  const cdd = doc === 'contrat_cdd';
  const fin =
    cdd && valeur.debut && valeur.duree ? finDuContrat(valeur.debut, Number(valeur.duree)) : null;
  const { salaireDeBase, sursalaire, primeDeTransport } = valeur;
  const brut =
    salaireDeBase !== null && sursalaire !== null && primeDeTransport !== null
      ? salaireBrut({ salaireDeBase, sursalaire, primeDeTransport })
      : null;
  // Les règles des dates, dites sous les champs (ADR-0133).
  const fiche = versLaFicheDuContrat(valeur, doc);
  const erreurs = reglesEnfreintes(fiche, ficheDuContratSchema(doc).safeParse(fiche).error?.issues);

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
        {/* La CNI est à jour : délivrée il y a moins de dix ans (ADR-0133). */}
        <Field
          label="Date de délivrance de la CNI"
          htmlFor={`${id}-cniDelivreeLe`}
          required
          error={erreurs.cniDelivreeLe}
        >
          <Input
            type="date"
            {...texte('cniDelivreeLe')}
            min={cniDelivreeAuPlusTot()}
            max={aujourdhuiIso()}
            aria-invalid={erreurs.cniDelivreeLe ? true : undefined}
            className={cn(CADRE, 'tabular-nums')}
          />
        </Field>
        <Field label="Lieu de délivrance de la CNI" htmlFor={`${id}-cniDelivreeA`} required>
          <Input {...lieu('cniDelivreeA', 120)} />
        </Field>
        <Field label="Nationalité" htmlFor={`${id}-nationalite`} required>
          <Select
            id={`${id}-nationalite`}
            aria-label="Nationalité"
            value={valeur.nationalite}
            onChange={(e) => poser({ nationalite: e.target.value })}
            className={CADRE}
          >
            <option value="" hidden>
              Choisir un pays
            </option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Adresse" htmlFor={`${id}-adresse`} required>
          <Input {...lieu('adresse', 200)} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner l’emploi">
        <Field label="Poste" htmlFor={`${id}-poste`} required>
          <Input {...intitule('poste', 120)} />
        </Field>
        <Field label="Catégorie" htmlFor={`${id}-categorie`} required>
          <Input {...texte('categorie', CATEGORIE_MAX)} className={cn(CADRE, 'uppercase')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Affectation" htmlFor={`${id}-affectation`} required>
            <Select
              id={`${id}-affectation`}
              aria-label="Affectation"
              value={valeur.affectation}
              onChange={(e) => poser({ affectation: e.target.value })}
              className={CADRE}
            >
              <option value="" hidden>
                Choisir une direction, un département ou un service
              </option>
              {parLibelle(unites.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {orgUnitLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Date de début" htmlFor={`${id}-debut`} required>
          <Input type="date" {...texte('debut')} className={cn(CADRE, 'tabular-nums')} />
        </Field>
        {cdd ? (
          <ChampDeLaDuree
            id={`${id}-duree`}
            libelle="Durée du contrat"
            mois={valeur.duree}
            max={DUREE_DE_CDD_MAX}
            fin={fin ? { libelle: 'Fin du contrat', date: fin } : null}
            onSaisir={(duree) => poser({ duree })}
          />
        ) : null}
      </Groupe>

      <Groupe titre="Renseigner la rémunération">
        <ChampDuMontant
          id={`${id}-salaireDeBase`}
          libelle="Salaire de base"
          montant={salaireDeBase}
          onSaisir={(montant) => poser({ salaireDeBase: montant })}
        />
        <ChampDuMontant
          id={`${id}-sursalaire`}
          libelle="Sursalaire"
          montant={sursalaire}
          zeroPermis
          onSaisir={(montant) => poser({ sursalaire: montant })}
        />
        <ChampDuMontant
          id={`${id}-primeDeTransport`}
          libelle="Prime de transport"
          montant={primeDeTransport}
          zeroPermis
          indication={brut === null ? undefined : `Salaire brut : ${enChiffres(brut)} F CFA`}
          onSaisir={(montant) => poser({ primeDeTransport: montant })}
        />
        <Field label="Treizième mois" htmlFor={`${id}-treiziemeMois`} required>
          <Select
            id={`${id}-treiziemeMois`}
            aria-label="Treizième mois"
            value={valeur.treiziemeMois}
            onChange={(e) =>
              poser({ treiziemeMois: e.target.value as SaisieDuContrat['treiziemeMois'] })
            }
            className={CADRE}
          >
            <option value="" hidden>
              Choisir
            </option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </Select>
        </Field>
      </Groupe>
    </>
  );
}
