/**
 * Actifs et inactifs : la fin de contrat, les motifs, et les portes qu'un
 * contrat arrivé à terme referme.
 *
 * La règle de l'APIX : un agent dont le CDD ou le stage est arrivé à terme
 * n'est plus de l'agence. Son dossier passe de lui-même dans les inactifs le
 * lendemain de son dernier jour ; d'ici là, chaque porte vérifie la date —
 * il ne dirige rien, n'est le n+1 de personne, ne reçoit ni affectation ni
 * accès au portail, et ne se connecte plus.
 */
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { archiveEmployeesSchema, type SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';
import { inactiverLesContratsEchus } from '../src/modules/people/activite';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';
import { InvitationsService } from '../src/modules/portal/invitations.service';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;
const MOT_DE_PASSE = 'MotDePasseDeTest1!';

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let unites: OrgUnitsService;
let auth: AuthService;
let invitations: InvitationsService;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Une date relative à aujourd'hui, en ISO — lue en base, même horloge que CURRENT_DATE. */
async function jour(decalage: number): Promise<string> {
  const { rows } = await raw(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [decalage]);
  return rows[0].d as string;
}

let uRacine: string;
let uDCH: string;
let uDFC: string;
let uCompta: string;

interface Agent {
  employeeId: string;
  userId: string;
  email: string;
}

async function agent(
  prenom: string,
  unite: string,
  contrat: { type: string; debut: number; fin: number | null },
  n1: string | null = null,
): Promise<Agent> {
  const userId = randomUUID();
  const personId = randomUUID();
  const employeeId = randomUUID();
  const email = `${prenom.toLowerCase()}-${userId}@test.local`;
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [userId, email, await argonHash(MOT_DE_PASSE), prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [personId, tenantId, userId, prenom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01',$5)`,
    [employeeId, tenantId, personId, `INA-${prenom}`, n1],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Poste','[2024-01-01,)')`,
    [randomUUID(), tenantId, employeeId, unite],
  );
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
     VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::int, CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END)`,
    [randomUUID(), tenantId, employeeId, contrat.type, contrat.debut, contrat.fin],
  );
  return { employeeId, userId, email };
}

async function unite(
  nom: string,
  type: string,
  parent: string | null,
  dch = false,
): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, tenantId, type, nom, parent, dch],
  );
  return id;
}

const statut = async (a: Agent) =>
  (
    await raw(
      `SELECT status, inactivite_motif, archived_at::date::text AS depuis FROM employees WHERE id = $1`,
      [a.employeeId],
    )
  ).rows[0] as { status: string; inactivite_motif: string | null; depuis: string | null };

let dg: Agent;
let mariama: Agent;
let omar: Agent;
let fatou: Agent;
let ibou: Agent;
let moussa: Agent;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  unites = new OrgUnitsService(db);
  auth = new AuthService(db);
  invitations = new InvitationsService(db, auth);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Inactifs',$2)`, [
    tenantId,
    `inactifs-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x','Test','Admin')`,
    [adminUserId, `inactifs-admin-${adminUserId}@test.local`],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'admin')`,
    [randomUUID(), tenantId, adminUserId],
  );
});

beforeEach(async () => {
  for (const table of [
    'notifications',
    'sessions',
    'invitations',
    'absence_requests',
    'absence_types',
    'contracts',
    'assignments',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1 AND user_id <> $2`, [
    tenantId,
    adminUserId,
  ]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);

  uRacine = await unite('Direction Générale', 'direction', null);
  uDCH = await unite('Direction du Capital Humain', 'direction', uRacine, true);
  uDFC = await unite('Direction Financière', 'direction', uRacine);
  uCompta = await unite('Service Comptabilité', 'service', uDFC);

  const cdi = { type: 'cdi', debut: -900, fin: null };
  dg = await agent('Cheikh', uRacine, cdi);
  mariama = await agent('Mariama', uDCH, cdi, dg.employeeId);
  omar = await agent('Omar', uDFC, cdi, dg.employeeId);
  // Fatou : un CDD terminé hier. Elle dirige la comptabilité, où travaille Ibou.
  fatou = await agent('Fatou', uCompta, { type: 'cdd', debut: -365, fin: -1 }, omar.employeeId);
  ibou = await agent('Ibou', uCompta, cdi, fatou.employeeId);
  moussa = await agent('Moussa', uDFC, cdi, omar.employeeId);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uRacine,
    dg.employeeId,
  ]);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDFC, omar.employeeId]);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uCompta,
    fatou.employeeId,
  ]);
});

