'use client';

import { useId, useState, type ChangeEvent } from 'react';
import type { NatureDuMouvement, SituationDeFamille } from '@teranga/contracts';
import {
  aujourdhuiIso,
  CATEGORIE_MAX,
  CATEGORIES_D_ENREGISTREMENT,
  datesDeLaDeclaration,
  CHANGEMENTS_DU_TRAVAILLEUR,
  CHIFFRES_DE_L_IMMATRICULATION,
  cniDelivreeAuPlusTot,
  DEPARTS_DU_TRAVAILLEUR,
  DISPOSITION_MAX,
  DISPOSITIONS_MAX,
  ENFANTS_MAX,
  EPOUSES_MAX,
  ficheDeclarationMouvementSchema,
  HORAIRES_HEBDOMADAIRES,
  majusculesInitiales,
  maritalLabelsFor,
  MOUVEMENTS_DU_TRAVAILLEUR,
  neAuPlusTard,
  plusJours,
} from '@teranga/contracts';
import { Checkbox, cn, Field, Input, Select } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';
import { COUNTRIES } from '../lib/countries';
import {
  CADRE,
  champsDeTexte,
  ChampDeLaCivilite,
  ChampDeLaCNI,
  ChampDuMontant,
  Groupe,
  reglesEnfreintes,
} from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour une déclaration de mouvement du travailleur
   (ADR-0106) : le mouvement, l'état civil, la situation de famille, l'emploi,
   le statut militaire et les dispositions particulières de l'engagement.
   Ce qui ne vaut que pour un mouvement ou une personne ne s'ouvre que pour
   eux : la date d'un départ ou d'un changement, les épouses d'un homme marié
   ou l'époux d'une femme mariée, les dates d'un contrat à durée déterminée,
   l'entrée au Sénégal d'une personne étrangère, la classe, l'armée et le
   grade de qui a fait son service. Ce que la DCH peut ne pas connaître
   encore est facultatif : laissé vide, le formulaire garde des pointillés
   pour l'écrire à la main ; la catégorie d'enregistrement n'est alors pas
   encadrée. La date de délivrance de la carte d'identité, que le formulaire
   n'écrit pas, dit qu'une CNI sénégalaise est à jour (ADR-0134).
*/

type Depart = (typeof DEPARTS_DU_TRAVAILLEUR)[number];
type Changement = (typeof CHANGEMENTS_DU_TRAVAILLEUR)[number];

/** La fiche telle qu'elle se tape ; une date, au format AAAA-MM-JJ. */
export type SaisieDeLaDeclaration = {
  nature: '' | NatureDuMouvement;
  depart: '' | Depart;
  changements: Changement[];
  effetLe: string;
  /** Les chiffres du numéro au fichier central de la main-d'œuvre. */
  immatriculation: string;
  categorieDEnregistrement: '' | (typeof CATEGORIES_D_ENREGISTREMENT)[number];
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  naissanceLe: string;
  naissanceA: string;
  /** Le code du pays de naissance. */
  naissancePays: string;
  /** Le code du pays de la nationalité. */
  nationalite: string;
  perePrenom: string;
  merePrenom: string;
  mereNom: string;
  adresse: string;
  cni: string;
  cniDelivreeLe: string;
  cniDelivreeA: string;
  cniDelivreePar: string;
  css: string;
  ipres: string;
  situationDeFamille: '' | SituationDeFamille;
  /** Le nombre d'épouses d'un homme marié. */
  epouses: string;
  conjoints: string[];
  /** Le nombre d'enfants à charge. */
  nombreDEnfants: string;
  enfants: string[];
  entreeLe: string;
  declarationNumero: string;
  declarationLe: string;
  profession: string;
  emploi: string;
  categorie: string;
  contrat: '' | 'cdd' | 'cdi' | 'chantier';
  cddDu: string;
  cddAu: string;
  chantier: string;
  contratLe: string;
  visaNumero: string;
  visaLe: string;
  enregistrementNumero: string;
  enregistrementLe: string;
  precedentEmployeur: string;
  residence: string;
  entreeAuSenegalLe: string;
  serviceMilitaire: '' | 'oui' | 'non';
  classeDeRecrutement: string;
  armee: '' | 'terre' | 'air' | 'mer';
  grade: '' | 'officier' | 'sous_officier' | 'troupe';
  horaire: string;
  salaire: number | null;
  dispositions: string[];
};

