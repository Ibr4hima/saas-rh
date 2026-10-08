'use client';

import {
  MOTIF_INACTIVITE_LABELS,
  MOTIFS_INACTIVITE,
  posteDeResponsable,
  type DevenirDeLAncien as CorpsDuDevenir,
  type MotifInactivite,
  type OrgUnitView,
} from '@teranga/contracts';
import { cn, Field, Input, Select } from '@teranga/ui';
import { de } from '../lib/mots';
import { n1DOffice, useResponsablesPossibles } from '../lib/responsables';
import { ChoixUnite, directionDe } from './choix-unite';

/*
   Ce que devient celui qui quitte la tête d'une unité (ADR-0038) : il reste
   dans son unité à un poste qu'on dit, change d'affectation, prend la tête
   d'une autre unité, ou quitte l'APIX. Le même choix depuis l'organigramme
   et depuis une nouvelle affectation.
*/

export type ChoixDuDevenir = 'reste' | 'ailleurs' | 'tete' | 'depart';

export interface Devenir {
  choix: ChoixDuDevenir;
  /** Son poste, quand il reste ou change d'affectation. */
  poste: string;
  /** L'unité où il va, ou qu'il dirigera. */
  uniteId: string;
  /** Le poste de celui qu'il remplace à la tête de cette autre unité. */
  posteDuRemplace: string;
  /** Son n+1 choisi, quand il change de direction ; vide : celui d'office. */
  n1: string;
  motif: MotifInactivite | '';
  /** Son dernier jour, s'il part. */
  le: string;
}

export const DEVENIR_INITIAL: Devenir = {
  choix: 'reste',
  poste: '',
  uniteId: '',
  posteDuRemplace: '',
  n1: '',
  motif: '',
  le: '',
};

/** « à la DMG », « au département Études », « au service Paie ». */
function dansLUnite(u: OrgUnitView): string {
  if (u.unitType === 'direction') return `à la ${u.shortName || u.name}`;
  const nature = u.unitType === 'department' ? 'département' : 'service';
  return `au ${nature} ${u.name.replace(new RegExp(`^${nature}\\s+`, 'iu'), '')}`;
}