afterAll(async () => {
  for (const table of [
    'notifications',
    'sessions',
    'invitations',
    'absence_requests',
    'absence_types',
    'contracts',
    'assignments',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  const { rows } = await raw(`SELECT user_id FROM user_tenant_memberships WHERE tenant_id = $1`, [
    tenantId,
  ]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1)`, [rows.map((r) => r.user_id as string)]);
  await db?.pool.end();
  await ownerPool?.end();
});

const inactiver = () =>
  db.withTenant({ tenantId, userId: adminUserId }, (tx) => inactiverLesContratsEchus(tx, tenantId));

describe('la fin de contrat, d’elle-même', () => {
  it('le lendemain du dernier jour, le dossier passe dans les inactifs — avec ce qu’un départ demande', async () => {
    // Une session ouverte, une demande de congé en attente.
    await raw(
      `INSERT INTO sessions (id, user_id, tenant_id, token_hash, ip, expires_at)
       VALUES ($1,$2,$3,$4,'10.0.0.1', now() + interval '8 hours')`,
      [randomUUID(), fatou.userId, tenantId, `tok-${randomUUID()}`],
    );
    const typeId = randomUUID();
    await raw(`INSERT INTO absence_types (id, tenant_id, name) VALUES ($1,$2,'Congé annuel')`, [
      typeId,
      tenantId,
    ]);
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE + 10, CURRENT_DATE + 12, 3, 'pending')`,
      [randomUUID(), tenantId, fatou.employeeId, typeId],
    );

    expect(await inactiver()).toBe(1);

    expect(await statut(fatou)).toEqual({
      status: 'archived',
      inactivite_motif: 'fin_de_contrat',
      depuis: await jour(0),
    });
    // Le service qu'elle dirigeait n'a plus de responsable ; son équipe
    // remonte d'un cran, à son propre n+1.
    const { rows: compta } = await raw(`SELECT manager_employee_id FROM org_units WHERE id = $1`, [
      uCompta,
    ]);
    expect(compta[0].manager_employee_id).toBeNull();
    const { rows: n1 } = await raw(`SELECT manager_employee_id FROM employees WHERE id = $1`, [
      ibou.employeeId,
    ]);
    expect(n1[0].manager_employee_id).toBe(omar.employeeId);
    // Plus de congé en attente, plus de session.
    const { rows: conges } = await raw(
      `SELECT status FROM absence_requests WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    expect(conges.map((c) => c.status)).toEqual(['cancelled']);
    const { rows: sessions } = await raw(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [fatou.userId],
    );
    expect(sessions[0].n).toBe(0);
    // Qui dirige la DCH l'apprend, avec ce qui reste à faire.
    const { rows: alertes } = await raw(
      `SELECT recipient_user_id, title, body FROM notifications WHERE tenant_id = $1 AND type = 'contract_ended'`,
      [tenantId],
    );
    expect(alertes).toHaveLength(1);
    expect(alertes[0].recipient_user_id).toBe(mariama.userId);
    expect(alertes[0].title).toBe('Contrat de Fatou Test arrivé à terme');
    expect(alertes[0].body).toContain('« Service Comptabilité » n’a plus de responsable');
    expect(alertes[0].body).toContain('Son équipe relève désormais de Omar Test');

    // Une seule fois.
    expect(await inactiver()).toBe(0);
  });

  it('un contrat qui finit aujourd’hui court encore ; un renouvellement enregistré d’avance compte', async () => {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    expect(await inactiver()).toBe(0);
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 1 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdd', CURRENT_DATE, CURRENT_DATE + 180)`,
      [randomUUID(), tenantId, fatou.employeeId],
    );
    expect(await inactiver()).toBe(0);
    expect((await statut(fatou)).status).toBe('active');
  });
});

