'use client';

import { useId } from 'react';
import {
  aujourdhuiIso,
  BANQUES,
  datesDeLaDomiciliation,
  ficheDomiciliationSchema,
  type ChampRepris,
  type CodeDeBanque,
  type DossierPourLaFiche,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { ChampsDuRib } from './champs-du-rib';
import {
  CADRE,
  champsDeTexte,
  ChampDeLaCivilite,
  ChampDuMontant,
  ChampFige,
  Groupe,
  jourEcrit,
  reglesEnfreintes,
} from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour une domiciliation bancaire (ADR-0102) : la
   personne, sa fonction, son contrat et le jour où il a commencé, sa banque
   et le genre de qui la dirige, son RIB, son salaire mensuel net, le jour de
   sa demande. Tout est obligatoire. L'agent se choisit d'abord : son dossier
   remplit la personne, et la banque et le RIB quand il les porte (ADR-0174) ;
   tout se corrige. Le RIB saisi à la main se saisit deux fois, comme un mot
   de passe : validé, le premier se masque ; le second se tape, sans coller,
   et doit être le même. La domiciliation tient en deux lignes (ADR-0168) :
   la banque, son destinataire et la date de la demande ; puis le RIB, sa
   confirmation et le salaire versé sur le compte.
*/

/** La fiche telle qu'elle se tape ; une date, au format AAAA-MM-JJ. */
export type SaisieDeLaDomiciliation = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  poste: string;
  debut: string;
  contrat: '' | 'cdd' | 'cdi';
  demandeLe: string;
  banque: '' | CodeDeBanque;
  destinataire: '' | 'directeur_general' | 'directrice_generale';
  /** Les chiffres du RIB après « SN », à la première saisie. */
  rib: string;
  /** La première saisie validée, et masquée. */
  ribValide: boolean;
  /** La seconde saisie, qui doit être la même. */
  confirmation: string;
  salaire: number | null;
};

export const DOMICILIATION_VIDE: SaisieDeLaDomiciliation = {
  civilite: '',
  prenom: '',
  nom: '',
  poste: '',
  debut: '',
  contrat: '',
  demandeLe: '',
  banque: '',
  destinataire: '',
  rib: '',
  ribValide: false,
  confirmation: '',
  salaire: null,
};

/**
 * La fiche d'un agent choisi, d'après son dossier (ADR-0174) : la personne,
 * sa fonction et son contrat ; sa banque et son RIB, s'il les porte, sinon
 * ceux déjà saisis. Un RIB du dossier n'a pas à se retaper : il arrive validé
 * et confirmé. La demande, le destinataire et le salaire restent à saisir.
 */
export function domiciliationDepuisLeDossier(
  s: SaisieDeLaDomiciliation,
  d: DossierPourLaFiche,
): SaisieDeLaDomiciliation {
  const rib = d.rib?.replace(/^SN/, '');
  return {
    ...s,
    civilite: d.civilite ?? '',
    prenom: d.prenom,
    nom: d.nom,
    poste: d.poste ?? '',
    debut: d.debut,
    contrat: d.contrat,
    banque: d.banque ?? s.banque,
    ...(rib ? { rib, ribValide: true, confirmation: rib } : {}),
  };
}

/**
 * La fiche telle que l'API la valide (`ficheDomiciliationSchema`) : les
 * blancs ôtés ; une liste pas encore choisie, un montant pas encore saisi,
 * absents. Le RIB ne part qu'une fois saisi deux fois à l'identique.
 */
export function versLaFicheDeLaDomiciliation(s: SaisieDeLaDomiciliation) {
  return {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    poste: s.poste.trim(),
    debut: s.debut,
    contrat: s.contrat || undefined,
    demandeLe: s.demandeLe,
    banque: s.banque || undefined,
    destinataire: s.destinataire || undefined,
    rib: s.ribValide && s.confirmation === s.rib ? `SN${s.rib}` : undefined,
    salaire: s.salaire ?? undefined,
  };
}