export const DECLARATION_VIDE: SaisieDeLaDeclaration = {
  nature: '',
  depart: '',
  changements: [],
  effetLe: '',
  immatriculation: '',
  categorieDEnregistrement: '',
  civilite: '',
  prenom: '',
  nom: '',
  naissanceLe: '',
  naissanceA: '',
  naissancePays: '',
  nationalite: '',
  perePrenom: '',
  merePrenom: '',
  mereNom: '',
  adresse: '',
  cni: '',
  cniDelivreeLe: '',
  cniDelivreeA: '',
  cniDelivreePar: '',
  css: '',
  ipres: '',
  situationDeFamille: '',
  epouses: '',
  conjoints: [],
  nombreDEnfants: '',
  enfants: [],
  entreeLe: '',
  declarationNumero: '',
  declarationLe: '',
  profession: '',
  emploi: '',
  categorie: '',
  contrat: '',
  cddDu: '',
  cddAu: '',
  chantier: '',
  contratLe: '',
  visaNumero: '',
  visaLe: '',
  enregistrementNumero: '',
  enregistrementLe: '',
  precedentEmployeur: '',
  residence: '',
  entreeAuSenegalLe: '',
  serviceMilitaire: '',
  classeDeRecrutement: '',
  armee: '',
  grade: '',
  horaire: '',
  salaire: null,
  dispositions: Array.from({ length: DISPOSITIONS_MAX }, () => ''),
};

/** Une personne étrangère : un pays choisi, autre que le Sénégal. */
const etrangere = (s: SaisieDeLaDeclaration) => s.nationalite !== '' && s.nationalite !== 'SN';

/** Le nombre de conjoints à nommer : l'époux d'une femme mariée, les épouses d'un homme marié. */
const conjointsANommer = (s: SaisieDeLaDeclaration) =>
  s.situationDeFamille !== 'marie'
    ? 0
    : s.civilite === 'madame'
      ? 1
      : s.civilite === 'monsieur'
        ? Number(s.epouses || 0)
        : 0;

/** Un numéro et sa date, facultatifs ensemble : l'un sans l'autre ne passe pas. */
const numeroEtDate = (numero: string, le: string) =>
  numero.trim() || le ? { numero: numero.trim(), le } : undefined;

/**
 * La fiche telle que l'API la valide (`ficheDeclarationMouvementSchema`) :
 * les blancs ôtés, la catégorie en capitales ; ce qui ne vaut pas pour ce
 * mouvement ou cette personne, absent ; une liste pas encore choisie, absente.
 */
