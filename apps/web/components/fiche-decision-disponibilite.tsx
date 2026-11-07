'use client';

import { useEffect, useId, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ChampRepris,
  DecisionDeDisponibilite,
  DossierPourLaFiche,
  OrgUnitView,
  PreremplissageDeLaDecision,
} from '@teranga/contracts';
import {
  aujourdhuiIso,
  datesDeLaDisponibilite,
  datesDuRenouvellement,
  DUREE_DE_PROROGATION_MAX,
  estUnJour,
  ficheDeLaDecisionSchema,
  orgUnitLabel,
  repriseApresProrogation,
  repriseAuPlusTard,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { api } from '../lib/api';
import {
  CADRE,
  champsDeTexte,
  ChampDeLaCivilite,
  ChampDeLaDuree,
  ChampFige,
  Groupe,
  jourEcrit,
  reglesEnfreintes,
  SUR_DEUX_COLONNES,
} from './saisie-de-fiche';

/*
   Ce que la DCH renseigne pour une décision de disponibilité (ADR-0100) : qui
   la demande et quand, les dates de la disponibilité, celles des sessions du
   conseil d'administration qui ont nommé à la direction générale et à la
   direction générale adjointe, que l'organisation propose (ADR-0123). Tout
   est obligatoire. L'agent se choisit d'abord : son dossier remplit la
   demande, la personne, son poste et son affectation (ADR-0174) ; tout se
   corrige. Le renouvellement y ajoute l'affectation, la période fixée
   d'abord et la durée de sa prorogation : la date de reprise s'en déduit, et
   se corrige.
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

/**
 * La fiche d'un agent choisi, d'après son dossier (ADR-0174) : la personne,
 * son poste et son affectation. Les dates de la demande restent à saisir ;
 * celles du conseil d'administration, de l'organisation, restent.
 */
export function decisionDepuisLeDossier(
  s: SaisieDeLaDecision,
  d: DossierPourLaFiche,
): SaisieDeLaDecision {
  return {
    ...s,
    civilite: d.civilite ?? '',
    prenom: d.prenom,
    nom: d.nom,
    poste: d.poste ?? '',
    affectation: d.affectation ?? '',
  };
}

/**
 * Les sessions du conseil d'administration en place, que l'organisation
 * connaît (ADR-0123) : elles se posent dans les champs encore vides, la DCH
 * les corrige. La fiche passe d'une décision à l'autre ; une date corrigée le
 * reste. Au titre d'une demande, qui la traite les lit aussi (ADR-0189).
 */
export function usePreremplissageDeLaDecision(
  doc: DecisionDeDisponibilite | null,
  poser: Dispatch<SetStateAction<SaisieDeLaDecision>>,
  demandeId?: string,
) {
  const { data } = useQuery({
    queryKey: ['documents', 'preremplissage', doc, demandeId ?? null],
    queryFn: () =>
      api<PreremplissageDeLaDecision>(
        `/documents/generer/${doc}/preremplissage${demandeId ? `?demande=${demandeId}` : ''}`,
      ),
    enabled: doc !== null,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!data) return;
    poser((s) => ({
      ...s,
      pvDirectionGeneraleLe: s.pvDirectionGeneraleLe || data.pvDirectionGeneraleLe,
      pvDirectionGeneraleAdjointeLe:
        s.pvDirectionGeneraleAdjointeLe || data.pvDirectionGeneraleAdjointeLe,
    }));
  }, [data, poser]);
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
  figes = [],
  onChange,
}: {
  doc: DecisionDeDisponibilite;
  valeur: SaisieDeLaDecision;
  /** Ce que la demande et le dossier de l'agent donnent : figé (ADR-0190). */
  figes?: readonly ChampRepris[];
  onChange: (valeur: SaisieDeLaDecision) => void;
}) {
  const id = useId();
  const fige = (champ: ChampRepris) => figes.includes(champ);
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
  // Les règles des dates, dites sous les champs (ADR-0133, ADR-0136) : la
  // demande et les nominations ne viennent pas après aujourd'hui, la prise
  // d'effet pas avant la demande, la reprise après la prise d'effet ou la
  // période initiale, et au plus deux ans après la prise d'effet (ADR-0172).
  const fiche = versLaFicheDeLaDecision(valeur, doc);
  const erreurs = reglesEnfreintes(
    fiche,
    ficheDeLaDecisionSchema(doc).safeParse(fiche).error?.issues,
    renouvellement ? datesDuRenouvellement(fiche) : datesDeLaDisponibilite(fiche),
  );
  const date = (
    champ: keyof SaisieDeLaDecision,
    { min, max }: { min?: string; max?: string } = {},
  ) => ({
    ...texte(champ),
    type: 'date',
    min: min || undefined,
    max,
    'aria-invalid': erreurs[champ] ? true : undefined,
    className: cn(CADRE, 'tabular-nums'),
  });
  const aujourdhui = aujourdhuiIso();
  const debutDeLaReprise = lendemain(renouvellement ? valeur.initialementAu : valeur.effetLe);
  // La reprise, au plus deux ans après la prise d'effet : de la
  // disponibilité, ou de sa prorogation, le lendemain de la période initiale.
  const priseDEffet = renouvellement
    ? debutDeLaReprise
    : estUnJour(valeur.effetLe)
      ? valeur.effetLe
      : undefined;
  const finDeLaReprise = priseDEffet ? repriseAuPlusTard(priseDEffet) : undefined;
  // Le renouvellement tient la demande et l'affectation sur une ligne : sa
  // date ouvre celle de la disponibilité, avant la période initiale (ADR-0168).
  const demandeLe = (
    <Field
      label={
        renouvellement
          ? 'Date de la demande de renouvellement'
          : 'Date de la demande de disponibilité'
      }
      htmlFor={`${id}-demandeLe`}
      required={!fige('demandeLe')}
      error={erreurs.demandeLe}
    >
      {fige('demandeLe') ? (
        <ChampFige id={`${id}-demandeLe`} valeur={jourEcrit(valeur.demandeLe)} />
      ) : (
        <Input {...date('demandeLe', { max: aujourdhui })} />
      )}
    </Field>
  );

  return (
    <>
      <Groupe titre="Renseigner la demande">
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
        <Field label="Poste" htmlFor={`${id}-poste`} required={!fige('poste')}>
          {fige('poste') ? (
            <ChampFige id={`${id}-poste`} valeur={valeur.poste} />
          ) : (
            <Input {...intitule('poste', 120)} />
          )}
        </Field>
        {renouvellement ? (
          <Field
            label="Affectation"
            htmlFor={`${id}-affectation`}
            required={!fige('affectation')}
            className={SUR_DEUX_COLONNES}
          >
            {fige('affectation') ? (
              <ChampFige
                id={`${id}-affectation`}
                valeur={(() => {
                  const u = unites.data?.find((x) => x.id === valeur.affectation);
                  return u ? orgUnitLabel(u) : '';
                })()}
              />
            ) : (
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
            )}
          </Field>
        ) : (
          demandeLe
        )}
      </Groupe>

      <Groupe titre="Renseigner la disponibilité">
        {renouvellement ? (
          <>
            {demandeLe}
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
              error={erreurs.initialementAu}
            >
              <Input {...date('initialementAu', { min: valeur.initialementDu })} />
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
          <Field
            label="Date de prise d’effet"
            htmlFor={`${id}-effetLe`}
            required
            error={erreurs.effetLe}
          >
            <Input {...date('effetLe', { min: valeur.demandeLe })} />
          </Field>
        )}
        <Field
          label="Date limite de reprise"
          htmlFor={`${id}-repriseLe`}
          required
          error={erreurs.repriseLe}
        >
          <Input {...date('repriseLe', { min: debutDeLaReprise, max: finDeLaReprise })} />
        </Field>
      </Groupe>

      <Groupe titre="Renseigner les sessions du conseil d’administration">
        <Field
          label="Nomination à la Direction Générale"
          htmlFor={`${id}-pvDirectionGeneraleLe`}
          required
          error={erreurs.pvDirectionGeneraleLe}
        >
          <Input {...date('pvDirectionGeneraleLe', { max: aujourdhui })} />
        </Field>
        <Field
          label="Nomination à la Direction Générale Adjointe"
          htmlFor={`${id}-pvDirectionGeneraleAdjointeLe`}
          required
          error={erreurs.pvDirectionGeneraleAdjointeLe}
        >
          <Input {...date('pvDirectionGeneraleAdjointeLe', { max: aujourdhui })} />
        </Field>
      </Groupe>
    </>
  );
}