function veille(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface Contexte {
  /** L'unité dont il quitte la tête. */
  quittee: OrgUnitView;
  unites: OrgUnitView[];
  ancienId: string;
  /** Le jour de la passation. */
  depuis: string;
  /** Le début de son poste actuel : son dernier jour ne le précède pas. */
  min: string | null;
}

/** Le choix lu sur l'organigramme, et ce qu'il envoie ; `corps` nul tant qu'il manque quelque chose. */
export function lireLeDevenir(d: Devenir, { quittee, unites, ancienId, depuis, min }: Contexte) {
  const cible = unites.find((u) => u.id === d.uniteId) ?? null;
  const directionCible = directionDe(unites, d.uniteId);
  const changeDeDirection =
    d.choix === 'ailleurs' &&
    Boolean(directionCible) &&
    directionCible?.id !== directionDe(unites, quittee.id)?.id;
  const n1 = changeDeDirection ? d.n1 || n1DOffice(unites, d.uniteId) || '' : '';
  const remplace =
    d.choix === 'tete' &&
    cible &&
    cible.id !== quittee.id &&
    cible.managerEmployeeId &&
    cible.managerEmployeeId !== ancienId &&
    cible.managerDepuis
      ? cible
      : null;
  let corps: CorpsDuDevenir | null = null;
  if (d.choix === 'reste' && d.poste.trim()) {
    corps = { choix: 'affectation', orgUnitId: quittee.id, positionTitle: d.poste.trim() };
  } else if (d.choix === 'ailleurs' && cible && d.poste.trim() && (!changeDeDirection || n1)) {
    corps = {
      choix: 'affectation',
      orgUnitId: cible.id,
      positionTitle: d.poste.trim(),
      ...(changeDeDirection ? { managerEmployeeId: n1 } : {}),
    };
  } else if (
    d.choix === 'tete' &&
    cible &&
    cible.id !== quittee.id &&
    (!remplace || d.posteDuRemplace.trim())
  ) {
    corps = {
      choix: 'affectation',
      orgUnitId: cible.id,
      responsable: true,
      ...(remplace ? { posteDeLAncien: d.posteDuRemplace.trim() } : {}),
    };
  } else if (d.choix === 'depart' && d.motif && d.le && d.le <= depuis && (!min || d.le >= min)) {
    corps = { choix: 'depart', motif: d.motif, le: d.le };
  }
  return { cible, directionCible, changeDeDirection, n1, remplace, corps };
}

export function DevenirDeLAncien({
  ancien,
  valeur,
  onChange,
  idPrefix,
  ...contexte
}: Omit<Contexte, 'ancienId'> & {
  ancien: { id: string; nom: string; genre: string | null };
  valeur: Devenir;
  onChange: (d: Devenir) => void;
  idPrefix: string;
}) {
  const { quittee, unites, depuis, min } = contexte;
  const lu = lireLeDevenir(valeur, { ...contexte, ancienId: ancien.id });
  const set = (p: Partial<Devenir>) => onChange({ ...valeur, ...p });
  const { options: n1Possibles } = useResponsablesPossibles(
    lu.changeDeDirection && lu.directionCible
      ? (lu.directionCible.shortName ?? lu.directionCible.name)
      : null,
    ancien.id,
    false,
    lu.changeDeDirection,
  );
  // Parti, son dernier jour est par défaut la veille de la passation.
  const dernierJour = min && veille(depuis) < min ? min : veille(depuis);
  const choix: { v: ChoixDuDevenir; label: string }[] = [
    { v: 'reste', label: `Reste ${dansLUnite(quittee)}` },
    { v: 'ailleurs', label: 'Change d’affectation' },
    { v: 'tete', label: 'Prend la tête d’une autre unité' },
    { v: 'depart', label: 'Quitte l’APIX' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p id={`${idPrefix}-question`} className="text-[13px] font-semibold text-ink">
        Que devient {ancien.nom} ?
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${idPrefix}-question`}
        className="grid gap-2 sm:grid-cols-2"
      >
        {choix.map((o) => {
          const actif = valeur.choix === o.v;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={actif}
              onClick={() =>
                onChange({
                  ...DEVENIR_INITIAL,
                  choix: o.v,
                  // Le poste saisi suit, de « reste » à « change d'affectation ».
                  poste: o.v === 'reste' || o.v === 'ailleurs' ? valeur.poste : '',
                  le: o.v === 'depart' ? dernierJour : '',
                })
              }
              className={cn(
                'flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors',
                actif
                  ? 'border-primary bg-primary/[0.06] text-primary'
                  : 'border-line bg-surface text-ink hover:border-primary/40',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  actif ? 'border-primary' : 'border-line',
                )}
              >
                {actif ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>

      {valeur.choix === 'ailleurs' || valeur.choix === 'tete' ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <ChoixUnite
            unites={unites}
            value={valeur.uniteId}
            onChange={(id) => set({ uniteId: id, posteDuRemplace: '', n1: '' })}
            idPrefix={`${idPrefix}-unite`}
            requis
          />
        </div>
      ) : null}

      {valeur.choix === 'reste' || valeur.choix === 'ailleurs' ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <Field label="Nouveau poste" htmlFor={`${idPrefix}-poste`} required>
            <Input
              id={`${idPrefix}-poste`}
              value={valeur.poste}
              maxLength={120}
              onChange={(ev) => set({ poste: ev.target.value })}
            />
          </Field>
          {lu.changeDeDirection ? (
            <Field label="Nouveau n+1" htmlFor={`${idPrefix}-n1`} required>
              <Select
                id={`${idPrefix}-n1`}
                value={lu.n1}
                onChange={(ev) => set({ n1: ev.target.value })}
              >
                {lu.n1 ? null : <option value="">Choisir</option>}
                {n1Possibles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom}
                    {m.poste ? ` · ${m.poste}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}

      {valeur.choix === 'tete' && lu.cible ? (
        lu.cible.id === quittee.id ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {ancien.nom} quitte la tête de cette unité.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <Field label="Nouveau poste" htmlFor={`${idPrefix}-poste-tete`}>
              <Input
                id={`${idPrefix}-poste-tete`}
                value={posteDeResponsable(lu.cible, ancien.genre)}
                readOnly
                tabIndex={-1}
                className="cursor-default bg-bg text-ink-strong"
              />
            </Field>
            {lu.remplace ? (
              <Field
                label={`Nouveau poste ${de(lu.remplace.managerShortName ?? '')}`}
                htmlFor={`${idPrefix}-poste-remplace`}
                required
              >
                <Input
                  id={`${idPrefix}-poste-remplace`}
                  value={valeur.posteDuRemplace}
                  maxLength={120}
                  onChange={(ev) => set({ posteDuRemplace: ev.target.value })}
                />
              </Field>
            ) : null}
          </div>
        )
      ) : null}

      {valeur.choix === 'depart' ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <Field label="Motif" htmlFor={`${idPrefix}-motif`} required>
            <Select
              id={`${idPrefix}-motif`}
              value={valeur.motif}
              onChange={(ev) => set({ motif: ev.target.value as MotifInactivite | '' })}
            >
              <option value="">Choisir</option>
              {MOTIFS_INACTIVITE.map((m) => (
                <option key={m} value={m}>
                  {MOTIF_INACTIVITE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dernier jour" htmlFor={`${idPrefix}-le`} required>
            <Input
              id={`${idPrefix}-le`}
              type="date"
              value={valeur.le}
              min={min ?? undefined}
              max={depuis}
              onChange={(ev) => set({ le: ev.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