export function versLaFicheDeLaDeclaration(s: SaisieDeLaDeclaration) {
  const service = s.serviceMilitaire === 'oui';
  return {
    mouvements:
      s.nature === 'embauche'
        ? ['embauchage']
        : s.nature === 'depart'
          ? s.depart
            ? [s.depart]
            : []
          : CHANGEMENTS_DU_TRAVAILLEUR.filter((c) => s.changements.includes(c)),
    effetLe: s.nature === 'depart' || s.nature === 'changement' ? s.effetLe : undefined,
    immatriculation: s.immatriculation || undefined,
    categorieDEnregistrement: s.categorieDEnregistrement || undefined,
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    naissanceLe: s.naissanceLe,
    naissanceA: s.naissanceA.trim(),
    naissancePays: s.naissancePays || undefined,
    nationalite: s.nationalite || undefined,
    perePrenom: s.perePrenom.trim(),
    merePrenom: s.merePrenom.trim(),
    mereNom: s.mereNom.trim(),
    adresse: s.adresse.trim(),
    cni: s.cni.trim(),
    cniDelivreeLe: s.cniDelivreeLe,
    cniDelivreeA: s.cniDelivreeA.trim(),
    cniDelivreePar: s.cniDelivreePar.trim(),
    css: s.css.trim() || undefined,
    ipres: s.ipres.trim() || undefined,
    situationDeFamille: s.situationDeFamille || undefined,
    conjoints: s.conjoints.slice(0, conjointsANommer(s)).map((c) => c.trim()),
    enfants: s.enfants.slice(0, Number(s.nombreDEnfants || 0)).map((e) => e.trim()),
    entreeLe: s.entreeLe,
    declarationDEmbauche:
      s.nature === 'embauche' ? undefined : numeroEtDate(s.declarationNumero, s.declarationLe),
    profession: s.profession.trim(),
    emploi: s.emploi.trim(),
    categorie: s.categorie.trim().toLocaleUpperCase('fr-FR'),
    contrat: s.contrat || undefined,
    cddDu: s.contrat === 'cdd' ? s.cddDu : undefined,
    cddAu: s.contrat === 'cdd' ? s.cddAu : undefined,
    chantier: s.contrat === 'chantier' ? s.chantier.trim() : undefined,
    contratLe: s.contratLe || undefined,
    visa: numeroEtDate(s.visaNumero, s.visaLe),
    enregistrement: numeroEtDate(s.enregistrementNumero, s.enregistrementLe),
    precedentEmployeur: s.precedentEmployeur.trim() || undefined,
    residence: s.residence.trim(),
    entreeAuSenegalLe: etrangere(s) ? s.entreeAuSenegalLe : undefined,
    serviceMilitaire: s.serviceMilitaire ? service : undefined,
    classeDeRecrutement: service ? s.classeDeRecrutement : undefined,
    armee: service ? s.armee || undefined : undefined,
    grade: service ? s.grade || undefined : undefined,
    horaire: s.horaire ? Number(s.horaire) : undefined,
    salaire: s.salaire ?? undefined,
    dispositions: s.dispositions.map((d) => d.trim()).filter(Boolean),
  };
}

/** Les dates que la fiche range dans une pièce : leur chemin, celui des règles enfreintes. */
const CHEMINS_DES_DATES: Partial<Record<keyof SaisieDeLaDeclaration, string>> = {
  declarationLe: 'declarationDEmbauche.le',
  visaLe: 'visa.le',
  enregistrementLe: 'enregistrement.le',
};

/** Le code d'une situation de famille, sous celui de l'état civil des dossiers. */
const ETAT_CIVIL = {
  celibataire: 'single',
  marie: 'married',
  divorce: 'divorced',
  veuf: 'widowed',
} as const;

