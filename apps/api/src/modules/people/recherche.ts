import { sql, type SQL } from 'drizzle-orm';

/**
 * La recherche d'un agent : chaque mot cherché se trouve dans le prénom, le
 * nom ou le matricule, dans n'importe quel ordre (« Awa Diop » comme « Diop
 * Awa »), sans égard aux accents. La requête nomme `p` la personne et `e` le
 * dossier. Sans mot, tout le monde.
 */
export function rechercheDesAgents(q: string | undefined): SQL {
  const mots = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (mots.length === 0) return sql`TRUE`;
  return sql.join(
    mots.map((mot) => {
      const motif = `%${mot.replace(/[\\%_]/g, '\\$&')}%`;
      return sql`(sans_accents(p.given_name) LIKE sans_accents(${motif})
               OR sans_accents(p.family_name) LIKE sans_accents(${motif})
               OR sans_accents(e.employee_number) LIKE sans_accents(${motif}))`;
    }),
    sql` AND `,
  );
}
