'use client';

import type { EmployeeListItem } from '@teranga/contracts';
import { Field, Select } from '@teranga/ui';
import { useResponsablesPossibles } from '../lib/responsables';

/* ————————————————————————————————————————————————————————————————
   Qui part avec une équipe la confie.

   Un agent désactivé ou supprimé laisse ses agents sans n+1 actif : avant de
   valider, on désigne pour chaque encadrant qui reprend son équipe — parmi
   les agents de sa direction, puisque son équipe y reste. Les agents qui
   partent dans le même lot ne comptent pas : on ne confie pas une équipe
   qui s'en va aussi, ni à quelqu'un qui s'en va.
   ———————————————————————————————————————————————————————————————— */

export interface EquipeAConfier {
  agent: EmployeeListItem;
  /** Ses agents qui restent — ceux qui ne partent pas dans le même lot. */
  reste: number;
}

export function equipesAConfier(lot: EmployeeListItem[]): EquipeAConfier[] {
  return lot
    .map((agent) => ({
      agent,
      reste: agent.teamSize - lot.filter((a) => a.managerId === agent.id).length,
    }))
    .filter((e) => e.reste > 0);
}

export function toutesConfiees(
  equipes: EquipeAConfier[],
  repreneurs: Record<string, string>,
): boolean {
  return equipes.every((e) => Boolean(repreneurs[e.agent.id]));
}

export function RepriseDesEquipes({
  equipes,
  lot,
  repreneurs,
  onChange,
}: {
  equipes: EquipeAConfier[];
  lot: EmployeeListItem[];
  repreneurs: Record<string, string>;
  onChange: (repreneurs: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {equipes.map((e) => (
        <LigneReprise
          key={e.agent.id}
          equipe={e}
          exclus={lot.map((a) => a.id)}
          valeur={repreneurs[e.agent.id] ?? ''}
          onChange={(v) => onChange({ ...repreneurs, [e.agent.id]: v })}
        />
      ))}
    </div>
  );
}

function LigneReprise({
  equipe,
  exclus,
  valeur,
  onChange,
}: {
  equipe: EquipeAConfier;
  exclus: string[];
  valeur: string;
  onChange: (v: string) => void;
}) {
  const { agent, reste } = equipe;
  const direction = agent.directionShortName ?? agent.directionName;
  const { options } = useResponsablesPossibles(direction, agent.id);
  const possibles = options.filter((o) => !exclus.includes(o.id));
  const id = `repreneur-${agent.id}`;
  return (
    <Field
      label={`${agent.givenName} ${agent.familyName} — ${reste > 1 ? `${reste} agents` : 'un agent'}`}
      htmlFor={id}
      required
      hint={direction ? `Son équipe reste dans ${direction}.` : undefined}
    >
      <Select id={id} value={valeur} onChange={(ev) => onChange(ev.target.value)}>
        <option value="">— Qui reprend son équipe ?</option>
        {possibles.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nom}
            {m.poste ? ` — ${m.poste}` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}
