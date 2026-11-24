/**
 * Remettre à zéro les fiches de la campagne après des essais (ADR-0270) : à
 * blanc rien ne bouge ; confirmé, ce que la campagne a écrit s'en va, les
 * objectifs et l'évaluateur choisi restent, et ni une autre année ni
 * l'organisation voisine ne sont touchées.
 */
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { reinitialiserLaCampagne } from '../src/db/reinitialiser-la-campagne';

const env = loadEnv();
const tenantId = randomUUID();
const voisinId = randomUUID();
const ANNEE = 2026;
const OBJECTIFS = [{ id: 'o1', intitule: 'Produire l’étude sectorielle', indicateurs: '' }];

let pool: Pool;
let client: Client;
const raw = (q: string, p: unknown[] = []) => pool.query(q, p as never[]);
const agents: Record<'awa' | 'moussa' | 'fatou' | 'cheikh' | 'voisin', string> = {
  awa: randomUUID(),
  moussa: randomUUID(),
  fatou: randomUUID(),
  cheikh: randomUUID(),
  voisin: randomUUID(),
};
const fiches = { awa: randomUUID(), awa2025: randomUUID(), moussa: randomUUID() };
const compteDeMoussa = randomUUID();
const fiche = async (id: string) =>
  (await raw(`SELECT * FROM fiches_entretien WHERE id = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Campagne',$2), ($3,'Voisine',$4)`, [
    tenantId,
    `campagne-${tenantId.slice(0, 8)}`,
    voisinId,
    `voisine-${voisinId.slice(0, 8)}`,
  ]);
  const personnes: [keyof typeof agents, string, string, string, string][] = [
    ['awa', tenantId, 'Awa', 'Diop', 'CAMP-AWA'],
    ['moussa', tenantId, 'Moussa', 'Sarr', 'CAMP-MOUSSA'],
    ['fatou', tenantId, 'Fatou', 'Sall', 'CAMP-FATOU'],
    ['cheikh', tenantId, 'Cheikh', 'Mbaye', 'CAMP-CHEIKH'],
    ['voisin', voisinId, 'Lamine', 'Ba', 'V-1'],
  ];
  // Moussa Sarr n'a pas d'adresse professionnelle, seulement son compte.
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Moussa','Sarr')`,
    [compteDeMoussa, `compte-${compteDeMoussa}@campagne.test`],
  );
  for (const [cle, tenant, prenom, nom, matricule] of personnes) {
    const personne = randomUUID();
    const moussa = cle === 'moussa';
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [personne, tenant, moussa ? compteDeMoussa : null, prenom, nom],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email)
       VALUES ($1,$2,$3,$4,'2020-01-01',$5)`,
      [agents[cle], tenant, personne, matricule, moussa ? null : `${cle}@campagne.test`],
    );
  }
  const objectifs = JSON.stringify(OBJECTIFS);
  // Awa Diop : la fiche est allée jusqu'à la DCH, avec Cheikh Mbaye pour évaluateur choisi.
  await raw(
    `INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, evaluateur_employee_id,
            objectifs, auto, auto_transmise_le, evaluation, reservee, evaluation_par_employee_id,
            evaluation_transmise_le, validee_le, commentaires_n2, commentaires_n2_par,
            commentaires_n2_transmis_le, transmise_dch_le, transmise_dch_par)
     VALUES ($1,$2,$3,$4,$5,$6,'{"bilan":"Une année dense."}',now(),'{"pointsForts":"Rigueur."}',
             '{"observations":"Bonne année."}',$5,now(),now(),'Un agent fiable.',$5,now(),now(),$5)`,
    [fiches.awa, tenantId, agents.awa, ANNEE, agents.cheikh, objectifs],
  );
  // La même, l'année d'avant : une autre campagne.
  await raw(
    `INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, auto, auto_transmise_le)
     VALUES ($1,$2,$3,2025,'{"bilan":"L’année d’avant."}',now())`,
    [fiches.awa2025, tenantId, agents.awa],
  );
  // Moussa Sarr : un brouillon d'auto-évaluation. Fatou Sall : ses objectifs seulement.
  await raw(
    `INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, objectifs, auto)
     VALUES ($1,$2,$3,$4,$5,'{"bilan":"Brouillon."}'), ($6,$2,$7,$4,$5,NULL)`,
    [fiches.moussa, tenantId, agents.moussa, ANNEE, objectifs, randomUUID(), agents.fatou],
  );
  // L'organisation voisine a sa fiche commencée.
  await raw(
    `INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, auto)
     VALUES ($1,$2,$3,$4,'{"bilan":"Voisine."}')`,
    [randomUUID(), voisinId, agents.voisin, ANNEE],
  );
});

afterAll(async () => {
  for (const t of [tenantId, voisinId]) {
    for (const table of ['fiches_entretien', 'employees', 'persons']) {
      await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]);
    }
    await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [t]);
    await raw(`DELETE FROM tenants WHERE id = $1`, [t]);
  }
  await raw(`DELETE FROM users WHERE id = $1`, [compteDeMoussa]);
  await client.end();
  await pool.end();
});

describe('remettre à zéro les fiches de la campagne', () => {
  it('à blanc, dit quelles fiches repartiraient de zéro et ne touche à rien', async () => {
    const bilan = await reinitialiserLaCampagne(client, tenantId, {
      annee: ANNEE,
      appliquer: false,
    });
    expect(bilan).toEqual({
      annee: ANNEE,
      fiches: [
        { matricule: 'CAMP-AWA', prenom: 'Awa', nom: 'Diop', etape: 'transmise à la DCH' },
        {
          matricule: 'CAMP-MOUSSA',
          prenom: 'Moussa',
          nom: 'Sarr',
          etape: 'auto-évaluation commencée',
        },
      ],
      applique: false,
    });
    expect((await fiche(fiches.awa)).transmise_dch_le).not.toBeNull();
    expect((await fiche(fiches.moussa)).auto).not.toBeNull();
  });

  it('avec --agent, ne remet à zéro que la fiche de cet agent, et garde ses objectifs', async () => {
    const bilan = await reinitialiserLaCampagne(client, tenantId, {
      annee: ANNEE,
      agent: 'AWA@campagne.test',
      appliquer: true,
    });
    expect(bilan.fiches.map((f) => f.matricule)).toEqual(['CAMP-AWA']);
    const awa = await fiche(fiches.awa);
    for (const colonne of [
      'auto',
      'auto_transmise_le',
      'evaluation',
      'reservee',
      'evaluation_par_employee_id',
      'evaluation_transmise_le',
      'validee_le',
      'commentaires_n2',
      'commentaires_n2_par',
      'commentaires_n2_transmis_le',
      'transmise_dch_le',
      'transmise_dch_par',
    ]) {
      expect(awa[colonne], colonne).toBeNull();
    }
    expect(awa.objectifs).toEqual(OBJECTIFS);
    expect(awa.evaluateur_employee_id).toBe(agents.cheikh);
    // Le journal d'audit garde ce que la fiche contenait.
    const trace = await raw(
      `SELECT old_data->>'commentaires_n2' AS avant FROM audit_log
        WHERE table_name = 'fiches_entretien' AND row_id = $1 AND action = 'UPDATE'`,
      [fiches.awa],
    );
    expect(trace.rows).toEqual([{ avant: 'Un agent fiable.' }]);
    // L'année d'avant et la fiche de Moussa Sarr n'ont pas bougé.
    expect((await fiche(fiches.awa2025)).auto).not.toBeNull();
    expect((await fiche(fiches.moussa)).auto).not.toBeNull();
  });

  it('retrouve un agent sans adresse professionnelle par l’adresse de son compte', async () => {
    const bilan = await reinitialiserLaCampagne(client, tenantId, {
      annee: ANNEE,
      agent: `compte-${compteDeMoussa}@campagne.test`,
      appliquer: false,
    });
    expect(bilan.fiches.map((f) => f.matricule)).toEqual(['CAMP-MOUSSA']);
  });

  it('confirmé, remet à zéro les fiches de l’année, et pas celles de la voisine', async () => {
    const bilan = await reinitialiserLaCampagne(client, tenantId, {
      annee: ANNEE,
      appliquer: true,
    });
    expect(bilan.fiches.map((f) => f.matricule)).toEqual(['CAMP-MOUSSA']);
    expect((await fiche(fiches.moussa)).auto).toBeNull();
    const voisine = await raw(
      `SELECT count(*)::int AS n FROM fiches_entretien WHERE tenant_id = $1 AND auto IS NOT NULL`,
      [voisinId],
    );
    expect(voisine.rows).toEqual([{ n: 1 }]);
    // Plus rien à faire.
    const encore = await reinitialiserLaCampagne(client, tenantId, {
      annee: ANNEE,
      appliquer: true,
    });
    expect(encore.fiches).toEqual([]);
  });

  it('refuse une adresse qui ne correspond à aucun agent', async () => {
    await expect(
      reinitialiserLaCampagne(client, tenantId, {
        annee: ANNEE,
        agent: 'personne@campagne.test',
        appliquer: true,
      }),
    ).rejects.toThrow('Aucun agent avec l’adresse « personne@campagne.test »');
  });
});
