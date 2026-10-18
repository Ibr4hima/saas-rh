'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BANQUES, ribGroupe, type CodeDeBanque } from '@teranga/contracts';
import { Button, cn, Field, Input, Select } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';
import { CADRE, champsDeTexte, ChampDeLaCivilite, ChampDuMontant, Groupe } from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour une domiciliation bancaire (ADR-0102) : la
   personne, sa fonction, son contrat et le jour où il a commencé, sa banque
   et le genre de qui la dirige, son RIB, son salaire mensuel net, le jour de
   sa demande. Tout est obligatoire. Le RIB se saisit deux fois, comme un mot
   de passe : validé, le premier se masque ; le second se tape, sans coller,
   et doit être le même.
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

/** Un RIB : « SN », déjà écrit, puis vingt-deux chiffres. */
const CHIFFRES_DU_RIB = 22;

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
  onChange,
}: {
  valeur: SaisieDeLaDomiciliation;
  onChange: (valeur: SaisieDeLaDomiciliation) => void;
}) {
  const id = useId();
  const poser = (champ: Partial<SaisieDeLaDomiciliation>) => onChange({ ...valeur, ...champ });
  const { texte, nomPropre, intitule } = champsDeTexte(id, valeur, poser);
  const date = (champ: 'debut' | 'demandeLe') => ({
    ...texte(champ),
    type: 'date',
    className: cn(CADRE, 'tabular-nums'),
  });

  return (
    <>
      <Groupe titre="Renseigner l’agent">
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
        <Field label="Fonction" htmlFor={`${id}-poste`} required>
          <Input {...intitule('poste', 120)} />
        </Field>
        <Field label="Type de contrat" htmlFor={`${id}-contrat`} required>
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
        </Field>
        <Field label="Date de début du contrat" htmlFor={`${id}-debut`} required>
          <Input {...date('debut')} />
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
        <Field label="Destinataire" htmlFor={`${id}-destinataire`} required>
          <Select
            id={`${id}-destinataire`}
            aria-label="Destinataire"
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
        <ChampsDuRib
          id={id}
          rib={valeur.rib}
          valide={valeur.ribValide}
          confirmation={valeur.confirmation}
          onSaisir={poser}
        />
        <ChampDuMontant
          id={`${id}-salaire`}
          libelle="Salaire mensuel net"
          montant={valeur.salaire}
          onSaisir={(salaire) => poser({ salaire })}
        />
        <Field label="Date de la demande" htmlFor={`${id}-demandeLe`} required>
          <Input {...date('demandeLe')} />
        </Field>
      </Groupe>
    </>
  );
}

/**
 * Le RIB, saisi deux fois comme un mot de passe : « SN » est déjà écrit, les
 * chiffres se groupent à la frappe comme sur le relevé (« SN012 01001
 * 036123456789 54 »). « Valider » masque le premier et ouvre le second, qui
 * se tape : coller y est refusé, pour qu'une erreur de la première saisie ne
 * s'y recopie pas. « Modifier » rouvre le premier et vide le second.
 */
function ChampsDuRib({
  id,
  rib,
  valide,
  confirmation,
  onSaisir,
}: {
  id: string;
  rib: string;
  valide: boolean;
  confirmation: string;
  onSaisir: (champ: Partial<SaisieDeLaDomiciliation>) => void;
}) {
  const premier = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  // Le champ à rejoindre une fois la page repeinte : le second s'ouvre à la
  // validation, le premier à la modification.
  const aRejoindre = useRef<'premier' | 'second' | null>(null);
  useEffect(() => {
    if (aRejoindre.current) (aRejoindre.current === 'second' ? second : premier).current?.focus();
    aRejoindre.current = null;
  });
  const [signale, setSignale] = useState(false);
  const [secondQuitte, setSecondQuitte] = useState(false);

  const incomplet = signale && !valide && rib.length < CHIFFRES_DU_RIB;
  const differe = valide && confirmation.length === CHIFFRES_DU_RIB && confirmation !== rib;
  const secondIncomplet =
    secondQuitte && confirmation.length > 0 && confirmation.length < CHIFFRES_DU_RIB;

  const valider = () => {
    if (rib.length < CHIFFRES_DU_RIB) {
      setSignale(true);
      return;
    }
    aRejoindre.current = 'second';
    onSaisir({ ribValide: true });
  };
  const modifier = () => {
    aRejoindre.current = 'premier';
    setSecondQuitte(false);
    onSaisir({ ribValide: false, confirmation: '' });
  };
  const chiffres = (saisis: string, poser: (c: string) => void) =>
    champDeChiffres({
      chiffres: saisis,
      max: CHIFFRES_DU_RIB,
      grouper: (c) => ribGroupe(`SN${c}`),
      onSaisir: poser,
    });

  return (
    <>
      <Field
        label="RIB"
        htmlFor={`${id}-rib`}
        required
        error={incomplet ? 'Vingt-quatre caractères attendus' : undefined}
      >
        <div className="flex gap-2">
          {valide ? (
            <Input
              ref={premier}
              id={`${id}-rib`}
              readOnly
              value={ribGroupe(`SN${'•'.repeat(rib.length)}`)}
              className={cn(CADRE, 'min-w-0 flex-1 tabular-nums')}
            />
          ) : (
            <Input
              {...chiffres(rib, (c) => onSaisir({ rib: c }))}
              ref={premier}
              id={`${id}-rib`}
              autoComplete="off"
              aria-invalid={incomplet || undefined}
              aria-describedby={incomplet ? `${id}-rib-message` : undefined}
              onBlur={() => {
                if (rib.length > 0) setSignale(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  valider();
                }
              }}
              className={cn(CADRE, 'min-w-0 flex-1 tabular-nums', incomplet && 'border-danger')}
            />
          )}
          <Button
            variant="secondary"
            onClick={valide ? modifier : valider}
            className="h-9 shrink-0"
          >
            {valide ? 'Modifier' : 'Valider'}
          </Button>
        </div>
      </Field>
      <Field
        label="Confirmation du RIB"
        htmlFor={`${id}-confirmation`}
        required
        error={
          differe
            ? 'Les deux saisies diffèrent'
            : secondIncomplet
              ? 'Vingt-quatre caractères attendus'
              : undefined
        }
      >
        <Input
          {...chiffres(confirmation, (c) => onSaisir({ confirmation: c }))}
          ref={second}
          id={`${id}-confirmation`}
          disabled={!valide}
          autoComplete="off"
          aria-invalid={differe || secondIncomplet || undefined}
          // Le second RIB se tape : rien ne s'y colle ni ne s'y dépose.
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          onBlur={() => setSecondQuitte(true)}
          className={cn(CADRE, 'tabular-nums', (differe || secondIncomplet) && 'border-danger')}
        />
      </Field>
    </>
  );
}
