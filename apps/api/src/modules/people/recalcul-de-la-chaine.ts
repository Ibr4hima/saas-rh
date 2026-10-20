import { sql } from 'drizzle-orm';
import type { ChangementRattachement } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { alerterLaDCH } from '../acces/dch';
import { calculerLaChaine } from './calcul-de-la-chaine';
import { nomsDe, photographierLaChaine, verrouillerLaChaine } from './chaine';

/*
   Le recalcul de la chaîne (ADR-0147).

   Après chaque geste qui touche l'organigramme, les affectations, les têtes
   ou les dossiers, et à chaque passage de la veille : la chaîne se calcule
   à nouveau, et seul ce qui change s'écrit.
     - le N+1 hiérarchique de chaque agent actif ;
     - le rattachement choisi qui ne tient plus s'efface ;
     - le N+1 fonctionnel qui ne peut plus l'être s'efface : l'agent revient
       au hiérarchique, et la DCH en est prévenue.
   Le circuit des congés et les évaluations attendues se réconcilient
   ensuite, chez l'appelant (cf. `reconcilierLeCircuit`).
*/

const liste = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * Recalcule et écrit. Rend le journal : les N+1 hiérarchiques changés, puis
 * les N+1 fonctionnels retirés. `prevenir` faux : rien n'est annoncé (un
 * aperçu, qui sera défait).
 */
export async function recalculerLaChaine(
  tx: Tx,
  tenantId: string,
  { prevenir = true }: { prevenir?: boolean } = {},
): Promise<ChangementRattachement[]> {
  await verrouillerLaChaine(tx);
  const photo = await photographierLaChaine(tx);
  const resultat = calculerLaChaine(photo);
  const agents = new Map(photo.agents.map((a) => [a.id, a]));

  const ecarts = photo.agents.flatMap((a) => {
    const n = resultat.hierarchique.get(a.id);
    return n && n.id !== a.n1Actuel ? [{ id: a.id, avant: a.n1Actuel, apres: n.id, n }] : [];
  });
  const retires = resultat.fonctionnelsCaducs.map((id) => ({
    id,
    ancien: agents.get(id)?.n1FonctionnelId ?? null,
    hierarchique: resultat.hierarchique.get(id)?.id ?? null,
  }));

  if (resultat.choixCaducs.length > 0) {
    await tx.execute(sql`
      UPDATE employees SET n1_unite_id = NULL, n1_dga = false, updated_at = now()
       WHERE id IN (${liste(resultat.choixCaducs)})`);
  }
  if (ecarts.length > 0) {
    await tx.execute(sql`
      UPDATE employees e SET manager_employee_id = v.n1, updated_at = now()
        FROM (VALUES ${sql.join(
          ecarts.map((c) => sql`(${c.id}::uuid, ${c.apres}::uuid)`),
          sql`, `,
        )}) AS v(id, n1)
       WHERE e.id = v.id`);
  }
  if (retires.length > 0) {
    await tx.execute(sql`
      UPDATE employees SET n1_fonctionnel_employee_id = NULL, updated_at = now()
       WHERE id IN (${liste(retires.map((f) => f.id))})`);
  }
  // La revue du passage à la règle ne garde que les N+1 que la règle a
  // changés : un N+1 inchangé n'est pas à revoir.
  await tx.execute(sql`
    UPDATE employees SET n1_avant_la_regle = NULL
     WHERE n1_avant_la_regle IS NOT NULL AND n1_avant_la_regle = manager_employee_id`);

  const noms = await nomsDe(tx, [
    ...ecarts.flatMap((c) => [c.id, c.avant, c.apres]),
    ...retires.flatMap((f) => [f.id, f.ancien, f.hierarchique]),
    ...resultat.choixCaducs,
  ]);
  const nom = (id: string | null) => (id ? (noms.get(id) ?? null) : null);
  const journal: ChangementRattachement[] = [
    ...ecarts.map((c) => ({
      employeeId: c.id,
      nom: nom(c.id) ?? '',
      avant: nom(c.avant),
      apres: nom(c.apres),
      motif: c.n.motif,
    })),
    ...retires.map((f) => ({
      employeeId: f.id,
      nom: nom(f.id) ?? '',
      avant: nom(f.ancien),
      apres: nom(f.hierarchique),
      motif: 'fonctionnel_retire' as const,
    })),
  ];

  if (prevenir) {
    for (const f of retires) {
      await alerterLaDCH(
        tx,
        tenantId,
        'personnel.gerer',
        {
          type: 'n1_fonctionnel_retire',
          sujet: 'dch.rattachements',
          title: `${nom(f.ancien) ?? 'Son N+1 fonctionnel'} n’est plus le N+1 fonctionnel de ${nom(f.id) ?? 'un agent'}`,
          link: `/employees/${f.id}`,
          dedupeKey: `n1_fonctionnel_retire:${f.id}:${f.ancien ?? ''}`,
        },
        f.id,
      );
    }
    for (const id of resultat.choixCaducs) {
      await alerterLaDCH(
        tx,
        tenantId,
        'personnel.gerer',
        {
          type: 'rattachement_retire',
          sujet: 'dch.rattachements',
          title: `Le N+1 hiérarchique choisi pour ${nom(id) ?? 'un agent'} ne tient plus`,
          link: `/employees/${id}`,
          dedupeKey: `rattachement_retire:${id}:${Date.now()}`,
        },
        id,
      );
    }
  }
  return journal;
}
