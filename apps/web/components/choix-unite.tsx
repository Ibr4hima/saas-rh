'use client';

import type { OrgUnit } from '@teranga/contracts';
import { Field, Select } from '@teranga/ui';

/*
   L'unité d'une affectation, choisie de haut en bas : la direction, puis,
   s'il y en a, un département ou un service qui en relève directement, puis
   un service du département choisi. Ne rien choisir sous la direction, c'est
   y rester ; sous le département, c'est rester au département.

   La valeur est l'unité la plus précise choisie. Les champs sont rendus à
   plat : c'est la grille de l'appelant qui les range.
*/

/** De l'unité jusqu'à sa direction, la direction d'abord. */
function chemin<U extends OrgUnit>(unites: U[], uniteId: string | null | undefined): U[] {
  const parId = new Map(unites.map((u) => [u.id, u]));
  const montee: U[] = [];
  // Une boucle d'unités d'avant la règle ne doit pas figer l'écran.
  const vus = new Set<string>();
  let u = (uniteId && parId.get(uniteId)) || null;
  while (u && !vus.has(u.id)) {
    vus.add(u.id);
    montee.unshift(u);
    if (u.unitType === 'direction') break;
    u = u.parentId ? (parId.get(u.parentId) ?? null) : null;
  }
  return montee[0]?.unitType === 'direction' ? montee : [];
}

/** La direction d'une unité : elle-même, ou sa plus proche aïeule de type direction. */
export function directionDe<U extends OrgUnit>(
  unites: U[],
  uniteId: string | null | undefined,
): U | null {
  return chemin(unites, uniteId)[0] ?? null;
}

/** Une unité dans une liste : l'acronyme d'abord, il se lit même tronqué. */
export function libelleDUnite(u: OrgUnit): string {
  return u.shortName ? `${u.shortName} · ${u.name}` : u.name;
}

/** Dans l'ordre où on les cherche : la Direction Générale, puis par libellé. */
export function parLibelle<U extends OrgUnit>(unites: U[]): U[] {
  return [...unites].sort(
    (a, b) =>
      Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
      libelleDUnite(a).localeCompare(libelleDUnite(b), 'fr'),
  );
}

function libelleDuNiveau(enfants: OrgUnit[]): string {
  const departements = enfants.some((u) => u.unitType === 'department');
  const services = enfants.some((u) => u.unitType === 'service');
  if (departements && services) return 'Département ou service';
  return departements ? 'Département' : 'Service';
}

export function ChoixUnite({
  unites,
  value,
  onChange,
  idPrefix,
  libelle = 'Direction',
  requis = false,
  vide = 'Choisir',
}: {
  unites: OrgUnit[];
  /** L'unité la plus précise choisie ; `''` : aucune. */
  value: string;
  onChange: (uniteId: string) => void;
  idPrefix: string;
  libelle?: string;
  /** La direction est obligatoire. */
  requis?: boolean;
  /** L'option vide de la direction. */
  vide?: string;
}) {
  const [direction, niveau2, niveau3] = chemin(unites, value);
  const directions = parLibelle(unites.filter((u) => u.unitType === 'direction'));
  const enfants = direction
    ? parLibelle(unites.filter((u) => u.parentId === direction.id && u.unitType !== 'direction'))
    : [];
  const services =
    niveau2?.unitType === 'department'
      ? parLibelle(unites.filter((u) => u.parentId === niveau2.id && u.unitType === 'service'))
      : [];

  return (
    <>
      <Field label={libelle} htmlFor={`${idPrefix}-direction`} required={requis}>
        <Select
          id={`${idPrefix}-direction`}
          value={direction?.id ?? ''}
          onChange={(ev) => onChange(ev.target.value)}
        >
          {!direction || !requis ? <option value="">{vide}</option> : null}
          {directions.map((u) => (
            <option key={u.id} value={u.id}>
              {libelleDUnite(u)}
            </option>
          ))}
        </Select>
      </Field>
      {direction && enfants.length > 0 ? (
        <Field label={libelleDuNiveau(enfants)} htmlFor={`${idPrefix}-niveau2`}>
          <Select
            id={`${idPrefix}-niveau2`}
            value={niveau2?.id ?? ''}
            onChange={(ev) => onChange(ev.target.value || direction.id)}
          >
            <option value="">Aucun</option>
            {enfants.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {niveau2 && services.length > 0 ? (
        <Field label="Service" htmlFor={`${idPrefix}-service`}>
          <Select
            id={`${idPrefix}-service`}
            value={niveau3?.id ?? ''}
            onChange={(ev) => onChange(ev.target.value || niveau2.id)}
          >
            <option value="">Aucun</option>
            {services.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
