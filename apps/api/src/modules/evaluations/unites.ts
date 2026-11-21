import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-db';

/** La direction, le département et le service d'une unité. */
export interface Unites {
  direction: string | null;
  departement: string | null;
  service: string | null;
}

/**
 * La direction, le département et le service d'une unité, en remontant
 * l'organigramme : la grille et la fiche d'entretien les impriment, et
 * l'accueil de la campagne les montre.
 */
export async function unitesDe(tx: Tx, uniteId: string | null): Promise<Unites> {
  const vide: Unites = { direction: null, departement: null, service: null };
  if (!uniteId) return vide;
  const { rows } = await tx.execute<{ unit_type: string; name: string }>(sql`
    WITH RECURSIVE remontee AS (
      SELECT id, parent_id, unit_type, name, 0 AS prof
        FROM org_units WHERE id = ${uniteId} AND deleted_at IS NULL
      UNION ALL
      SELECT o.id, o.parent_id, o.unit_type, o.name, r.prof + 1
        FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
       WHERE r.prof < 64 AND r.unit_type <> 'direction')
    SELECT unit_type, name FROM remontee ORDER BY prof`);
  const premier = (type: string) => rows.find((u) => u.unit_type === type)?.name ?? null;
  return {
    direction: premier('direction'),
    departement: premier('department'),
    service: premier('service'),
  };
}
