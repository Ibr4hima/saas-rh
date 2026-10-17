'use client';

import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { CATEGORIE_MAX, DUREE_DE_STAGE_MAX, finDuStage } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, cn, Field, Input, Select } from '@teranga/ui';
import { formatDate } from '../lib/hooks';
import { useMontantEnChiffres } from '../lib/montant';

/*
   Ce que la DCH renseigne pour un contrat de stage (ADR-0094) : la personne
   n'est pas encore dans l'application. Son état civil d'abord, puis le
   stage ; la fin du stage se déduit du début et de la durée.
*/

/** La fiche telle qu'elle se tape : du texte, une durée choisie, un montant. */
export type SaisieDuStagiaire = {
  civilite: '' | 'madame' | 'monsieur';
  prenom: string;
  nom: string;
  naissanceLe: string;
  naissanceA: string;
  cni: string;
  pere: string;
  mere: string;
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
  pere: '',
  mere: '',
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
 * ôtés, la catégorie en capitales, un champ facultatif laissé vide absent.
 */
export function versLaFiche(s: SaisieDuStagiaire) {
  const facultatif = (t: string) => t.trim() || undefined;
  return {
    civilite: s.civilite || undefined,
    prenom: s.prenom.trim(),
    nom: s.nom.trim(),
    naissanceLe: s.naissanceLe,
    naissanceA: s.naissanceA.trim(),
    cni: s.cni,
    pere: s.pere.trim(),
    mere: s.mere.trim(),
    adresse: facultatif(s.adresse),
    formation: facultatif(s.formation),
    poste: facultatif(s.poste),
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
  const allocation = useMontantEnChiffres(valeur.allocation, (montant) =>
    poser({ allocation: montant }),
  );

  /** Ce qu'un champ de texte reçoit : son identifiant, sa valeur, sa frappe. */
  const texte = (
    champ: Exclude<keyof SaisieDuStagiaire, 'civilite' | 'allocation'>,
    max?: number,
  ) => ({
    id: `${id}-${champ}`,
    value: valeur[champ],
    maxLength: max,
    onChange: (e: ChangeEvent<HTMLInputElement>) => poser({ [champ]: e.target.value }),
    className: CADRE,
  });

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
            id={`${id}-cni`}
            inputMode="numeric"
            maxLength={13}
            value={valeur.cni}
            aria-invalid={cniIncomplete || undefined}
            onChange={(e) => poser({ cni: e.target.value.replace(/\D/g, '').slice(0, 13) })}
            onBlur={() => setCniQuittee(true)}
            className={cn(CADRE, 'tabular-nums', cniIncomplete && 'border-danger')}
          />
        </Field>
        <Field label="Prénom" htmlFor={`${id}-prenom`} required>
          <Input {...texte('prenom', 80)} />
        </Field>
        <Field label="Nom" htmlFor={`${id}-nom`} required>
          <Input {...texte('nom', 80)} />
        </Field>
        <Field label="Date de naissance" htmlFor={`${id}-naissanceLe`} required>
          <Input type="date" {...texte('naissanceLe')} className={cn(CADRE, 'tabular-nums')} />
        </Field>
        <Field label="Lieu de naissance" htmlFor={`${id}-naissanceA`} required>
          <Input {...texte('naissanceA', 120)} />
        </Field>
        <Field label="Prénom du père" htmlFor={`${id}-pere`} required>
          <Input {...texte('pere', 80)} />
        </Field>
        <Field label="Prénom et nom de la mère" htmlFor={`${id}-mere`} required>
          <Input {...texte('mere', 120)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Adresse" htmlFor={`${id}-adresse`}>
            <Input {...texte('adresse', 200)} />
          </Field>
        </div>
      </Groupe>

      <Groupe titre="Renseigner le stage">
        <Field label="Formation suivie" htmlFor={`${id}-formation`}>
          <Input {...texte('formation', 200)} />
        </Field>
        <Field label="Poste" htmlFor={`${id}-poste`}>
          <Input {...texte('poste', 120)} />
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