describe('avant même le passage, un contrat échu ferme les portes', () => {
  it('ni n+1, ni responsable d’unité, ni affectation, ni portail, ni connexion', async () => {
    // Fatou n'est pas encore passée dans les inactifs : c'est la date qui refuse.
    expect((await statut(fatou)).status).toBe('active');
    expect(
      await codeOf(() =>
        people.update(admin, moussa.employeeId, {
          employee: { managerEmployeeId: fatou.employeeId },
        }),
      ),
    ).toBe('people.contrat_echu');
    expect(
      await codeOf(() => unites.update(admin, uDFC, { managerEmployeeId: fatou.employeeId })),
    ).toBe('people.contrat_echu');
    expect(
      await codeOf(async () =>
        people.newAssignment(admin, fatou.employeeId, {
          orgUnitId: uCompta,
          positionTitle: 'Chef comptable',
          startDate: await jour(0),
        }),
      ),
    ).toBe('people.contrat_echu');
    // Son compte ouvert, on la détache pour tenter une invitation.
    await raw(`UPDATE persons SET user_id = NULL WHERE user_id = $1`, [fatou.userId]);
    expect(
      await codeOf(() =>
        invitations.invite(admin, fatou.employeeId, 'employee', 'fatou@test.local'),
      ),
    ).toBe('portal.contrat_echu');
    await raw(`UPDATE persons SET user_id = $1 WHERE given_name = 'Fatou' AND tenant_id = $2`, [
      fatou.userId,
      tenantId,
    ]);
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.employee_archived',
    );
    // Un collègue en activité, lui, se connecte.
    expect(
      await codeOf(() => auth.login({ email: moussa.email, password: MOT_DE_PASSE }, {})),
    ).toBe('AUCUNE ERREUR');
  });

  it('une affectation ne commence pas après la fin du contrat', async () => {
    await raw(
      `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE + 30 WHERE employee_id = $1`,
      [moussa.employeeId],
    );
    expect(
      await codeOf(async () =>
        people.newAssignment(admin, moussa.employeeId, {
          orgUnitId: uDFC,
          positionTitle: 'Analyste senior',
          startDate: await jour(40),
        }),
      ),
    ).toBe('people.affectation_apres_contrat');
    expect(
      await codeOf(async () =>
        people.newAssignment(admin, moussa.employeeId, {
          orgUnitId: uDFC,
          positionTitle: 'Analyste senior',
          startDate: await jour(10),
        }),
      ),
    ).toBe('AUCUNE ERREUR');
  });

  it('la liste de qui peut diriger une unité ne propose pas un contrat échu', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uCompta]);
    const candidats = await unites.eligibleManagers(admin, uCompta);
    expect(candidats.map((c) => c.givenName)).toEqual(['Ibou']);
  });
});

describe('désactiver, réactiver', () => {
  it('désactiver demande pourquoi, et le motif se garde', async () => {
    expect(
      archiveEmployeesSchema.safeParse({ ids: [moussa.employeeId], archived: true }).success,
    ).toBe(false);
    const r = await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
    });
    expect(r.done).toBe(1);
    const fiche = await people.detail(admin, moussa.employeeId);
    expect(fiche).toMatchObject({ status: 'archived', inactiviteMotif: 'demission' });
    const liste = await people.list(admin, {
      status: 'archived',
      limit: 20,
      offset: 0,
      sort: 'name',
      dir: 'asc',
    } as never);
    expect(liste.items.find((e) => e.id === moussa.employeeId)?.inactiviteMotif).toBe('demission');
  });

  it('pas de réactivation tant que le contrat est échu : le nouveau contrat d’abord', async () => {
    await inactiver();
    const refus = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
    expect(refus.done).toBe(0);
    expect(refus.skipped[0]?.reason).toContain('enregistrez d’abord son nouveau contrat');

    expect(
      await codeOf(async () =>
        people.newContract(admin, fatou.employeeId, {
          contractType: 'cdd',
          startDate: await jour(-400),
          endDate: await jour(-10),
        }),
      ),
    ).toBe('people.contrat_avant_le_precedent');
    await people.newContract(admin, fatou.employeeId, {
      contractType: 'cdd',
      startDate: await jour(0),
      endDate: await jour(180),
    });
    const ok = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
    expect(ok.done).toBe(1);
    expect(await statut(fatou)).toMatchObject({ status: 'active', inactivite_motif: null });
  });

  it('un nouveau contrat arrête le précédent la veille, s’il courait encore', async () => {
    await people.newContract(admin, moussa.employeeId, {
      contractType: 'cdd',
      startDate: await jour(5),
      endDate: await jour(200),
    });
    const { rows } = await raw(
      `SELECT contract_type, start_date::text AS debut, end_date::text AS fin
         FROM contracts WHERE employee_id = $1 ORDER BY start_date`,
      [moussa.employeeId],
    );
    expect(rows).toEqual([
      { contract_type: 'cdi', debut: await jour(-900), fin: await jour(4) },
      { contract_type: 'cdd', debut: await jour(5), fin: await jour(200) },
    ]);
  });
});
