import { sql } from 'drizzle-orm';
import type { Tx } from './tenant-db';

/**
 * Ce que le temps déclenche (un contrat arrivé à terme, une demande expirée,
 * une offre close, un rappel) se trace au nom du système, pas de la personne
 * qui ouvrait sa cloche à ce moment-là.
 *
 * Le journal lit l'auteur dans `app.user_id` : on le vide le temps de la
 * tâche, puis on le rend. Les policies qui le consultent retombent sur
 * l'organisation, posée à part : rien ne change de ce qui se voit.
 */
export async function parLeSysteme<T>(tx: Tx, tache: () => Promise<T>): Promise<T> {
  const { rows } = await tx.execute<{ auteur: string | null }>(
    sql`SELECT current_setting('app.user_id', true) AS auteur`,
  );
  await tx.execute(sql`SELECT set_config('app.user_id', '', true)`);
  // En cas d'échec, la transaction est perdue : rien à rendre, l'erreur
  // d'origine remonte telle quelle.
  const resultat = await tache();
  await tx.execute(sql`SELECT set_config('app.user_id', ${rows[0]?.auteur ?? ''}, true)`);
  return resultat;
}