export function FicheDeLaDeclaration({
  valeur,
  onChange,
}: {
  valeur: SaisieDeLaDeclaration;
  onChange: (valeur: SaisieDeLaDeclaration) => void;
}) {
  const id = useId();
  const poser = (champ: Partial<SaisieDeLaDeclaration>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, lieu, intitule } = champsDeTexte(id, valeur, poser);
  // Les règles des dates, dites sous les champs (ADR-0133, ADR-0134) :
  // l'entrée et le contrat avant aujourd'hui, les visas et la déclaration
  // d'embauche pas après, les visas pas avant le contrat, une CNI
  // sénégalaise délivrée il y a moins de dix ans.
  const fiche = versLaFicheDeLaDeclaration(valeur);
  const erreurs = reglesEnfreintes(
    fiche,
    ficheDeclarationMouvementSchema.safeParse(fiche).error?.issues,
    datesDeLaDeclaration(fiche),
  );
  const erreurDe = (champ: keyof SaisieDeLaDeclaration & string) =>
    erreurs[CHEMINS_DES_DATES[champ] ?? champ];
  const aujourdhui = aujourdhuiIso();
  const veille = plusJours(aujourdhui, -1);
  const date = (
    champ: keyof SaisieDeLaDeclaration & string,
    { min, max }: { min?: string; max?: string } = {},
  ) => ({
    ...texte(champ),
    type: 'date',
    min: min || undefined,
    max: max || undefined,
    'aria-invalid': erreurDe(champ) ? true : undefined,
    className: cn(CADRE, 'tabular-nums'),
  });
  /** Une liste à choisir : son libellé, ses options. */
  const liste = <K extends keyof SaisieDeLaDeclaration & string>(
    champ: K,
    libelle: string,
    options: readonly (readonly [string, string])[],
    choisir = 'Choisir',
  ) => (
    <Field label={libelle} htmlFor={`${id}-${champ}`} required>
      <Select
        id={`${id}-${champ}`}
        aria-label={libelle}
        value={String(valeur[champ])}
        onChange={(e) => poser({ [champ]: e.target.value } as Partial<SaisieDeLaDeclaration>)}
        className={CADRE}
      >
        <option value="" hidden>
          {choisir}
        </option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
  /** Un nom d'une liste, épouse ou enfant : la capitale à chaque mot, à la frappe. */
  const nomDeLaListe = (champ: 'conjoints' | 'enfants', i: number, libelle: string) => (
    <Field key={`${champ}-${i}`} label={libelle} htmlFor={`${id}-${champ}-${i}`} required>
      <Input
        id={`${id}-${champ}-${i}`}
        value={valeur[champ][i] ?? ''}
        maxLength={120}
        autoCapitalize="words"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const noms = [...valeur[champ]];
          noms[i] = majusculesInitiales(e.target.value);
          poser({ [champ]: noms });
        }}
        className={CADRE}
      />
    </Field>
  );
  /** Des caractères en capitales, sans espace : le numéro d'une carte d'identité étrangère. */
  const codeEnCapitales = (champ: 'cni', max: number) => ({
    ...texte(champ, max),
    autoComplete: 'off',
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      poser({ [champ]: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() }),
    className: cn(CADRE, 'uppercase tabular-nums'),
  });

  const pays = COUNTRIES.map((c) => [c.code, c.name] as const);
  const etat = maritalLabelsFor(
    valeur.civilite === 'madame' ? 'female' : valeur.civilite === 'monsieur' ? 'male' : null,
  );
  const aNommer = conjointsANommer(valeur);
  const enfants = Number(valeur.nombreDEnfants || 0);
  const service = valeur.serviceMilitaire === 'oui';

  return (
    <>
      <Groupe titre="Renseigner le mouvement">
        {liste('nature', 'Mouvement', [
          ['embauche', 'Embauche'],
          ['depart', 'Départ'],
          ['changement', 'Changement de situation'],
        ])}
        {valeur.nature === 'depart'
          ? liste(
              'depart',
              'Motif du départ',
              DEPARTS_DU_TRAVAILLEUR.map((d) => [d, MOUVEMENTS_DU_TRAVAILLEUR[d]] as const),
            )
          : null}
        {valeur.nature === 'changement' ? (
          <fieldset className="min-w-0 sm:col-span-2">
            <legend className="mb-1.5 block text-sm font-medium text-ink-strong">
              Changements<span className="text-danger"> *</span>
            </legend>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              {CHANGEMENTS_DU_TRAVAILLEUR.map((c) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-ink-strong"
                >
                  <Checkbox
                    checked={valeur.changements.includes(c)}
                    onChange={(e) =>
                      poser({
                        changements: e.target.checked
                          ? [...valeur.changements, c]
                          : valeur.changements.filter((x) => x !== c),
                      })
                    }
                  />
                  {MOUVEMENTS_DU_TRAVAILLEUR[c]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {valeur.nature === 'depart' ? (
          <Field
            label="Date de départ de l’établissement"
            htmlFor={`${id}-effetLe`}
            required
            error={erreurDe('effetLe')}
          >
            <Input {...date('effetLe', { min: valeur.entreeLe })} />
          </Field>
        ) : null}
        {valeur.nature === 'changement' ? (
          <Field
            label="Date d’effet"
            htmlFor={`${id}-effetLe`}
            required
            error={erreurDe('effetLe')}
          >
            <Input {...date('effetLe', { min: valeur.entreeLe })} />
          </Field>
        ) : null}
        <ChampDeLImmatriculation
          id={`${id}-immatriculation`}
          chiffres={valeur.immatriculation}
          onSaisir={(immatriculation) => poser({ immatriculation })}
        />
        <Field label="Catégorie d’enregistrement" htmlFor={`${id}-categorieDEnregistrement`}>
          <Select
            id={`${id}-categorieDEnregistrement`}
            aria-label="Catégorie d’enregistrement"
            value={valeur.categorieDEnregistrement}
            onChange={(e) =>
              poser({
                categorieDEnregistrement: e.target
                  .value as SaisieDeLaDeclaration['categorieDEnregistrement'],
              })
            }
            className={CADRE}
          >
            <option value="">Aucune</option>
            {CATEGORIES_D_ENREGISTREMENT.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </Groupe>

      <Groupe titre="Renseigner l’état civil">
        <ChampDeLaCivilite
          id={`${id}-civilite`}
          civilite={valeur.civilite}
          onSaisir={(civilite) => poser({ civilite })}
        />
        <Field label="Prénom(s)" htmlFor={`${id}-prenom`} required>
          <Input {...nomPropre('prenom', 120)} />
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required>
          <Input {...nomPropre('nom')} />
        </Field>
        <Field
          label="Date de naissance"
          htmlFor={`${id}-naissanceLe`}
          required
          error={erreurDe('naissanceLe')}
        >
          <Input {...date('naissanceLe', { max: neAuPlusTard() })} />
        </Field>
        <Field label="Lieu de naissance" htmlFor={`${id}-naissanceA`} required>
          <Input {...lieu('naissanceA', 120)} />
        </Field>
        {liste('naissancePays', 'Pays de naissance', pays, 'Choisir un pays')}
        {liste('nationalite', 'Nationalité', pays, 'Choisir un pays')}
        <Field label="Prénom du père" htmlFor={`${id}-perePrenom`} required>
          <Input {...nomPropre('perePrenom')} />
        </Field>
        <Field label="Prénom de la mère" htmlFor={`${id}-merePrenom`} required>
          <Input {...nomPropre('merePrenom')} />
        </Field>
        <Field label="Nom de la mère" htmlFor={`${id}-mereNom`} required>
          <Input {...nomPropre('mereNom')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Adresse" htmlFor={`${id}-adresse`} required>
            <Input {...lieu('adresse', 200)} />
          </Field>
        </div>
        {etrangere(valeur) ? (
          <Field label="N° de la carte d’identité" htmlFor={`${id}-cni`} required>
            <Input {...codeEnCapitales('cni', 20)} />
          </Field>
        ) : (
          <ChampDeLaCNI id={`${id}-cni`} cni={valeur.cni} onSaisir={(cni) => poser({ cni })} />
        )}
        <Field
          label="Date de délivrance"
          htmlFor={`${id}-cniDelivreeLe`}
          required
          error={erreurDe('cniDelivreeLe')}
        >
          <Input
            {...date('cniDelivreeLe', {
              min: etrangere(valeur) ? valeur.naissanceLe : cniDelivreeAuPlusTot(),
              max: aujourdhui,
            })}
          />
        </Field>
        <Field label="Lieu de délivrance" htmlFor={`${id}-cniDelivreeA`} required>
          <Input {...lieu('cniDelivreeA', 120)} />
        </Field>
        <Field label="Autorité de délivrance" htmlFor={`${id}-cniDelivreePar`} required>
          <Input {...intitule('cniDelivreePar', 120)} />
        </Field>
        <Field label="N° d’immatriculation à la CSS" htmlFor={`${id}-css`}>
          <Input {...texte('css', 30)} className={cn(CADRE, 'tabular-nums')} />
        </Field>
        <Field label="N° d’immatriculation à l’IPRES" htmlFor={`${id}-ipres`}>
          <Input {...texte('ipres', 30)} className={cn(CADRE, 'tabular-nums')} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner la situation de famille">
        {liste(
          'situationDeFamille',
          'Situation de famille',
          (Object.keys(ETAT_CIVIL) as SituationDeFamille[]).map(
            (s) => [s, etat[ETAT_CIVIL[s]]!] as const,
          ),
        )}
        {valeur.situationDeFamille === 'marie' && valeur.civilite === 'monsieur'
          ? liste(
              'epouses',
              'Nombre d’épouses',
              Array.from(
                { length: EPOUSES_MAX },
                (_, i) => [String(i + 1), String(i + 1)] as const,
              ),
            )
          : null}
        {Array.from({ length: aNommer }, (_, i) =>
          nomDeLaListe(
            'conjoints',
            i,
            valeur.civilite === 'madame'
              ? 'Prénom et nom de l’époux'
              : aNommer === 1
                ? 'Prénom et nom de l’épouse'
                : `Prénom et nom de l’épouse ${i + 1}`,
          ),
        )}
        {liste(
          'nombreDEnfants',
          'Nombre d’enfants à charge',
          Array.from(
            { length: ENFANTS_MAX + 1 },
            (_, i) => [String(i), i === 0 ? 'Aucun' : String(i)] as const,
          ),
        )}
        {Array.from({ length: enfants }, (_, i) =>
          nomDeLaListe(
            'enfants',
            i,
            enfants === 1 ? 'Prénom et nom de l’enfant' : `Prénom et nom de l’enfant ${i + 1}`,
          ),
        )}
      </Groupe>

      <Groupe titre="Renseigner l’emploi">
        <Field
          label="Date d’entrée dans l’établissement"
          htmlFor={`${id}-entreeLe`}
          required
          error={erreurDe('entreeLe')}
        >
          <Input {...date('entreeLe', { max: veille })} />
        </Field>
        <Field label="Date du contrat" htmlFor={`${id}-contratLe`} error={erreurDe('contratLe')}>
          <Input {...date('contratLe', { max: veille })} />
        </Field>
        {valeur.nature === 'depart' || valeur.nature === 'changement' ? (
          <>
            <Field label="N° de la déclaration d’embauche" htmlFor={`${id}-declarationNumero`}>
              <Input {...texte('declarationNumero', 30)} />
            </Field>
            <Field
              label="Date de la déclaration d’embauche"
              htmlFor={`${id}-declarationLe`}
              error={erreurDe('declarationLe')}
            >
              <Input {...date('declarationLe', { max: aujourdhui })} />
            </Field>
          </>
        ) : null}
        <Field label="Profession" htmlFor={`${id}-profession`} required>
          <Input {...intitule('profession', 120)} />
        </Field>
        <Field label="Emploi dans l’établissement" htmlFor={`${id}-emploi`} required>
          <Input {...intitule('emploi', 120)} />
        </Field>
        <Field label="Catégorie" htmlFor={`${id}-categorie`} required>
          <Input {...texte('categorie', CATEGORIE_MAX)} className={cn(CADRE, 'uppercase')} />
        </Field>
        {liste('contrat', 'Type de contrat', [
          ['cdd', 'Contrat à durée déterminée'],
          ['cdi', 'Contrat à durée indéterminée'],
          ['chantier', 'Contrat de chantier'],
        ])}
        {valeur.contrat === 'cdd' ? (
          <>
            <Field label="Début du contrat" htmlFor={`${id}-cddDu`} required>
              <Input {...date('cddDu')} />
            </Field>
            <Field
              label="Fin du contrat"
              htmlFor={`${id}-cddAu`}
              required
              error={erreurDe('cddAu')}
            >
              <Input {...date('cddAu', { min: valeur.cddDu })} />
            </Field>
          </>
        ) : null}
        {valeur.contrat === 'chantier' ? (
          <Field label="Chantier de" htmlFor={`${id}-chantier`} required>
            <Input {...texte('chantier', 120)} />
          </Field>
        ) : null}
        <Field label="N° du visa d’approbation" htmlFor={`${id}-visaNumero`}>
          <Input {...texte('visaNumero', 30)} />
        </Field>
        <Field
          label="Date du visa d’approbation"
          htmlFor={`${id}-visaLe`}
          error={erreurDe('visaLe')}
        >
          <Input {...date('visaLe', { min: valeur.contratLe, max: aujourdhui })} />
        </Field>
        <Field label="N° du visa d’enregistrement" htmlFor={`${id}-enregistrementNumero`}>
          <Input {...texte('enregistrementNumero', 30)} />
        </Field>
        <Field
          label="Date du visa d’enregistrement"
          htmlFor={`${id}-enregistrementLe`}
          error={erreurDe('enregistrementLe')}
        >
          <Input {...date('enregistrementLe', { min: valeur.contratLe, max: aujourdhui })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Nom et adresse du précédent employeur" htmlFor={`${id}-precedentEmployeur`}>
            <Input {...texte('precedentEmployeur', 200)} />
          </Field>
        </div>
        <Field label="Lieu de résidence habituel" htmlFor={`${id}-residence`} required>
          <Input {...lieu('residence', 120)} />
        </Field>
        {etrangere(valeur) ? (
          <Field
            label="Date d’entrée au Sénégal"
            htmlFor={`${id}-entreeAuSenegalLe`}
            required
            error={erreurDe('entreeAuSenegalLe')}
          >
            <Input
              {...date('entreeAuSenegalLe', {
                min: valeur.naissanceLe,
                max: valeur.entreeLe && valeur.entreeLe < aujourdhui ? valeur.entreeLe : aujourdhui,
              })}
            />
          </Field>
        ) : null}
      </Groupe>

      <Groupe titre="Renseigner le statut militaire">
        {liste('serviceMilitaire', 'Service militaire effectué', [
          ['oui', 'Oui'],
          ['non', 'Non'],
        ])}
        {service ? (
          <>
            <Field
              label="Classe de recrutement"
              htmlFor={`${id}-classeDeRecrutement`}
              required
              error={erreurDe('classeDeRecrutement')}
            >
              <Input
                {...texte('classeDeRecrutement', 4)}
                aria-invalid={erreurDe('classeDeRecrutement') ? true : undefined}
                inputMode="numeric"
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  poser({ classeDeRecrutement: e.target.value.replace(/\D/g, '') })
                }
                className={cn(CADRE, 'tabular-nums')}
              />
            </Field>
            {liste('armee', 'Armée d’appartenance', [
              ['terre', 'Terre'],
              ['air', 'Air'],
              ['mer', 'Mer'],
            ])}
            {liste('grade', 'Grade dans la réserve', [
              ['officier', 'Officier'],
              ['sous_officier', 'Sous-officier'],
              ['troupe', 'Troupe'],
            ])}
          </>
        ) : null}
      </Groupe>

      <Groupe titre="Renseigner les dispositions particulières">
        {liste(
          'horaire',
          'Horaire de travail hebdomadaire',
          HORAIRES_HEBDOMADAIRES.map((h) => [String(h), `${h} heures`] as const),
        )}
        <ChampDuMontant
          id={`${id}-salaire`}
          libelle="Salaire mensuel"
          montant={valeur.salaire}
          onSaisir={(salaire) => poser({ salaire })}
        />
        {valeur.dispositions.map((d, i) => (
          <div key={i} className="sm:col-span-2">
            <Field label={`Disposition ${i + 2}`} htmlFor={`${id}-disposition-${i}`}>
              <Input
                id={`${id}-disposition-${i}`}
                value={d}
                maxLength={DISPOSITION_MAX}
                onChange={(e) =>
                  poser({
                    dispositions: valeur.dispositions.map((x, j) => (j === i ? e.target.value : x)),
                  })
                }
                className={CADRE}
              />
            </Field>
          </div>
        ))}
      </Groupe>
    </>
  );
}

/**
 * Le numéro au fichier central de la main-d'œuvre : dix chiffres, facultatif
 * tant que la personne n'est pas immatriculée. Quitté incomplet, il le dit.
 */
function ChampDeLImmatriculation({
  id,
  chiffres,
  onSaisir,
}: {
  id: string;
  chiffres: string;
  onSaisir: (chiffres: string) => void;
}) {
  const [quitte, setQuitte] = useState(false);
  const champ = champDeChiffres({
    chiffres,
    max: CHIFFRES_DE_L_IMMATRICULATION,
    grouper: (c) => c,
    onSaisir,
  });
  const incomplet =
    quitte && chiffres.length > 0 && chiffres.length < CHIFFRES_DE_L_IMMATRICULATION;
  return (
    <Field
      label="N° d’immatriculation au FCMO"
      htmlFor={id}
      error={incomplet ? 'Dix chiffres attendus' : undefined}
    >
      <Input
        {...champ}
        id={id}
        autoComplete="off"
        aria-invalid={incomplet || undefined}
        onBlur={() => setQuitte(true)}
        className={cn(CADRE, 'tabular-nums', incomplet && 'border-danger')}
      />
    </Field>
  );
}
