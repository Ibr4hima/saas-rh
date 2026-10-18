'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DecisionDeDisponibilite, OrgUnitView } from '@teranga/contracts';
import {
  DUREE_DE_PROROGATION_MAX,
  orgUnitLabel,
  repriseApresProrogation,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { api } from '../lib/api';
import { CADRE, champsDeTexte, ChampDeLaCivilite, ChampDeLaDuree, Groupe } from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour une décision de disponibilité (ADR-0100) : qui
   la demande et quand, les dates de la disponibilité, celles des sessions du
   conseil d'administration qui ont nommé à la direction générale et à la
   direction générale adjointe. Tout est obligatoire. Le renouvellement y
   ajoute l'affectation, la période fixée d'abord et la durée de sa
   prorogation : la date de reprise s'en déduit, et se corrige.
*/

/** La fiche telle qu'elle se tape ; une date, au format AAAA-MM-JJ. */
export type SaisieDeLaDecision = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  poste: string;
  /** L'unité de l'organigramme, pour un renouvellement. */
  affectation: string;
  demandeLe: string;
  effetLe: string;
  initialementDu: string;
  initialementAu: string;
  duree: string;
  repriseLe: string;
  pvDirectionGeneraleLe: string;
  pvDirectionGeneraleAdjointeLe: string;
};

export const DECISION_VIDE: SaisieDeLaDecision = {
  civilite: '',
  prenom: '',
  nom: '',
  poste: '',
  affectation: '',
  demandeLe: '',
  effetLe: '',
  initialementDu: '',
  initialementAu: '',
  duree: '',
  repriseLe: '',
  pvDirectionGeneraleLe: '',
  pvDirectionGeneraleAdjointeLe: '',
};

/**
 * La fiche telle que l'API la valide (`ficheDisponibiliteSchema`,
 * `ficheRenouvellementSchema`) : les blancs ôtés ; une liste pas encore
 * choisie, absente. Chaque décision ne prend que ses champs.
 */
export function versLaFicheDeLaDecision(s: SaisieDeLaDecision, doc: DecisionDeDisponibilite) {
  const commun = {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    poste: s.poste.trim(),
    demandeLe: s.demandeLe,
    pvDirectionGeneraleLe: s.pvDirectionGeneraleLe,
    pvDirectionGeneraleAdjointeLe: s.pvDirectionGeneraleAdjointeLe,
    repriseLe: s.repriseLe,
  };
  return doc === 'decision_disponibilite'
    ? { ...commun, effetLe: s.effetLe }
    : {
        ...commun,
        affectation: s.affectation || undefined,
        initialementDu: s.initialementDu,
        initialementAu: s.initialementAu,
        duree: s.duree ? Number(s.duree) : undefined,
      };
}

/** Le lendemain d'une date saisie : la première date qu'un champ qui la suit accepte. */
function lendemain(jour: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return undefined;
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Les unités, par ordre alphabétique de leur libellé. */
const parLibelle = (unites: OrgUnitView[]) =>
  [...unites].sort((a, b) => orgUnitLabel(a).localeCompare(orgUnitLabel(b), 'fr'));

export function FicheDeLaDecision({
  doc,
  valeur,
  onChange,
}: {
  doc: DecisionDeDisponibilite;
  valeur: SaisieDeLaDecision;
  onChange: (valeur: SaisieDeLaDecision) => void;
}) {
  const id = useId();
  const renouvellement = doc === 'decision_renouvellement_disponibilite';
  const poser = (champ: Partial<SaisieDeLaDecision>) => {
    const suivante = { ...valeur, ...champ };
    // La reprise suit la fin de la période initiale et la prorogation : elle
    // se déduit des deux, et se corrige ensuite à la main.
    if (
      renouvellement &&
      ('initialementAu' in champ || 'duree' in champ) &&
      lendemain(suivante.initialementAu) &&
      suivante.duree
    ) {
      suivante.repriseLe = repriseApresProrogation(suivante.initialementAu, Number(suivante.duree));
    }
    onChange(suivante);
  };
  const { texte, nomPropre, intitule } = champsDeTexte(id, valeur, poser);
  const unites = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
    enabled: renouvellement,
  });
  const date = (champ: keyof SaisieDeLaDecision, min?: string) => ({
    ...texte(champ),
    type: 'date',
    min,
    className: cn(CADRE, 'tabular-nums'),
  });

  // La reprise suit la prise d'effet, ou la période initiale ; sa fin suit son début.
  const debutDeLaReprise = lendemain(renouvellement ? valeur.initialementAu : valeur.effetLe);
  const repriseTot =
    debutDeLaReprise !== undefined &&
    valeur.repriseLe !== '' &&
    valeur.repriseLe < debutDeLaReprise;
  const finTot =
    renouvellement &&
    valeur.initialementDu !== '' &&
    valeur.initialementAu !== '' &&
    valeur.initialementAu < valeur.initialementDu;

  return (
    <>
      <Groupe titre="Renseigner la demande">
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
        <Field label="Poste" htmlFor={`${id}-poste`} required>
          <Input {...intitule('poste', 120)} />
        </Field>
        {renouvellement ? (
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
        ) : null}
        <Field label="Date de la demande" htmlFor={`${id}-demandeLe`} required>
          <Input {...date('demandeLe')} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner la disponibilité">
        {renouvellement ? (
          <>
            <Field
              label="Début de la disponibilité initiale"
              htmlFor={`${id}-initialementDu`}
              required
            >
              <Input {...date('initialementDu')} />
            </Field>
            <Field
              label="Fin de la disponibilité initiale"
              htmlFor={`${id}-initialementAu`}
              required
              error={finTot ? 'La fin suit le début' : undefined}
            >
              <Input
                {...date('initialementAu', valeur.initialementDu || undefined)}
                aria-invalid={finTot || undefined}
              />
            </Field>
            <ChampDeLaDuree
              id={`${id}-duree`}
              libelle="Durée de la prorogation"
              mois={valeur.duree}
              max={DUREE_DE_PROROGATION_MAX}
              fin={null}
              onSaisir={(duree) => poser({ duree })}
            />
          </>
        ) : (
          <Field label="Date de prise d’effet" htmlFor={`${id}-effetLe`} required>
            <Input {...date('effetLe')} />
          </Field>
        )}
        <Field
          label="Date limite de reprise"
          htmlFor={`${id}-repriseLe`}
          required
          error={
            repriseTot
              ? renouvellement
                ? 'La reprise suit la période initiale'
                : 'La reprise suit la prise d’effet'
              : undefined
          }
        >
          <Input {...date('repriseLe', debutDeLaReprise)} aria-invalid={repriseTot || undefined} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner les sessions du conseil d’administration">
        <Field
          label="Nomination à la Direction Générale"
          htmlFor={`${id}-pvDirectionGeneraleLe`}
          required
        >
          <Input {...date('pvDirectionGeneraleLe')} />
        </Field>
        <Field
          label="Nomination à la Direction Générale Adjointe"
          htmlFor={`${id}-pvDirectionGeneraleAdjointeLe`}
          required
        >
          <Input {...date('pvDirectionGeneraleAdjointeLe')} />
        </Field>
      </Groupe>
    </>
  );
}