export function FicheDeLaDomiciliation({
  valeur,
  figes = [],
  onChange,
}: {
  valeur: SaisieDeLaDomiciliation;
  /** Ce que la demande et le dossier de l'agent donnent : figé (ADR-0190). */
  figes?: readonly ChampRepris[];
  onChange: (valeur: SaisieDeLaDomiciliation) => void;
}) {
  const id = useId();
  const fige = (champ: ChampRepris) => figes.includes(champ);
  const poser = (champ: Partial<SaisieDeLaDomiciliation>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, intitule } = champsDeTexte(id, valeur, poser);
  // Les règles des dates, dites sous les champs (ADR-0133) : le contrat a
  // commencé, la demande ne vient ni avant lui, ni après aujourd'hui.
  const fiche = versLaFicheDeLaDomiciliation(valeur);
  const erreurs = reglesEnfreintes(
    fiche,
    ficheDomiciliationSchema.safeParse(fiche).error?.issues,
    datesDeLaDomiciliation(fiche),
  );
  const date = (champ: 'debut' | 'demandeLe', min?: string) => ({
    ...texte(champ),
    type: 'date',
    min: min || undefined,
    max: aujourdhuiIso(),
    'aria-invalid': erreurs[champ] ? true : undefined,
    className: cn(CADRE, 'tabular-nums'),
  });

  return (
    <>
      <Groupe titre="Renseigner l’agent">
        <ChampDeLaCivilite
          id={`${id}-civilite`}
          civilite={valeur.civilite}
          fige={fige('civilite')}
          onSaisir={(civilite) => poser({ civilite })}
        />
        <Field label="Prénom" htmlFor={`${id}-prenom`} required={!fige('prenom')}>
          {fige('prenom') ? (
            <ChampFige id={`${id}-prenom`} valeur={valeur.prenom} />
          ) : (
            <Input {...nomPropre('prenom')} />
          )}
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required={!fige('nom')}>
          {fige('nom') ? (
            <ChampFige id={`${id}-nom`} valeur={valeur.nom} />
          ) : (
            <Input {...nomPropre('nom')} />
          )}
        </Field>
        <Field label="Fonction" htmlFor={`${id}-poste`} required={!fige('poste')}>
          {fige('poste') ? (
            <ChampFige id={`${id}-poste`} valeur={valeur.poste} />
          ) : (
            <Input {...intitule('poste', 120)} />
          )}
        </Field>
        <Field label="Type de contrat" htmlFor={`${id}-contrat`} required={!fige('contrat')}>
          {fige('contrat') ? (
            <ChampFige
              id={`${id}-contrat`}
              valeur={
                valeur.contrat === 'cdd'
                  ? 'Contrat à durée déterminée'
                  : 'Contrat à durée indéterminée'
              }
            />
          ) : (
            <Select
              id={`${id}-contrat`}
              aria-label="Type de contrat"
              value={valeur.contrat}
              onChange={(e) =>
                poser({ contrat: e.target.value as SaisieDeLaDomiciliation['contrat'] })
              }
              className={CADRE}
            >
              <option value="" hidden>
                Choisir
              </option>
              <option value="cdd">Contrat à durée déterminée</option>
              <option value="cdi">Contrat à durée indéterminée</option>
            </Select>
          )}
        </Field>
        <Field
          label="Date de début du contrat"
          htmlFor={`${id}-debut`}
          required={!fige('debut')}
          error={erreurs.debut}
        >
          {fige('debut') ? (
            <ChampFige id={`${id}-debut`} valeur={jourEcrit(valeur.debut)} />
          ) : (
            <Input {...date('debut')} />
          )}
        </Field>
      </Groupe>

      <Groupe titre="Renseigner la domiciliation">
        <Field label="Banque" htmlFor={`${id}-banque`} required>
          <Select
            id={`${id}-banque`}
            aria-label="Banque"
            value={valeur.banque}
            onChange={(e) => poser({ banque: e.target.value as CodeDeBanque })}
            className={CADRE}
          >
            <option value="" hidden>
              Choisir une banque
            </option>
            {BANQUES.map((b) => (
              <option key={b.code} value={b.code}>
                {b.nom}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Destinataire de la lettre" htmlFor={`${id}-destinataire`} required>
          <Select
            id={`${id}-destinataire`}
            aria-label="Destinataire de la lettre"
            value={valeur.destinataire}
            onChange={(e) =>
              poser({
                destinataire: e.target.value as SaisieDeLaDomiciliation['destinataire'],
              })
            }
            className={CADRE}
          >
            <option value="" hidden>
              Choisir
            </option>
            <option value="directeur_general">Directeur Général</option>
            <option value="directrice_generale">Directrice Générale</option>
          </Select>
        </Field>
        <Field
          label="Date de la demande de domiciliation"
          htmlFor={`${id}-demandeLe`}
          required={!fige('demandeLe')}
          error={erreurs.demandeLe}
        >
          {fige('demandeLe') ? (
            <ChampFige id={`${id}-demandeLe`} valeur={jourEcrit(valeur.demandeLe)} />
          ) : (
            <Input {...date('demandeLe', valeur.debut)} />
          )}
        </Field>
        <ChampsDuRib
          id={id}
          rib={valeur.rib}
          valide={valeur.ribValide}
          confirmation={valeur.confirmation}
          classeDuChamp={CADRE}
          onSaisir={poser}
        />
        <ChampDuMontant
          id={`${id}-salaire`}
          libelle="Salaire mensuel net"
          montant={valeur.salaire}
          onSaisir={(salaire) => poser({ salaire })}
        />
      </Groupe>
    </>
  );
}
