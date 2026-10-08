/**
 * Actifs et inactifs : la fin de contrat, les motifs, et les portes qu'un
 * contrat arrivé à terme referme.
 *
 * La règle de l'APIX : un agent dont le CDD ou le stage est arrivé à terme
 * n'est plus de l'agence. Son dossier passe de lui-même dans les inactifs le
 * lendemain de son dernier jour ; d'ici là, chaque porte vérifie la date :
 * il ne dirige rien, n'est le n+1 de personne, ne reçoit ni affectation ni
 * invitation au portail. Son compte reste ouvert trente jours, restreint, le
 * temps de récupérer ses documents ; ensuite il ne se connecte plus, et son
 * mot de passe s'efface. S'il revient, une invitation le lui fait choisir à
 * nouveau, sur le même compte.
 */
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ECHECS_PAR_COMPTE, Limiteur, empreinte } from '../src/common/limiteur';
import {
  archiveEmployeesSchema,
  newContractSchema,
  peut,
  type SessionUser,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademyController } from '../src/modules/academy/academy.controller';
import { AccesGuard, FERME_AUX_INACTIFS_KEY } from '../src/modules/auth/acces.guard';
import { accesDuCompte } from '../src/modules/people/en-activite';
import {
  agentDuCompte,
  capacitesDe,
  directionDuPersonnel,
  estDeLaDCH,
  pasSurSoi,
  viseur,
} from '../src/modules/acces/dch';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ObjectifsController } from '../src/modules/objectifs/objectifs.controller';
import { inactiverLesContratsEchus } from '../src/modules/people/activite';
import { delaiJusquAMinuit, PassageDeMinuit } from '../src/modules/people/passage-de-minuit';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleController } from '../src/modules/people/people.controller';
import { PeopleService } from '../src/modules/people/people.service';
import { InvitationsService } from '../src/modules/portal/invitations.service';
import { PortalController } from '../src/modules/portal/portal.controller';
import { ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import type { Courriel, Transport } from '../src/modules/courriels/transports';
import { AbsencesController } from '../src/modules/time/absences.controller';
import { AbsencesService } from '../src/modules/time/absences.service';

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

/** Ses affectations : poste, du, au (dernier jour inclus), la plus ancienne d'abord. */
const affectations = async (a: Agent) =>
  (
    await raw(
      `SELECT position_title AS poste, lower(validity)::text AS du,
              CASE WHEN upper_inf(validity) THEN NULL ELSE (upper(validity) - 1)::text END AS au
         FROM assignments WHERE employee_id = $1 ORDER BY lower(validity)`,
      [a.employeeId],
    )
  ).rows as { poste: string; du: string; au: string | null }[];

/** Sa place sous un nouveau contrat : la même qu'à sa dernière affectation. */
const placeDe = async (a: Agent) => ({
  positionTitle: 'Poste',
  orgUnitId: ((
    await raw(
      `SELECT org_unit_id FROM assignments WHERE employee_id = $1 ORDER BY lower(validity) DESC LIMIT 1`,
      [a.employeeId],
    )
  ).rows[0]?.org_unit_id ?? uDFC) as string,
});

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
    'outbound_emails',
    'habilitations',
    'notifications',
    'document_requests',
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
    'outbound_emails',
    'habilitations',
    'notifications',
    'document_requests',
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
  await raw(`DELETE FROM holidays WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM holiday_seeds WHERE tenant_id = $1`, [tenantId]);
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
    // Le rappel d'échéance reçu avant la fin.
    await raw(
      `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, dedupe_key)
       SELECT $1, $2, $3, 'contract_deadline', 'Rappel', 'contract_deadline:' || c.id || ':j7'
         FROM contracts c WHERE c.employee_id = $4`,
      [randomUUID(), tenantId, mariama.userId, fatou.employeeId],
    );

    expect(await inactiver()).toBe(1);

    expect(await statut(fatou)).toEqual({
      status: 'archived',
      inactivite_motif: 'fin_de_contrat',
      depuis: await jour(0),
    });
    // Son dernier jour, noté au dossier ; sa dernière affectation s'arrête là.
    const { rows: fin } = await raw(
      `SELECT fin_activite::text AS fin FROM employees WHERE id = $1`,
      [fatou.employeeId],
    );
    expect(fin[0].fin).toBe(await jour(-1));
    expect(await affectations(fatou)).toEqual([
      { poste: 'Poste', du: '2024-01-01', au: await jour(-1) },
    ]);
    // Et sa fiche ne se modifie plus.
    expect(
      await codeOf(() =>
        people.update(admin, fatou.employeeId, { person: { phone: '770000009' } }),
      ),
    ).toBe('people.dossier_inactif');
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
    // Plus de congé en attente ; sa session, elle, reste ouverte : son
    // portail lui sert encore trente jours.
    const { rows: conges } = await raw(
      `SELECT status FROM absence_requests WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    expect(conges.map((c) => c.status)).toEqual(['cancelled']);
    const { rows: sessions } = await raw(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [fatou.userId],
    );
    expect(sessions[0].n).toBe(1);
    // Qui dirige la DCH l'apprend ; le rappel d'échéance quitte sa boîte.
    const { rows: alertes } = await raw(
      `SELECT recipient_user_id, type, title, remplacee_le IS NOT NULL AS remplacee
         FROM notifications WHERE tenant_id = $1 AND type LIKE 'contract_%' ORDER BY created_at`,
      [tenantId],
    );
    expect(alertes).toEqual([
      expect.objectContaining({ type: 'contract_deadline', remplacee: true }),
      {
        recipient_user_id: mariama.userId,
        type: 'contract_ended',
        title: 'Le CDD de Fatou Test a pris fin',
        remplacee: false,
      },
    ]);

    // Une seule fois.
    expect(await inactiver()).toBe(0);
  });

  it('son équipe, que son propre n+1 ne peut pas reprendre, passe au directeur de sa direction', async () => {
    // Une donnée d'avant la règle : Fatou n'a pas de n+1 — rien à remonter.
    await raw(`UPDATE employees SET manager_employee_id = NULL WHERE id = $1`, [fatou.employeeId]);
    expect(await inactiver()).toBe(1);
    const { rows: n1 } = await raw(`SELECT manager_employee_id FROM employees WHERE id = $1`, [
      ibou.employeeId,
    ]);
    expect(n1[0].manager_employee_id).toBe(omar.employeeId);
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

describe('une tâche que le temps déclenche', () => {
  it('se trace au nom du système, pas de qui ouvrait la page', async () => {
    const apres = await db.withTenant({ tenantId, userId: adminUserId }, async (tx) => {
      await inactiverLesContratsEchus(tx, tenantId);
      // Le contexte de l'appelant revient intact.
      const { rows } = await tx.execute<{ u: string }>(
        sql`SELECT current_setting('app.user_id', true) AS u`,
      );
      return rows[0]?.u;
    });
    expect(apres).toBe(adminUserId);
    const { rows } = await raw(
      `SELECT actor_user_id FROM audit_log
        WHERE table_name = 'employees' AND row_id = $1 AND action = 'UPDATE'
          AND new_data->>'status' = 'archived'`,
      [fatou.employeeId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_user_id === null)).toBe(true);
  });

  it('chaque nuit, juste après minuit à Dakar, sans attendre qu’on ouvre la plateforme', async () => {
    expect(delaiJusquAMinuit(new Date('2026-10-06T23:59:00Z'))).toBe(60_000 + 30_000);
    expect(delaiJusquAMinuit(new Date('2026-10-07T00:00:10Z'))).toBe(
      24 * 3600_000 - 10_000 + 30_000,
    );
    // Le passage, sans session ni utilisateur : Fatou, dont le CDD a pris
    // fin hier, passe dans les inactifs ; le contrat de Moussa qui commence
    // aujourd'hui applique sa place.
    await raw(
      `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE - 1 WHERE employee_id = $1`,
      [moussa.employeeId],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date,
                              planned_position_title, planned_org_unit_id)
       VALUES ($1, $2, $3, 'cdi', CURRENT_DATE, 'Analyste', $4)`,
      [randomUUID(), tenantId, moussa.employeeId, uDFC],
    );
    const passage = new PassageDeMinuit(db);
    expect(await passage.passer([tenantId])).toBe(1);
    expect((await statut(fatou)).status).toBe('archived');
    expect((await statut(moussa)).status).toBe('active');
    expect((await affectations(moussa)).at(-1)).toEqual({
      poste: 'Analyste',
      du: await jour(0),
      au: null,
    });
  });
});

describe('avant même le passage, un contrat échu ferme les portes', () => {
  it('ni n+1, ni responsable d’unité, ni affectation, ni invitation au portail', async () => {
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
    // Un collègue en activité se connecte, sans restriction.
    expect(
      (await auth.login({ email: moussa.email, password: MOT_DE_PASSE }, {})).user.finDAcces,
    ).toBeNull();
  });

  it('ni n+1 qui vise, ni membre de la DCH, ni agent de son compte', async () => {
    // Le contrat de la directrice du Capital Humain finit hier, son dossier
    // n'est pas encore rangé : elle ne vise plus, ne traite plus.
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 1 WHERE employee_id = $1`, [
      mariama.employeeId,
    ]);
    const vu = await db.withTenant({ tenantId, userId: adminUserId }, async (tx) => {
      const dch = await directionDuPersonnel(tx);
      return {
        fatou: await viseur(tx, fatou.employeeId),
        directrice: dch?.directeur ?? null,
        deLaDCH: dch ? await estDeLaDCH(tx, dch, mariama.employeeId) : null,
        compte: await agentDuCompte(tx, mariama.userId),
        actif: await viseur(tx, moussa.employeeId),
      };
    });
    expect(vu).toMatchObject({ fatou: null, directrice: null, deLaDCH: false, compte: null });
    expect(vu.actif?.employeeId).toBe(moussa.employeeId);
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

describe('trente jours pour récupérer ses documents', () => {
  /** Le dernier jour d'accès : trente jours après la fin d'activité, selon la base. */
  const trenteJoursApres = async (fin: string) => {
    const { rows } = await raw(`SELECT ($1::date + 30)::text AS d`, [fin]);
    return rows[0].d as string;
  };

  it('son contrat terminé, elle se connecte encore trente jours : un portail restreint, sans habilitation', async () => {
    const { token, user } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    expect(user).toMatchObject({
      finDAcces: await trenteJoursApres(await jour(-1)),
      estAgent: false,
      dirigeLaDCH: false,
      capacites: [],
    });
    // Passé ce délai, la porte se ferme : à la connexion, et pour la session ouverte.
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 40 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.employee_archived',
    );
    expect(await auth.resolveSession(token)).toBeNull();
    const refus = await auth
      .login({ email: fatou.email, password: MOT_DE_PASSE }, {})
      .catch((e: ProblemException) => e.problem.detail);
    expect(refus).toMatch(/^Votre accès au portail a pris fin le .+ Il sera rouvert/);
  });

  it('désactivée à la main, même délai, compté depuis sa fin d’activité', async () => {
    await raw(
      `UPDATE contracts SET end_date = NULL, contract_type = 'cdi' WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uCompta]);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
      ibou.employeeId,
      omar.employeeId,
    ]);
    const r = await people.archive(admin, {
      ids: [fatou.employeeId],
      archived: true,
      motif: 'demission',
    });
    expect(r.done).toBe(1);
    const { user } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    expect(user.finDAcces).toBe(await trenteJoursApres(await jour(0)));
    // Elle suit encore les documents qu'elle a demandés.
    const documents = new DocumentRequestsService(db, new NotificationsService(db));
    await documents.create(user, { docTypes: ['certificat_travail'] });
    expect(await documents.list(user, { scope: 'mine' })).toHaveLength(1);
    // Trente et un jours plus tard, c'est fini.
    await raw(`UPDATE employees SET fin_activite = CURRENT_DATE - 31 WHERE id = $1`, [
      fatou.employeeId,
    ]);
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.employee_archived',
    );
  });

  it('ce qui lui est fermé ces trente jours : demandes d’absence, objectifs, Academy, organigramme', () => {
    const ferme = (cible: object) => Reflect.getMetadata(FERME_AUX_INACTIFS_KEY, cible) === true;
    expect(ferme(AcademyController)).toBe(true);
    expect(ferme(ObjectifsController)).toBe(true);
    expect(ferme(PeopleController.prototype.listOrgUnits)).toBe(true);
    expect(ferme(PeopleController.prototype.orgUnitMembers)).toBe(true);
    expect(ferme(AbsencesController.prototype.createRequest)).toBe(true);
    expect(ferme(AbsencesController.prototype.preview)).toBe(true);
    // Ses documents, son historique de congés, ses certificats restent ouverts.
    expect(ferme(AbsencesController.prototype.listRequests)).toBe(false);
    expect(ferme(AcademyController.prototype.mesCertificats)).toBe(false);
    expect(ferme(AcademyController.prototype.certificatPdf)).toBe(false);

    const garde = new AccesGuard(new Reflector());
    const contexte = (
      handler: object,
      finDAcces: string | null,
      classe: object = AbsencesController,
    ) =>
      ({
        getHandler: () => handler,
        getClass: () => classe,
        switchToHttp: () => ({
          getRequest: () => ({ sessionUser: { role: 'employee', capacites: [], finDAcces } }),
        }),
      }) as unknown as ExecutionContext;
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'AUCUNE ERREUR';
      } catch (err) {
        return (err as ProblemException).problem.code;
      }
    };
    const poser = AbsencesController.prototype.createRequest;
    expect(code(() => garde.canActivate(contexte(poser, '2026-11-02')))).toBe('acces.inactif');
    expect(code(() => garde.canActivate(contexte(poser, null)))).toBe('AUCUNE ERREUR');
    expect(
      code(() =>
        garde.canActivate(contexte(AbsencesController.prototype.listRequests, '2026-11-02')),
      ),
    ).toBe('AUCUNE ERREUR');
    // Dans l'Academy fermée, « Mes certificats » reste ouvert.
    const academie = AcademyController.prototype;
    expect(
      code(() =>
        garde.canActivate(contexte(academie.mesCertificats, '2026-11-02', AcademyController)),
      ),
    ).toBe('AUCUNE ERREUR');
    expect(
      code(() => garde.canActivate(contexte(academie.catalogue, '2026-11-02', AcademyController))),
    ).toBe('acces.inactif');
  });
});

describe('un administrateur dont le dossier part', () => {
  const role = (a: { userId: string }, r: 'admin' | 'employee') =>
    raw(`UPDATE user_tenant_memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      tenantId,
      a.userId,
      r,
    ]);
  const dernierAdmin = async (a: Agent) =>
    (
      await raw(`SELECT recipient_user_id AS qui FROM notifications WHERE dedupe_key = $1`, [
        `dernier_admin:${a.employeeId}`,
      ])
    ).rows.map((r) => r.qui as string);

  it('pendant les trente jours restreints, le rôle d’administrateur ne lui donne plus rien', async () => {
    await role(fatou, 'admin');
    const { token, user } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    expect(user).toMatchObject({ role: 'employee', capacites: [] });
    expect(peut(user, 'personnel.gerer')).toBe(false);
    expect(peut(user, 'textes')).toBe(false);
    expect((await auth.resolveSession(token))?.role).toBe('employee');
    // Son dossier, même parti, lui reste fermé.
    expect(
      await codeOf(() =>
        db.withTenant({ tenantId, userId: fatou.userId }, (tx) =>
          pasSurSoi(tx, fatou.userId, [fatou.employeeId], 'modifier'),
        ),
      ),
    ).toBe('acces.son_propre_dossier');
  });

  it('le dernier administrateur parti, la gestion du personnel en est prévenue', async () => {
    await role(fatou, 'admin');
    // Un autre administrateur en fonction : rien à signaler.
    expect(await inactiver()).toBe(1);
    expect(await dernierAdmin(fatou)).toEqual([]);

    // Le seul administrateur restant voit son CDD finir : plus personne.
    const awa = await agent('Awa', uDFC, { type: 'cdd', debut: -200, fin: -1 }, omar.employeeId);
    await role(awa, 'admin');
    await role({ userId: adminUserId }, 'employee');
    try {
      expect(await inactiver()).toBe(1);
      expect(await dernierAdmin(awa)).toEqual([mariama.userId]);
    } finally {
      await role({ userId: adminUserId }, 'admin');
    }
  });

  it('un administrateur dont le dossier est parti ne compte plus comme « un autre administrateur »', async () => {
    await role(fatou, 'admin');
    await role(moussa, 'admin');
    await role({ userId: adminUserId }, 'employee');
    try {
      const fermer = () =>
        people.archive(admin, { ids: [moussa.employeeId], archived: true, motif: 'demission' });
      const r = await fermer();
      expect(r.done).toBe(0);
      expect(JSON.stringify(r)).toContain("Dernier administrateur de l'organisation");
      // Rouvrir un dossier ne retire d'administrateur à personne.
      await raw(
        `UPDATE contracts SET end_date = NULL, contract_type = 'cdi' WHERE employee_id = $1`,
        [fatou.employeeId],
      );
      await raw(
        `UPDATE employees SET status = 'archived', archived_at = now(), inactivite_motif = 'demission',
                fin_activite = CURRENT_DATE - 1 WHERE id = $1`,
        [fatou.employeeId],
      );
      const rouvrir = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
      expect(rouvrir.done).toBe(1);
    } finally {
      await role({ userId: adminUserId }, 'admin');
    }
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
    // Son dernier jour, c'est aujourd'hui : « Fin contrat » le dit, la liste aussi.
    expect(fiche).toMatchObject({
      status: 'archived',
      inactiviteMotif: 'demission',
      finActivite: await jour(0),
    });
    expect(fiche.assignments.every((a) => !a.current || a.validTo !== null)).toBe(true);
    const liste = await people.list(admin, {
      status: 'archived',
      limit: 20,
      offset: 0,
      sort: 'name',
      dir: 'asc',
    } as never);
    const ligne = liste.items.find((e) => e.id === moussa.employeeId);
    expect(ligne).toMatchObject({ inactiviteMotif: 'demission', contractEndDate: await jour(0) });
  });

  it('pas de réactivation tant que le contrat est échu : le nouveau contrat d’abord', async () => {
    await inactiver();
    const refus = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
    expect(refus.done).toBe(0);
    expect(refus.skipped[0]?.reason).toMatch(
      /^Le contrat de Fatou a pris fin le .+\. Enregistrez son nouveau contrat avant de réactiver son compte\.$/,
    );

    expect(
      await codeOf(async () =>
        people.newContract(admin, fatou.employeeId, {
          affectation: await placeDe(fatou),
          contractType: 'cdd',
          startDate: await jour(-400),
          endDate: await jour(-10),
        }),
      ),
    ).toBe('people.contrat_avant_le_precedent');
    await people.newContract(admin, fatou.employeeId, {
      affectation: await placeDe(fatou),
      contractType: 'cdd',
      startDate: await jour(0),
      endDate: await jour(180),
    });
    const ok = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
    expect(ok.done).toBe(1);
    expect(await statut(fatou)).toMatchObject({ status: 'active', inactivite_motif: null });
    // Son nouveau contrat commence le lendemain de la fin du précédent : pas
    // d'interruption, son affectation reprend son cours, sans départ inscrit.
    expect(await affectations(fatou)).toEqual([{ poste: 'Poste', du: '2024-01-01', au: null }]);
    const { rows: departs } = await raw(
      `SELECT count(*)::int AS n FROM periodes_inactivite WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    expect(departs[0].n).toBe(0);
    const { rows: fin } = await raw(`SELECT fin_activite FROM employees WHERE id = $1`, [
      fatou.employeeId,
    ]);
    expect(fin[0].fin_activite).toBeNull();
  });

  it('un contrat signé la semaine dernière s’enregistre à sa date, et rouvre le dossier', async () => {
    await inactiver();
    await people.newContract(admin, fatou.employeeId, {
      affectation: await placeDe(fatou),
      contractType: 'stage',
      startDate: await jour(-7),
      endDate: await jour(80),
    });
    const ok = await people.archive(admin, { ids: [fatou.employeeId], archived: false });
    expect(ok.done).toBe(1);
    const { rows } = await raw(
      `SELECT contract_type, start_date::text AS debut, end_date::text AS fin
         FROM contracts WHERE employee_id = $1 ORDER BY start_date`,
      [fatou.employeeId],
    );
    expect(rows.at(-1)).toEqual({
      contract_type: 'stage',
      debut: await jour(-7),
      fin: await jour(80),
    });
  });

  it('un nouveau contrat est un CDI, un CDD ou un stage : plus de consultant ni de détachement', () => {
    const contrat = (contractType: string) =>
      newContractSchema.safeParse({
        contractType,
        startDate: '2026-10-01',
        endDate: '2027-03-31',
        affectation: { positionTitle: 'Poste', orgUnitId: randomUUID() },
      }).success;
    expect(['cdi', 'cdd', 'stage'].map(contrat)).toEqual([true, true, true]);
    expect(['consultant', 'detachement'].map(contrat)).toEqual([false, false]);
  });

  it('un nouveau contrat arrête le précédent la veille, s’il courait encore', async () => {
    await people.newContract(admin, moussa.employeeId, {
      affectation: await placeDe(moussa),
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

describe('un CDD renouvelé ne prend pas fin', () => {
  it('ni alerte de fin pour lui, ni reste de celles déjà parties', async () => {
    const notifications = new NotificationsService(db);
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE + 10 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    const alertes = async () =>
      (
        await raw(
          `SELECT title FROM notifications
            WHERE tenant_id = $1 AND type = 'contract_deadline' AND title LIKE '%Fatou%'`,
          [tenantId],
        )
      ).rows.length;
    await notifications.list(admin);
    expect(await alertes()).toBe(1);

    // Renouvelée au lendemain de sa fin : l'ancien contrat garde sa date.
    await people.newContract(admin, fatou.employeeId, {
      affectation: await placeDe(fatou),
      contractType: 'cdd',
      startDate: await jour(11),
      endDate: await jour(376),
    });
    expect(await alertes()).toBe(0);
    await notifications.list(admin);
    expect(await alertes()).toBe(0);
  });
});

describe('une invitation en attente quand le dossier ferme', () => {
  /** Un agent sans compte, et l'invitation qu'on lui envoie : le jeton du lien. */
  async function invite(a: Agent): Promise<string> {
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [a.employeeId],
    );
    const { invitePath } = await invitations.invite(
      admin,
      a.employeeId,
      'employee',
      `invite-${randomUUID()}@test.local`,
    );
    return invitePath.split('/').pop() as string;
  }

  it('l’archivage la referme : le lien ne s’ouvre plus', async () => {
    const jeton = await invite(moussa);
    expect((await invitations.info(jeton)).valid).toBe(true);
    await people.archive(admin, { ids: [moussa.employeeId], archived: true, motif: 'demission' });
    expect(await invitations.info(jeton)).toEqual({ valid: false, reason: 'expired' });
    expect(await codeOf(() => invitations.accept(jeton, 'UnMotDePasseNeuf1!', {}))).toBe(
      'portal.invitation_invalid',
    );
  });

  it('un contrat échu depuis l’envoi la refuse, avant même que la liste le range', async () => {
    const jeton = await invite(moussa);
    await raw(
      `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE - 1 WHERE employee_id = $1`,
      [moussa.employeeId],
    );
    expect((await statut(moussa)).status).toBe('active');
    expect(await invitations.info(jeton)).toEqual({ valid: false, reason: 'expired' });
    expect(await codeOf(() => invitations.accept(jeton, 'UnMotDePasseNeuf1!', {}))).toBe(
      'portal.invitation_invalid',
    );
    // Rien n'a été créé : ni compte relié, ni appartenance.
    const { rows } = await raw(
      `SELECT p.user_id, i.accepted_at FROM persons p JOIN invitations i ON i.person_id = p.id
        WHERE p.id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    );
    expect(rows).toEqual([{ user_id: null, accepted_at: null }]);
  });

  it('un dossier en activité l’accepte', async () => {
    const jeton = await invite(moussa);
    const { result } = await invitations.accept(jeton, 'UnMotDePasseNeuf1!', {});
    expect(result.existingUser).toBe(false);
  });
});

describe('un départ et ses congés', () => {
  /** Un congé de Moussa, déjà validé, du jour `du` au jour `au` (relatifs à aujourd'hui). */
  async function congeValide(typeId: string, du: number, au: number): Promise<string> {
    const id = randomUUID();
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::int, CURRENT_DATE + $6::int, 1, 'approved')`,
      [id, tenantId, moussa.employeeId, typeId, du, au],
    );
    return id;
  }
  const etat = async (id: string) =>
    (
      await raw(
        `SELECT status, end_date::text AS au, fin_initiale::text AS prevu FROM absence_requests WHERE id = $1`,
        [id],
      )
    ).rows[0] as { status: string; au: string; prevu: string | null };

  it('qui part perd ses congés à venir ; celui qui dépasse son dernier jour s’arrête ce jour-là', async () => {
    const typeId = randomUUID();
    await raw(`INSERT INTO absence_types (id, tenant_id, name) VALUES ($1,$2,'Congé annuel')`, [
      typeId,
      tenantId,
    ]);
    const aVenir = await congeValide(typeId, 20, 24);
    const enCours = await congeValide(typeId, -3, 6);
    const passe = await congeValide(typeId, -40, -38);
    await people.archive(admin, { ids: [moussa.employeeId], archived: true, motif: 'demission' });
    expect((await etat(aVenir)).status).toBe('cancelled');
    expect(await etat(enCours)).toEqual({
      status: 'approved',
      au: await jour(0),
      prevu: await jour(6),
    });
    expect((await etat(passe)).status).toBe('approved');
  });

  it('une demande ne sort pas du contrat : ni avant son début, ni après sa fin', async () => {
    const absences = new AbsencesService(db);
    const typeId = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, deducts_balance) VALUES ($1,$2,'Mission',false)`,
      [typeId, tenantId],
    );
    await raw(
      `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE + 30 WHERE employee_id = $1`,
      [moussa.employeeId],
    );
    const { user } = await auth.login({ email: moussa.email, password: MOT_DE_PASSE }, {});
    const demander = (du: number, au: number) =>
      codeOf(async () =>
        absences.createRequest(user, {
          employeeId: moussa.employeeId,
          absenceTypeId: typeId,
          startDate: await jour(du),
          endDate: await jour(au),
        }),
      );
    expect(await demander(25, 40)).toBe('absence.hors_contrat');
    expect(await demander(-1000, -998)).toBe('absence.hors_contrat');
    expect(await demander(25, 30)).toBe('AUCUNE ERREUR');
  });
});

describe('couper un accès', () => {
  const entrer = (a: Agent) => auth.login({ email: a.email, password: MOT_DE_PASSE }, {});

  it('un licenciement ou un décès ferme le portail le jour même, sans les trente jours', async () => {
    const { token } = await entrer(moussa);
    await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'licenciement',
    });
    expect(await auth.resolveSession(token)).toBeNull();
    expect(await codeOf(() => entrer(moussa))).toBe('auth.employee_archived');
  });

  it('couper : déconnecté de partout, il ne revient pas ; rétabli, il revient', async () => {
    const { token } = await entrer(moussa);
    const { token: autreAppareil } = await entrer(moussa);
    await invitations.couperLAcces(admin, moussa.employeeId, true);
    expect(await auth.resolveSession(token)).toBeNull();
    expect(await auth.resolveSession(autreAppareil)).toBeNull();
    expect(await codeOf(() => entrer(moussa))).toBe('auth.acces_coupe');
    expect((await people.detail(admin, moussa.employeeId)).portal.status).toBe('coupe');

    await invitations.couperLAcces(admin, moussa.employeeId, false);
    expect(await codeOf(() => entrer(moussa))).toBe('AUCUNE ERREUR');
    expect((await people.detail(admin, moussa.employeeId)).portal.status).toBe('active');
  });

  it('personne ne coupe le sien ; l’accès du directeur du Capital Humain, seul l’administrateur le coupe', async () => {
    const gestionnaire = {
      userId: omar.userId,
      tenantId,
      role: 'employee',
      capacites: ['personnel.gerer'],
    } as unknown as SessionUser;
    expect(await codeOf(() => invitations.couperLAcces(gestionnaire, omar.employeeId, true))).toBe(
      'acces.son_propre_dossier',
    );
    expect(
      await codeOf(() => invitations.couperLAcces(gestionnaire, mariama.employeeId, true)),
    ).toBe('portal.acces_reserve_admin');
    expect(
      await codeOf(() => invitations.couperLAcces(gestionnaire, moussa.employeeId, true)),
    ).toBe('AUCUNE ERREUR');
    expect(await codeOf(() => invitations.couperLAcces(admin, mariama.employeeId, true))).toBe(
      'AUCUNE ERREUR',
    );
    await invitations.couperLAcces(admin, mariama.employeeId, false);
    await invitations.couperLAcces(admin, moussa.employeeId, false);
  });

  it('se déconnecter partout ferme toutes ses sessions', async () => {
    const a = await entrer(moussa);
    const b = await entrer(moussa);
    await auth.deconnecterPartout(a.user.userId);
    expect(await auth.resolveSession(a.token)).toBeNull();
    expect(await auth.resolveSession(b.token)).toBeNull();
    expect(await codeOf(() => entrer(moussa))).toBe('AUCUNE ERREUR');
  });
});

describe('les droits du portail (audit)', () => {
  const NEUF = 'UnMotDePasseNeuf1!';
  const cdi = { type: 'cdi', debut: -900, fin: null };
  const jeton = (invitePath: string) => invitePath.split('/').pop() as string;
  const gestionnaire = () =>
    ({
      userId: omar.userId,
      tenantId,
      role: 'employee',
      capacites: ['personnel.gerer'],
    }) as unknown as SessionUser;

  it('un délégué ne rouvre pas l’accès qu’un autre a coupé ; le sien, oui', async () => {
    await invitations.couperLAcces(admin, moussa.employeeId, true);
    expect(
      await codeOf(() => invitations.couperLAcces(gestionnaire(), moussa.employeeId, false)),
    ).toBe('portal.retablir_reserve');
    await invitations.couperLAcces(admin, moussa.employeeId, false);

    await invitations.couperLAcces(gestionnaire(), moussa.employeeId, true);
    expect(
      await codeOf(() => invitations.couperLAcces(gestionnaire(), moussa.employeeId, false)),
    ).toBe('AUCUNE ERREUR');
  });

  it('un délégué n’invite ni le DG, ni le directeur du Capital Humain, ni un administrateur', async () => {
    for (const protege of [dg, mariama]) {
      expect(
        await codeOf(() => invitations.invite(gestionnaire(), protege.employeeId, 'employee')),
      ).toBe('portal.invitation_reservee');
    }
    await raw(`UPDATE user_tenant_memberships SET role = 'admin' WHERE user_id = $1`, [
      moussa.userId,
    ]);
    try {
      expect(
        await codeOf(() => invitations.invite(gestionnaire(), moussa.employeeId, 'employee')),
      ).toBe('portal.invitation_reservee');
    } finally {
      await raw(`UPDATE user_tenant_memberships SET role = 'employee' WHERE user_id = $1`, [
        moussa.userId,
      ]);
    }
    // Un agent comme les autres : la règle ne l'arrête pas (il a déjà son accès).
    expect(
      await codeOf(() => invitations.invite(gestionnaire(), moussa.employeeId, 'employee')),
    ).toBe('portal.already_active');
  });

  it('deviner le mot de passe d’un compte par une invitation : le compteur de la connexion', async () => {
    const limiteur = new Limiteur(db);
    const surveillee = new InvitationsService(db, auth, undefined, limiteur);
    const sujet = empreinte(moussa.email);
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    );
    try {
      const { invitePath } = await surveillee.invite(
        admin,
        moussa.employeeId,
        'employee',
        moussa.email,
      );
      for (let i = 0; i < 10; i++) {
        expect(
          await codeOf(() => surveillee.accept(jeton(invitePath), `Faux${i}MotDePasse!`, {})),
        ).toBe('portal.existing_account');
      }
      // Même le bon mot de passe attend : le compte est sous surveillance.
      expect(await codeOf(() => surveillee.accept(jeton(invitePath), MOT_DE_PASSE, {}))).toBe(
        'auth.too_many_attempts',
      );
      expect((await limiteur.consulter(ECHECS_PAR_COMPTE, sujet)).bloque).toBe(true);
    } finally {
      await limiteur.oublier(ECHECS_PAR_COMPTE, sujet);
      await raw(
        `UPDATE persons SET user_id = $2 WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
        [moussa.employeeId, moussa.userId],
      );
    }
  });

  it('une invitation ne reprend pas l’adresse d’un compte qui sert ailleurs', async () => {
    const autreTenant = randomUUID();
    const compteFerme = randomUUID();
    const adresse = `ailleurs-${compteFerme}@test.local`;
    await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Autre', $2)`, [
      autreTenant,
      `autre-${autreTenant.slice(0, 8)}`,
    ]);
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, NULL, 'Ailleurs', 'Test')`,
      [compteFerme, adresse],
    );
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
      [randomUUID(), autreTenant, compteFerme],
    );
    const nouveau = await agent('Nouveau', uDFC, cdi, dg.employeeId);
    await raw(`UPDATE persons SET user_id = NULL WHERE user_id = $1`, [nouveau.userId]);
    try {
      const { invitePath } = await invitations.invite(
        admin,
        nouveau.employeeId,
        'employee',
        adresse,
      );
      expect(await codeOf(() => invitations.accept(jeton(invitePath), NEUF, {}))).toBe(
        'portal.adresse_prise',
      );
      const { rows } = await raw(`SELECT email FROM users WHERE id = $1`, [compteFerme]);
      expect(rows[0].email).toBe(adresse);
    } finally {
      await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [autreTenant]);
      await raw(`DELETE FROM users WHERE id = $1`, [compteFerme]);
      await raw(`DELETE FROM tenants WHERE id = $1`, [autreTenant]);
    }
  });
});

describe('corriger ce qui a été saisi par erreur', () => {
  const contrats = async (a: Agent) =>
    (
      await raw(
        `SELECT id, contract_type AS type, start_date::text AS du, end_date::text AS au
           FROM contracts WHERE employee_id = $1 ORDER BY start_date`,
        [a.employeeId],
      )
    ).rows as { id: string; type: string; du: string; au: string | null }[];

  it('un CDD saisi trop court : corrigé, le dossier passé à tort dans les inactifs se rouvre', async () => {
    expect(await inactiver()).toBe(1);
    expect((await statut(fatou)).status).toBe('archived');
    const [cdd] = await contrats(fatou);
    const r = await people.corrigerContrat(admin, fatou.employeeId, cdd!.id, {
      contractType: 'cdd',
      startDate: cdd!.du,
      endDate: await jour(330),
    });
    expect(r).toEqual({ rouvert: true });
    expect((await statut(fatou)).status).toBe('active');
    expect((await contrats(fatou))[0]!.au).toBe(await jour(330));
    expect((await affectations(fatou)).at(-1)!.au).toBeNull();
  });

  it('une fin corrigée déjà passée fait passer l’agent dans les inactifs', async () => {
    const [cdi] = await contrats(moussa);
    await people.corrigerContrat(admin, moussa.employeeId, cdi!.id, {
      contractType: 'cdd',
      startDate: cdi!.du,
      endDate: await jour(-2),
    });
    expect((await statut(moussa)).status).toBe('archived');
  });

  it('seul le dernier contrat se corrige ; le précédent se recale sur son début', async () => {
    const [cdi] = await contrats(moussa);
    await people.newContract(admin, moussa.employeeId, {
      affectation: await placeDe(moussa),
      contractType: 'cdd',
      startDate: await jour(10),
      endDate: await jour(375),
    });
    expect(
      await codeOf(() =>
        people.corrigerContrat(admin, moussa.employeeId, cdi!.id, {
          contractType: 'cdi',
          startDate: cdi!.du,
        }),
      ),
    ).toBe('people.contrat_pas_le_dernier');
    const [, cdd] = await contrats(moussa);
    await people.corrigerContrat(admin, moussa.employeeId, cdd!.id, {
      contractType: 'cdd',
      startDate: await jour(20),
      endDate: await jour(385),
    });
    expect((await contrats(moussa)).map((c) => c.au)).toEqual([await jour(19), await jour(385)]);
  });

  it('une mutation saisie par erreur s’annule : l’affectation précédente reprend', async () => {
    await people.newAssignment(admin, moussa.employeeId, {
      orgUnitId: uCompta,
      positionTitle: 'Comptable',
      startDate: await jour(0),
    });
    const [, nouvelle] = (
      await raw(`SELECT id FROM assignments WHERE employee_id = $1 ORDER BY lower(validity)`, [
        moussa.employeeId,
      ])
    ).rows as { id: string }[];
    await people.annulerAffectation(admin, moussa.employeeId, nouvelle!.id);
    expect(await affectations(moussa)).toEqual([{ poste: 'Poste', du: '2024-01-01', au: null }]);
    // La seule qui reste ne s'annule pas : il resterait sans affectation.
    const [seule] = (
      await raw(`SELECT id FROM assignments WHERE employee_id = $1`, [moussa.employeeId])
    ).rows as { id: string }[];
    expect(await codeOf(() => people.annulerAffectation(admin, moussa.employeeId, seule!.id))).toBe(
      'people.affectation_seule',
    );
  });

  it('l’affectation en cours se corrige : son poste, sa date ; la précédente s’y recale', async () => {
    await people.newAssignment(admin, moussa.employeeId, {
      orgUnitId: uDFC,
      positionTitle: 'Analyste',
      startDate: await jour(0),
    });
    const [, derniere] = (
      await raw(`SELECT id FROM assignments WHERE employee_id = $1 ORDER BY lower(validity)`, [
        moussa.employeeId,
      ])
    ).rows as { id: string }[];
    await people.corrigerAffectation(admin, moussa.employeeId, derniere!.id, {
      positionTitle: 'Analyste financier',
      startDate: await jour(-30),
    });
    expect(await affectations(moussa)).toEqual([
      { poste: 'Poste', du: '2024-01-01', au: await jour(-31) },
      { poste: 'Analyste financier', du: await jour(-30), au: null },
    ]);
  });
});

describe('un départ daté, un retour daté', () => {
  const periodes = async (a: Agent) =>
    (
      await raw(
        `SELECT dernier_jour::text AS dernier, motif, reprise_le::text AS reprise
           FROM periodes_inactivite WHERE employee_id = $1 ORDER BY dernier_jour`,
        [a.employeeId],
      )
    ).rows;

  it('le départ se date de son dernier jour, jamais dans le futur ni avant son arrivée', async () => {
    expect(
      await codeOf(async () =>
        people.archive(admin, {
          ids: [moussa.employeeId],
          archived: true,
          motif: 'demission',
          le: await jour(1),
        }),
      ),
    ).toBe('people.date_future');
    const avant = await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: '2023-12-31',
    });
    expect(avant.done).toBe(0);
    expect(avant.skipped[0]?.reason).toBe(
      'Son activité a commencé le 1er janvier 2024 : son dernier jour ne peut pas la précéder',
    );

    const r = await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-10),
    });
    expect(r.done).toBe(1);
    expect((await people.detail(admin, moussa.employeeId)).finActivite).toBe(await jour(-10));
    expect(await affectations(moussa)).toEqual([
      { poste: 'Poste', du: '2024-01-01', au: await jour(-10) },
    ]);
    expect(await periodes(moussa)).toEqual([
      { dernier: await jour(-10), motif: 'demission', reprise: null },
    ]);
  });

  it('réactivé le jour même, il n’est jamais parti : son unité, il la garde le lendemain', async () => {
    await people.archive(admin, { ids: [moussa.employeeId], archived: true, motif: 'demission' });
    const r = await people.archive(admin, { ids: [moussa.employeeId], archived: false });
    expect(r.done).toBe(1);
    expect(await affectations(moussa)).toEqual([{ poste: 'Poste', du: '2024-01-01', au: null }]);
    expect(await periodes(moussa)).toEqual([]);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM assignments
        WHERE employee_id = $1 AND validity @> (CURRENT_DATE + 1) AND org_unit_id = $2`,
      [moussa.employeeId, uDFC],
    );
    expect(rows[0].n).toBe(1);
    expect((await people.detail(admin, moussa.employeeId)).interruptions).toEqual([]);
  });

  it('une réintégration garde le départ, reprend au jour du retour, et l’intervalle ne compte pas', async () => {
    await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-100),
    });
    const tot = await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: false,
      le: await jour(-100),
    });
    expect(tot.skipped[0]?.reason).toMatch(
      /^Son dernier jour était le .+ : la reprise vient après$/,
    );

    // Sans date : aujourd'hui, pas le lendemain du départ.
    expect((await people.detail(admin, moussa.employeeId)).repriseParDefaut).toBe(await jour(0));
    const r = await people.archive(admin, { ids: [moussa.employeeId], archived: false });
    expect(r.done).toBe(1);
    expect(await affectations(moussa)).toEqual([
      { poste: 'Poste', du: '2024-01-01', au: await jour(-100) },
      { poste: 'Poste', du: await jour(0), au: null },
    ]);
    expect(await periodes(moussa)).toEqual([
      { dernier: await jour(-100), motif: 'demission', reprise: await jour(0) },
    ]);
    const fiche = await people.detail(admin, moussa.employeeId);
    expect(fiche.interruptions).toEqual([
      { dernierJour: await jour(-100), repriseLe: await jour(0) },
    ]);
    expect(fiche.finActivite).toBeNull();
  });

  it('un retour daté dans le passé ; un contrat enregistré depuis le départ donne sa date', async () => {
    await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-60),
    });
    await people.archive(admin, { ids: [moussa.employeeId], archived: false, le: await jour(-20) });
    expect(await periodes(moussa)).toEqual([
      { dernier: await jour(-60), motif: 'demission', reprise: await jour(-20) },
    ]);
    expect((await affectations(moussa)).at(-1)).toEqual({
      poste: 'Poste',
      du: await jour(-20),
      au: null,
    });

    await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-5),
    });
    // Le nouveau contrat rouvre le dossier, à sa date.
    const r = await people.newContract(admin, moussa.employeeId, {
      affectation: await placeDe(moussa),
      contractType: 'cdd',
      startDate: await jour(-2),
      endDate: await jour(200),
    });
    expect(r.rouvert).toBe(true);
    expect((await periodes(moussa)).at(-1)).toEqual({
      dernier: await jour(-5),
      motif: 'demission',
      reprise: await jour(-2),
    });
  });

  it('un départ avant son retour précédent est refusé', async () => {
    await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-60),
    });
    await people.archive(admin, { ids: [moussa.employeeId], archived: false, le: await jour(-20) });
    const r = await people.archive(admin, {
      ids: [moussa.employeeId],
      archived: true,
      motif: 'demission',
      le: await jour(-30),
    });
    expect(r.done).toBe(0);
    expect(r.skipped[0]?.reason).toMatch(/^Son activité a commencé le .+ : son dernier jour/);
  });

  it('une fin de contrat, d’elle-même, s’inscrit aussi dans ses départs', async () => {
    await inactiver();
    expect(await periodes(fatou)).toEqual([
      { dernier: await jour(-1), motif: 'fin_de_contrat', reprise: null },
    ]);
  });
});

describe('qui revient', () => {
  const NEUF = 'UnMotDePasseNeuf1!';
  const motDePasse = async (a: Agent) =>
    (await raw(`SELECT password_hash FROM users WHERE id = $1`, [a.userId])).rows[0]
      .password_hash as string | null;
  const portail = async (a: Agent) => (await people.detail(admin, a.employeeId)).portal.status;
  const jeton = (invitePath: string) => invitePath.split('/').pop() as string;

  /** Elle revient avec un CDI : son nouveau contrat rouvre son dossier. */
  async function revient(a: Agent): Promise<void> {
    const r = await people.newContract(admin, a.employeeId, {
      affectation: await placeDe(a),
      contractType: 'cdi',
      startDate: await jour(0),
    });
    expect(r.rouvert).toBe(true);
  }

  it('trente jours après son dernier jour, elle se connecte encore ; le lendemain, son mot de passe s’efface', async () => {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 30 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
    const { token, user } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    expect(user.finDAcces).toBe(await jour(0));

    await raw(`UPDATE employees SET fin_activite = CURRENT_DATE - 31 WHERE id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
    expect(await motDePasse(fatou)).toBeNull();
    expect(await auth.resolveSession(token)).toBeNull();
    // Rien ne la distingue d'un compte inconnu.
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.invalid_credentials',
    );
  });

  it('revenue dans les trente jours, elle retrouve son accès avec son mot de passe', async () => {
    await inactiver();
    await revient(fatou);
    expect(await motDePasse(fatou)).not.toBeNull();
    expect(await portail(fatou)).toBe('active');
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'AUCUNE ERREUR',
    );
    expect(await codeOf(() => invitations.invite(admin, fatou.employeeId, 'employee'))).toBe(
      'portal.already_active',
    );
  });

  it('revenue après, elle est invitée comme une nouvelle, et retrouve son compte : rien ne se perd', async () => {
    // Pendant ses trente jours, elle demande un certificat de travail.
    await inactiver();
    const { user: avant } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    const documents = new DocumentRequestsService(db, new NotificationsService(db));
    await documents.create(avant, { docTypes: ['certificat_travail'] });

    // Quarante-cinq jours ont passé.
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await raw(`UPDATE employees SET fin_activite = CURRENT_DATE - 45 WHERE id = $1`, [
      fatou.employeeId,
    ]);
    await raw(
      `UPDATE periodes_inactivite SET dernier_jour = CURRENT_DATE - 45 WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    await inactiver();
    expect(await motDePasse(fatou)).toBeNull();
    expect(await portail(fatou)).toBe('ferme');
    // Inactive, pas d'invitation : son dossier se rouvre d'abord.
    expect(await codeOf(() => invitations.invite(admin, fatou.employeeId, 'employee'))).toBe(
      'portal.employee_archived',
    );

    await revient(fatou);
    expect(await portail(fatou)).toBe('ferme');
    const { invitePath } = await invitations.invite(
      admin,
      fatou.employeeId,
      'employee',
      fatou.email,
    );
    expect(await invitations.info(jeton(invitePath))).toMatchObject({
      valid: true,
      accueil: 'retour',
      email: fatou.email,
    });
    // Comme un nouveau : le mot de passe se choisit, sous la règle.
    expect(await codeOf(() => invitations.accept(jeton(invitePath), 'court', {}))).toBe(
      'portal.weak_password',
    );
    const { result, session } = await invitations.accept(jeton(invitePath), NEUF, {});
    expect(result.existingUser).toBe(false);
    expect(session?.user.userId).toBe(fatou.userId);
    expect(session?.user.finDAcces).toBeNull();
    expect(await portail(fatou)).toBe('active');

    // Son ancien mot de passe ne sert plus ; le nouveau, si. Son certificat
    // demandé avant son départ l'attend toujours.
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.invalid_credentials',
    );
    const { user: apres } = await auth.login({ email: fatou.email, password: NEUF }, {});
    expect(await documents.list(apres, { scope: 'mine' })).toHaveLength(1);
  });

  it('trente ans après, c’est le même compte', async () => {
    await raw(
      `UPDATE contracts SET start_date = CURRENT_DATE - 11315, end_date = CURRENT_DATE - 10950
        WHERE employee_id = $1`,
      [fatou.employeeId],
    );
    await inactiver();
    expect(await motDePasse(fatou)).toBeNull();
    await revient(fatou);
    const { invitePath } = await invitations.invite(
      admin,
      fatou.employeeId,
      'employee',
      fatou.email,
    );
    const { session } = await invitations.accept(jeton(invitePath), NEUF, {});
    expect(session?.user.userId).toBe(fatou.userId);
  });

  it('elle revient avec une autre adresse : son compte la prend', async () => {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
    await revient(fatou);
    const nouvelle = `fatou-retour-${randomUUID()}@test.local`;
    const { invitePath } = await invitations.invite(admin, fatou.employeeId, 'employee', nouvelle);
    const { session } = await invitations.accept(jeton(invitePath), NEUF, {});
    expect(session?.user).toMatchObject({ userId: fatou.userId, email: nouvelle });
  });

  it('son ancienne adresse donnée à un autre agent : il a son propre compte, elle garde le sien', async () => {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
    // Moussa, sans compte, reçoit l'adresse que Fatou avait.
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    );
    const pourMoussa = await invitations.invite(admin, moussa.employeeId, 'employee', fatou.email);
    expect(await invitations.info(jeton(pourMoussa.invitePath))).toMatchObject({
      accueil: 'nouveau',
    });
    const { session: moussaEntre } = await invitations.accept(
      jeton(pourMoussa.invitePath),
      NEUF,
      {},
    );
    expect(moussaEntre?.user.userId).not.toBe(fatou.userId);
    expect(moussaEntre?.user.email).toBe(fatou.email);

    // Fatou revient : son compte, à une adresse neuve. L'ancienne est prise
    // par un compte en service : refusée.
    await revient(fatou);
    expect(
      await codeOf(() => invitations.invite(admin, fatou.employeeId, 'employee', fatou.email)),
    ).toBe('portal.adresse_prise');
    const nouvelle = `fatou-${randomUUID()}@test.local`;
    const { invitePath } = await invitations.invite(admin, fatou.employeeId, 'employee', nouvelle);
    const { session } = await invitations.accept(jeton(invitePath), 'UnAutreMotDePasse2!', {});
    expect(session?.user).toMatchObject({ userId: fatou.userId, email: nouvelle });
  });

  it('un compte en service à l’adresse de l’invitation se relie avec son mot de passe (83)', async () => {
    // Moussa a déjà un compte (comme celle qui a ouvert l'organisation),
    // mais son dossier n'y est pas relié.
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    );
    const { invitePath } = await invitations.invite(
      admin,
      moussa.employeeId,
      'employee',
      moussa.email,
    );
    expect(await invitations.info(jeton(invitePath))).toMatchObject({ accueil: 'compte' });
    expect(await codeOf(() => invitations.accept(jeton(invitePath), NEUF, {}))).toBe(
      'portal.existing_account',
    );
    const { result, session } = await invitations.accept(jeton(invitePath), MOT_DE_PASSE, {});
    expect(result.existingUser).toBe(true);
    expect(session?.user.userId).toBe(moussa.userId);
    expect(await portail(moussa)).toBe('active');
  });

  it('son accès coupé, on le rétablit avant de l’inviter', async () => {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
    await revient(fatou);
    await invitations.couperLAcces(admin, fatou.employeeId, true);
    expect(await portail(fatou)).toBe('coupe');
    expect(
      await codeOf(() => invitations.invite(admin, fatou.employeeId, 'employee', fatou.email)),
    ).toBe('portal.acces_coupe');
    await invitations.couperLAcces(admin, fatou.employeeId, false);
    expect(await portail(fatou)).toBe('ferme');
  });

  it('un compte qui sert dans une autre organisation garde son mot de passe', async () => {
    const autre = randomUUID();
    await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Ailleurs',$2)`, [
      autre,
      `ailleurs-${autre.slice(0, 8)}`,
    ]);
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
      [randomUUID(), autre, fatou.userId],
    );
    try {
      await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
        fatou.employeeId,
      ]);
      await inactiver();
      expect(await motDePasse(fatou)).not.toBeNull();
    } finally {
      await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [autre]);
      await raw(`DELETE FROM tenants WHERE id = $1`, [autre]);
    }
  });
});

describe('les invitations partent d’elles-mêmes', () => {
  /** Un serveur de courrier de test : ce qui part y reste. */
  class Boite implements Transport {
    readonly nom = 'test';
    recus: Courriel[] = [];
    async envoyer(c: Courriel): Promise<void> {
      this.recus.push(c);
    }
  }
  let expediteur: ExpediteurCourriels;
  let rh: PeopleService;
  let portail: InvitationsService;

  beforeEach(() => {
    expediteur = new ExpediteurCourriels(
      db,
      new EncryptionService(),
      new Boite(),
      'rh@apix.test',
      'http://localhost:3002',
      async () => null,
    );
    rh = new PeopleService(db, new EncryptionService(), expediteur);
    portail = new InvitationsService(db, auth, expediteur);
  });
  afterEach(() => expediteur.onModuleDestroy());

  const adresse = async (a: Agent, email: string | null) =>
    raw(`UPDATE employees SET work_email = $2 WHERE id = $1`, [a.employeeId, email]);
  const enFile = async () =>
    (
      await raw(
        `SELECT recipient FROM outbound_emails WHERE tenant_id = $1 AND kind = 'invitation'`,
        [tenantId],
      )
    ).rows.map((r) => r.recipient as string);
  const n1De = async (a: Agent) =>
    (await raw(`SELECT manager_employee_id AS n1 FROM employees WHERE id = $1`, [a.employeeId]))
      .rows[0].n1 as string | null;
  /** Fatou est partie il y a quarante-cinq jours : son mot de passe s'est effacé. */
  async function partieIlYA45Jours(): Promise<void> {
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE - 45 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await inactiver();
  }

  it('partie plus de trente jours, son nouveau contrat la réactive et lui envoie l’invitation', async () => {
    await partieIlYA45Jours();
    await adresse(fatou, 'f.retour@apix.test');
    const r = await rh.newContract(admin, fatou.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: await placeDe(fatou),
    });
    expect(r).toMatchObject({
      rouvert: true,
      invitation: { email: 'f.retour@apix.test', raison: null },
    });
    expect((await statut(fatou)).status).toBe('active');
    expect(await enFile()).toEqual(['f.retour@apix.test']);
    expect((await rh.detail(admin, fatou.employeeId)).portal.status).toBe('invited');
  });

  it('revenue dans les trente jours, pas d’invitation : son mot de passe sert encore', async () => {
    await inactiver();
    await adresse(fatou, 'f.retour@apix.test');
    const r = await rh.newContract(admin, fatou.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: await placeDe(fatou),
    });
    expect(r).toMatchObject({ rouvert: true, invitation: null });
    expect(await enFile()).toEqual([]);
  });

  it('sans adresse, le contrat passe quand même et dit pourquoi l’invitation n’est pas partie', async () => {
    await partieIlYA45Jours();
    const r = await rh.newContract(admin, fatou.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: await placeDe(fatou),
    });
    expect(r).toMatchObject({
      rouvert: true,
      invitation: { email: null, raison: 'Aucune adresse professionnelle' },
    });
    expect((await statut(fatou)).status).toBe('active');
    expect((await rh.detail(admin, fatou.employeeId)).portal.status).toBe('ferme');
  });

  it('le contrat dit la place : même direction, l’unité reste ; autre poste, nouvelle affectation', async () => {
    // Fatou est au service Comptabilité, dans la Direction Financière.
    const avant = await affectations(fatou);
    await raw(`UPDATE contracts SET end_date = CURRENT_DATE + 10 WHERE employee_id = $1`, [
      fatou.employeeId,
    ]);
    await rh.newContract(admin, fatou.employeeId, {
      contractType: 'cdi',
      startDate: await jour(11),
      affectation: { positionTitle: 'Poste', orgUnitId: uDFC },
    });
    expect(await affectations(fatou)).toEqual(avant);

    await rh.newContract(admin, moussa.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: { positionTitle: 'Chef de projet', orgUnitId: uDFC },
    });
    expect((await affectations(moussa)).at(-1)).toEqual({
      poste: 'Chef de projet',
      du: await jour(0),
      au: null,
    });
  });

  it('une autre direction : nouvelle affectation, et le responsable de la direction devient son n+1', async () => {
    await rh.newContract(admin, moussa.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: { positionTitle: 'Chargé RH', orgUnitId: uDCH },
    });
    const { rows } = await raw(
      `SELECT org_unit_id FROM assignments WHERE employee_id = $1 AND upper_inf(validity)`,
      [moussa.employeeId],
    );
    expect(rows).toEqual([{ org_unit_id: uDCH }]);
    expect(await n1De(moussa)).toBe(mariama.employeeId);
  });

  it('revenue dans une autre direction : elle y reprend, rattachée à son responsable', async () => {
    await partieIlYA45Jours();
    await rh.newContract(admin, fatou.employeeId, {
      contractType: 'cdi',
      startDate: await jour(0),
      affectation: { positionTitle: 'Analyste', orgUnitId: uDCH },
    });
    expect((await affectations(fatou)).at(-1)).toEqual({
      poste: 'Analyste',
      du: await jour(0),
      au: null,
    });
    expect(await n1De(fatou)).toBe(mariama.employeeId);
  });

  it('un refus n’enregistre rien : ni contrat, ni réactivation', async () => {
    await partieIlYA45Jours();
    const avant = (
      await raw(`SELECT count(*)::int AS n FROM contracts WHERE employee_id = $1`, [
        fatou.employeeId,
      ])
    ).rows[0].n;
    expect(
      await codeOf(async () =>
        rh.newContract(admin, fatou.employeeId, {
          contractType: 'cdi',
          startDate: await jour(0),
          affectation: { positionTitle: 'Poste', orgUnitId: randomUUID() },
        }),
      ),
    ).not.toBe('AUCUNE ERREUR');
    const apres = (
      await raw(`SELECT count(*)::int AS n FROM contracts WHERE employee_id = $1`, [
        fatou.employeeId,
      ])
    ).rows[0].n;
    expect(apres).toBe(avant);
    expect((await statut(fatou)).status).toBe('archived');
  });

  it('à la création, l’invitation part si on la demande ; sans adresse, le dossier est créé quand même', async () => {
    const creer = (matricule: string, workEmail?: string) =>
      rh.create(admin, {
        person: { givenName: 'Nouvel', familyName: matricule },
        employee: {
          employeeNumber: matricule,
          hiredOn: '2026-10-01',
          ...(workEmail ? { workEmail } : {}),
        },
        contract: { contractType: 'cdi', startDate: '2026-10-01' },
        assignment: { positionTitle: 'Agent', orgUnitId: uDFC, startDate: '2026-10-01' },
        inviter: true,
      });
    const avec = await creer('NV-1', 'nouvel@apix.test');
    expect(avec.invitation).toEqual({ email: 'nouvel@apix.test', raison: null });
    const sans = await creer('NV-2');
    expect(sans.invitation).toEqual({ email: null, raison: 'Aucune adresse professionnelle' });
    // Le portail s'ouvre avec l'adresse professionnelle : la personnelle ne sert pas.
    const perso = await rh.create(admin, {
      person: { givenName: 'Nouvel', familyName: 'NV-3', personalEmail: 'perso@test.local' },
      employee: { employeeNumber: 'NV-3', hiredOn: '2026-10-01' },
      contract: { contractType: 'cdi', startDate: '2026-10-01' },
      assignment: { positionTitle: 'Agent', orgUnitId: uDFC, startDate: '2026-10-01' },
      inviter: true,
    });
    expect(perso.invitation).toEqual({ email: null, raison: 'Aucune adresse professionnelle' });
    expect(await enFile()).toEqual(['nouvel@apix.test']);
  });

  it('plusieurs d’un coup : chacun la sienne, et les refus sont nommés', async () => {
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [ibou.employeeId],
    );
    await adresse(ibou, 'ibou@apix.test');
    const r = await portail.inviterPlusieurs(admin, [ibou.employeeId, moussa.employeeId]);
    expect(r.invites).toEqual([
      { employeeId: ibou.employeeId, nom: 'Ibou Test', email: 'ibou@apix.test' },
    ]);
    expect(r.refus).toEqual([
      {
        employeeId: moussa.employeeId,
        nom: 'Moussa Test',
        raison: 'Cet employé a déjà un accès au portail',
      },
    ]);
  });

  it('la gestion des accès : l’état de chacun', async () => {
    await raw(
      `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [ibou.employeeId],
    );
    await adresse(ibou, 'ibou@apix.test');
    await raw(
      `UPDATE persons SET personal_email = 'moussa@perso.test'
        WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    );
    await portail.inviterPlusieurs(admin, [ibou.employeeId]);
    const { agents, parCourriel } = await portail.etatDesAcces(admin);
    expect(parCourriel).toBe(true);
    const etat = (a: Agent) => agents.find((x) => x.employeeId === a.employeeId);
    // Seule l'adresse professionnelle compte : la personnelle ne s'affiche pas.
    expect(etat(moussa)).toEqual({
      employeeId: moussa.employeeId,
      nom: 'Moussa Test',
      matricule: 'INA-Moussa',
      unite: 'Direction Financière',
      etat: 'actif',
      adresse: null,
      courriel: null,
    });
    expect(etat(ibou)).toMatchObject({ etat: 'invite', adresse: 'ibou@apix.test' });
  });

  it('la gestion des accès se délègue : la page et les invitations, pas la direction', async () => {
    const awa = await agent(
      'Awa',
      uDCH,
      { type: 'cdi', debut: -900, fin: null },
      mariama.employeeId,
    );
    await new HabilitationsService(db).accorder(
      { userId: mariama.userId, tenantId, role: 'employee' } as SessionUser,
      { employeeId: awa.employeeId, capacite: 'acces', accordee: true },
    );
    const droits = await db.withTenant({ tenantId, userId: awa.userId }, (tx) =>
      capacitesDe(tx, awa.userId, 'employee'),
    );
    expect(droits.capacites).toEqual(['acces']);
    const delegue = { userId: awa.userId, tenantId, role: 'employee', ...droits } as SessionUser;

    // Les portes : la page et les invitations. Couper un accès reste à la
    // gestion du personnel ; l'administrateur n'a pas la page.
    const garde = new AccesGuard(new Reflector());
    const passe = (handler: object, sessionUser: object) => {
      try {
        return garde.canActivate({
          getHandler: () => handler,
          getClass: () => PortalController,
          switchToHttp: () => ({ getRequest: () => ({ sessionUser }) }),
        } as unknown as ExecutionContext);
      } catch {
        return false;
      }
    };
    const { etatDesAcces, inviterPlusieurs, couper, retablir } = PortalController.prototype;
    expect(
      [etatDesAcces, inviterPlusieurs, couper, retablir].map((h) => passe(h, delegue)),
    ).toEqual([true, true, false, false]);
    expect(passe(etatDesAcces, { role: 'admin', capacites: [] })).toBe(false);
    expect(passe(etatDesAcces, { role: 'employee', capacites: ['personnel.gerer'] })).toBe(false);
    expect(passe(etatDesAcces, { role: 'employee', capacites: [] })).toBe(false);

    // Il invite un agent ; le directeur général, non.
    for (const [a, courriel] of [
      [ibou, 'ibou@apix.test'],
      [dg, 'cheikh@apix.test'],
    ] as const) {
      await raw(
        `UPDATE persons SET user_id = NULL WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
        [a.employeeId],
      );
      await adresse(a, courriel);
    }
    const r = await portail.inviterPlusieurs(delegue, [dg.employeeId, ibou.employeeId]);
    expect(r.invites.map((i) => i.employeeId)).toEqual([ibou.employeeId]);
    expect(r.refus).toEqual([
      {
        employeeId: dg.employeeId,
        nom: 'Cheikh Test',
        raison: 'Seuls l’administrateur et le directeur du Capital Humain invitent cet agent',
      },
    ]);
    const { agents } = await portail.etatDesAcces(delegue);
    expect(agents.find((a) => a.employeeId === ibou.employeeId)?.etat).toBe('invite');
  });
  describe('un contrat qui commence plus tard', () => {
    /** Le premier jour d'un contrat en attente : c'est aujourd'hui. */
    async function leJourVenu(a: Agent): Promise<void> {
      await raw(
        `UPDATE contracts SET start_date = CURRENT_DATE
          WHERE employee_id = $1 AND planned_position_title IS NOT NULL`,
        [a.employeeId],
      );
      await inactiver();
    }
    /** Son contrat en cours s'est arrêté il y a `jours` jours. */
    const finiIlYA = (a: Agent, jours: number) =>
      raw(
        `UPDATE contracts SET end_date = CURRENT_DATE - $2::int
          WHERE employee_id = $1 AND planned_position_title IS NULL`,
        [a.employeeId, jours],
      );
    const acces = (a: Agent) =>
      db.withTenant({ tenantId, userId: adminUserId }, (tx) => accesDuCompte(tx, a.userId));
    const enAttente = async (a: Agent) =>
      (
        await raw(
          `SELECT count(*)::int AS n FROM contracts
            WHERE employee_id = $1 AND planned_position_title IS NOT NULL`,
          [a.employeeId],
        )
      ).rows[0].n as number;
    const chefDe = async (unite: string) =>
      (await raw(`SELECT manager_employee_id AS id FROM org_units WHERE id = $1`, [unite])).rows[0]
        .id as string | null;

    it('entre deux contrats, hors contrat : inactif, portail restreint ; le jour venu, tout revient', async () => {
      // Le CDD de Moussa a pris fin il y a trois jours ; le suivant commence dans dix jours.
      await raw(`UPDATE contracts SET contract_type = 'cdd' WHERE employee_id = $1`, [
        moussa.employeeId,
      ]);
      await finiIlYA(moussa, 3);
      const typeId = randomUUID();
      await raw(`INSERT INTO absence_types (id, tenant_id, name) VALUES ($1,$2,'Congé annuel')`, [
        typeId,
        tenantId,
      ]);
      const conge = randomUUID();
      await raw(
        `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
         VALUES ($1,$2,$3,$4, CURRENT_DATE + 12, CURRENT_DATE + 13, 2, 'approved')`,
        [conge, tenantId, moussa.employeeId, typeId],
      );
      const r = await rh.newContract(admin, moussa.employeeId, {
        contractType: 'cdd',
        startDate: await jour(10),
        endDate: await jour(200),
        affectation: { positionTitle: 'Analyste', orgUnitId: uDFC },
      });
      expect(r).toMatchObject({ rouvert: false, invitation: null });

      await inactiver();
      expect(await statut(moussa)).toMatchObject({
        status: 'archived',
        inactivite_motif: 'fin_de_contrat',
      });
      expect(await acces(moussa)).toEqual({ finDAcces: await jour(27), ferme: false });
      expect((await rh.detail(admin, moussa.employeeId)).contracts[0]).toMatchObject({
        startDate: await jour(10),
        placePrevue: { poste: 'Analyste', direction: 'Direction Financière' },
      });
      // Son congé tombe dans le contrat suivant : il tient.
      expect(
        (await raw(`SELECT status FROM absence_requests WHERE id = $1`, [conge])).rows[0].status,
      ).toBe('approved');
      // Rien avant son premier jour : ni réactivation, ni affectation.
      const re = await rh.archive(admin, { ids: [moussa.employeeId], archived: false });
      expect(re.done).toBe(0);
      expect(re.skipped[0]?.reason).toMatch(/commence le .+ se réactivera ce jour-là/);
      expect(
        await codeOf(async () =>
          people.newAssignment(admin, moussa.employeeId, {
            positionTitle: 'Analyste',
            orgUnitId: uDFC,
            startDate: await jour(0),
          }),
        ),
      ).toBe('people.agent_inactif');

      await leJourVenu(moussa);
      expect((await statut(moussa)).status).toBe('active');
      expect((await affectations(moussa)).slice(-2)).toEqual([
        { poste: 'Poste', du: '2024-01-01', au: await jour(-3) },
        { poste: 'Analyste', du: await jour(0), au: null },
      ]);
      expect(await acces(moussa)).toEqual({ finDAcces: null, ferme: false });
      expect(await n1De(moussa)).toBe(omar.employeeId);
      expect(await enAttente(moussa)).toBe(0);
    });

    it('enregistré pendant qu’il travaille encore, rien ne bouge avant son premier jour', async () => {
      await raw(
        `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE + 5 WHERE employee_id = $1`,
        [moussa.employeeId],
      );
      const avant = await affectations(moussa);
      await rh.newContract(admin, moussa.employeeId, {
        contractType: 'cdi',
        startDate: await jour(10),
        affectation: { positionTitle: 'Chargé RH', orgUnitId: uDCH },
      });
      await inactiver();
      expect((await statut(moussa)).status).toBe('active');
      expect(await affectations(moussa)).toEqual(avant);
      expect(await n1De(moussa)).toBe(omar.employeeId);

      // Son contrat s'arrête : hors contrat jusqu'au suivant.
      await finiIlYA(moussa, 2);
      await inactiver();
      expect((await statut(moussa)).status).toBe('archived');

      await leJourVenu(moussa);
      expect((await statut(moussa)).status).toBe('active');
      expect((await affectations(moussa)).at(-1)).toEqual({
        poste: 'Chargé RH',
        du: await jour(0),
        au: null,
      });
      expect(await n1De(moussa)).toBe(mariama.employeeId);
    });

    it('un agent de la DCH n’a plus son espace RH entre deux contrats ; le jour venu, il le retrouve', async () => {
      const awa = await agent(
        'Awa',
        uDCH,
        { type: 'cdd', debut: -300, fin: 5 },
        mariama.employeeId,
      );
      await raw(
        `INSERT INTO habilitations (id, tenant_id, capacite, employee_id)
         VALUES ($1,$2,'demandes.conges',$3)`,
        [randomUUID(), tenantId, awa.employeeId],
      );
      const connexion = async () =>
        (await auth.login({ email: awa.email, password: MOT_DE_PASSE }, {})).user;
      expect((await connexion()).capacites).toContain('demandes.conges');
      await rh.newContract(admin, awa.employeeId, {
        contractType: 'cdd',
        startDate: await jour(10),
        endDate: await jour(375),
        affectation: { positionTitle: 'Gestionnaire RH', orgUnitId: uDCH },
      });

      await finiIlYA(awa, 2);
      await inactiver();
      const pendant = await connexion();
      expect(pendant).toMatchObject({ capacites: [], estAgent: false, finDAcces: await jour(28) });
      // Ses délégations ne lui sont pas retirées : elles l'attendent.
      const ouvertes = async () =>
        (
          await raw(
            `SELECT count(*)::int AS n FROM habilitations WHERE employee_id = $1 AND fin_at IS NULL`,
            [awa.employeeId],
          )
        ).rows[0].n as number;
      expect(await ouvertes()).toBe(1);

      await leJourVenu(awa);
      const apres = await connexion();
      expect(apres).toMatchObject({ finDAcces: null, estAgent: true });
      expect(apres.capacites).toContain('demandes.conges');
      expect(await ouvertes()).toBe(1);
    });

    it('un responsable qui change de direction par un nouveau contrat : son équipe remonte à son n+1', async () => {
      // Fatou dirige la comptabilité, où travaille Ibou ; elle relève d'Omar.
      await raw(`UPDATE contracts SET end_date = NULL WHERE employee_id = $1`, [fatou.employeeId]);
      // Une mutation, elle, demande toujours qui reprend l'unité et l'équipe.
      expect(
        await codeOf(async () =>
          people.newAssignment(admin, fatou.employeeId, {
            positionTitle: 'Analyste RH',
            orgUnitId: uDCH,
            startDate: await jour(0),
          }),
        ),
      ).toBe('people.manager_cannot_leave_unit');

      const r = await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(0),
        affectation: { positionTitle: 'Analyste RH', orgUnitId: uDCH },
      });
      expect(await n1De(ibou)).toBe(omar.employeeId);
      expect(await n1De(fatou)).toBe(mariama.employeeId);
      expect(await chefDe(uCompta)).toBeNull();
      expect(r.changements).toContainEqual(
        expect.objectContaining({ employeeId: ibou.employeeId, motif: 'reprise_equipe' }),
      );
      expect((await affectations(fatou)).at(-1)).toEqual({
        poste: 'Analyste RH',
        du: await jour(0),
        au: null,
      });
    });

    it('enchaîné plus tard dans une autre direction : l’équipe remonte le jour venu, pas avant', async () => {
      await raw(`UPDATE contracts SET end_date = NULL WHERE employee_id = $1`, [fatou.employeeId]);
      await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(7),
        affectation: { positionTitle: 'Analyste RH', orgUnitId: uDCH },
      });
      await inactiver();
      expect(await n1De(ibou)).toBe(fatou.employeeId);
      expect(await chefDe(uCompta)).toBe(fatou.employeeId);

      // Le jour venu, sans interruption : son contrat précédent finissait la veille.
      await finiIlYA(fatou, 1);
      await leJourVenu(fatou);
      expect((await statut(fatou)).status).toBe('active');
      expect(await n1De(ibou)).toBe(omar.employeeId);
      expect(await n1De(fatou)).toBe(mariama.employeeId);
      expect(await chefDe(uCompta)).toBeNull();
    });

    it('le directeur général reste à la Direction Générale, contrat du jour ou à venir', async () => {
      for (const decalage of [0, 5]) {
        expect(
          await codeOf(async () =>
            rh.newContract(admin, dg.employeeId, {
              contractType: 'cdi',
              startDate: await jour(decalage),
              affectation: { positionTitle: 'Analyste', orgUnitId: uDFC },
            }),
          ),
        ).toBe('people.dg_quitte_la_dg');
      }
    });

    it('partie plus de trente jours : son invitation part le jour où son contrat commence', async () => {
      await partieIlYA45Jours();
      await adresse(fatou, 'f.retour@apix.test');
      const r = await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(3),
        affectation: await placeDe(fatou),
      });
      expect(r).toMatchObject({ rouvert: false, invitation: null });
      expect(await enFile()).toEqual([]);
      expect((await statut(fatou)).status).toBe('archived');

      expediteur.brancher();
      await leJourVenu(fatou);
      expect((await statut(fatou)).status).toBe('active');
      expect(await enFile()).toEqual(['f.retour@apix.test']);
      // Personne ne l'a envoyée : la plateforme, d'elle-même.
      const { rows } = await raw(
        `SELECT invited_by_user_id AS par FROM invitations WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(rows).toEqual([{ par: null }]);
    });

    it('revenue, elle ne redevient pas responsable d’office : la RH le décide', async () => {
      // Fatou dirige la comptabilité, où travaille Ibou ; son CDD a pris fin hier.
      await inactiver();
      expect(await chefDe(uCompta)).toBeNull();
      expect(await n1De(ibou)).toBe(omar.employeeId);
      // La fiche dit ce qu'elle pourrait reprendre.
      expect((await rh.detail(admin, fatou.employeeId)).responsabilites).toEqual({
        unites: [{ id: uCompta, nom: 'Service Comptabilité', directionId: uDFC }],
        equipe: 1,
      });

      const r = await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(0),
        affectation: await placeDe(fatou),
      });
      expect(r.rouvert).toBe(true);
      expect(await chefDe(uCompta)).toBeNull();
      expect(await n1De(ibou)).toBe(omar.employeeId);
    });

    it('la RH choisit qu’elle redevient responsable : l’unité et son équipe lui reviennent', async () => {
      await inactiver();
      const r = await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(0),
        affectation: await placeDe(fatou),
        reprendre: { unites: [uCompta], equipe: false },
      });
      expect(await chefDe(uCompta)).toBe(fatou.employeeId);
      expect(await n1De(ibou)).toBe(fatou.employeeId);
      expect(r.changements).toContainEqual(
        expect.objectContaining({ employeeId: ibou.employeeId, motif: 'retour_du_responsable' }),
      );
    });

    it('revenue en stage, elle ne reprend pas la tête de son unité', async () => {
      await inactiver();
      expect(
        await codeOf(async () =>
          rh.newContract(admin, fatou.employeeId, {
            contractType: 'stage',
            startDate: await jour(0),
            endDate: await jour(90),
            affectation: await placeDe(fatou),
            reprendre: { unites: [uCompta], equipe: false },
          }),
        ),
      ).toBe('people.retour_en_stage');
      expect((await statut(fatou)).status).toBe('archived');
      expect(await chefDe(uCompta)).toBeNull();
    });

    it('réactivée sous un stage, elle ne redevient pas responsable', async () => {
      await raw(
        `UPDATE contracts SET contract_type = 'stage', end_date = CURRENT_DATE + 30 WHERE employee_id = $1`,
        [fatou.employeeId],
      );
      await inactiver();
      await raw(
        `UPDATE employees SET status = 'archived', archived_at = now(), fin_activite = CURRENT_DATE - 1,
                inactivite_motif = 'demission' WHERE id = $1`,
        [fatou.employeeId],
      );
      await raw(
        `INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif, headed_unit_ids)
         VALUES ($1, $2, CURRENT_DATE - 1, 'demission', ARRAY[$3]::uuid[])`,
        [tenantId, fatou.employeeId, uCompta],
      );
      await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uCompta]);
      expect(
        await codeOf(() =>
          rh.archive(admin, {
            ids: [fatou.employeeId],
            archived: false,
            reprendre: { [fatou.employeeId]: { unites: [uCompta], equipe: false } },
          }),
        ),
      ).toBe('people.responsabilite_non_rendue');
      expect(await chefDe(uCompta)).toBeNull();
    });

    it('qui dirige une unité ne passe pas sous contrat de stage, ni par correction', async () => {
      // Omar dirige la Direction Financière.
      expect(
        await codeOf(async () =>
          rh.newContract(admin, omar.employeeId, {
            contractType: 'stage',
            startDate: await jour(5),
            endDate: await jour(60),
            affectation: { positionTitle: 'Poste', orgUnitId: uDFC },
          }),
        ),
      ).toBe('people.responsable_en_stage');
      const { rows } = await raw(
        `SELECT id, start_date::text AS debut FROM contracts WHERE employee_id = $1
          ORDER BY start_date DESC LIMIT 1`,
        [omar.employeeId],
      );
      expect(
        await codeOf(() =>
          rh.corrigerContrat(admin, omar.employeeId, rows[0].id, {
            contractType: 'stage',
            startDate: rows[0].debut,
            endDate: '2099-12-31',
          }),
        ),
      ).toBe('people.responsable_en_stage');
      expect(await chefDe(uDFC)).toBe(omar.employeeId);
    });

    it('un successeur nommé entre-temps garde l’unité : la reprendre est refusé', async () => {
      await inactiver();
      await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
        uCompta,
        ibou.employeeId,
      ]);
      expect((await rh.detail(admin, fatou.employeeId)).responsabilites.unites).toEqual([]);
      expect(
        await codeOf(async () =>
          rh.newContract(admin, fatou.employeeId, {
            contractType: 'cdi',
            startDate: await jour(0),
            affectation: await placeDe(fatou),
            reprendre: { unites: [uCompta], equipe: false },
          }),
        ),
      ).toBe('people.responsabilite_non_rendue');
      expect((await statut(fatou)).status).toBe('archived');
      await rh.newContract(admin, fatou.employeeId, {
        contractType: 'cdi',
        startDate: await jour(0),
        affectation: await placeDe(fatou),
      });
      expect((await statut(fatou)).status).toBe('active');
      expect(await chefDe(uCompta)).toBe(ibou.employeeId);
      expect(await n1De(ibou)).toBe(omar.employeeId);
    });

    it('réactivée, elle redevient responsable si la RH le coche', async () => {
      // Partie à la main, puis revenue : son contrat court encore.
      await raw(`UPDATE contracts SET end_date = NULL WHERE employee_id = $1`, [fatou.employeeId]);
      await inactiver();
      await raw(
        `UPDATE employees SET status = 'archived', archived_at = now(), fin_activite = CURRENT_DATE - 1,
                inactivite_motif = 'demission' WHERE id = $1`,
        [fatou.employeeId],
      );
      await raw(
        `INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif, headed_unit_ids)
         VALUES ($1, $2, CURRENT_DATE - 1, 'demission', ARRAY[$3]::uuid[])`,
        [tenantId, fatou.employeeId, uCompta],
      );
      await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uCompta]);
      const r = await rh.archive(admin, {
        ids: [fatou.employeeId],
        archived: false,
        reprendre: { [fatou.employeeId]: { unites: [uCompta], equipe: false } },
      });
      expect(r.done).toBe(1);
      expect(await chefDe(uCompta)).toBe(fatou.employeeId);
    });

    it('un directeur revenu après une interruption reprend sa direction le jour venu, si la RH l’a choisi', async () => {
      // Omar dirige la Direction Financière ; Moussa et Fatou relèvent de lui.
      await raw(`UPDATE contracts SET end_date = NULL WHERE employee_id = $1`, [fatou.employeeId]);
      await raw(
        `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE + 3 WHERE employee_id = $1`,
        [omar.employeeId],
      );
      // Enregistré pendant qu'il dirige encore : la fiche propose sa direction.
      expect((await rh.detail(admin, omar.employeeId)).responsabilites.unites).toEqual([
        { id: uDFC, nom: 'Direction Financière', directionId: uDFC },
      ]);
      await rh.newContract(admin, omar.employeeId, {
        contractType: 'cdi',
        startDate: await jour(10),
        affectation: { positionTitle: 'Poste', orgUnitId: uDFC },
        reprendre: { unites: [uDFC], equipe: false },
      });
      await finiIlYA(omar, 2);
      await inactiver();
      expect(await chefDe(uDFC)).toBeNull();
      expect(await n1De(moussa)).toBe(dg.employeeId);

      await leJourVenu(omar);
      expect((await statut(omar)).status).toBe('active');
      expect(await chefDe(uDFC)).toBe(omar.employeeId);
      expect(await n1De(omar)).toBe(dg.employeeId);
      expect(await n1De(moussa)).toBe(omar.employeeId);
      expect(await n1De(fatou)).toBe(omar.employeeId);
    });

    it('un contrat qui n’a pas commencé s’annule : le contrat en cours retrouve sa fin', async () => {
      const contrats = async () =>
        (
          await raw(
            `SELECT start_date::text AS debut, end_date::text AS fin FROM contracts
              WHERE employee_id = $1 ORDER BY start_date`,
            [moussa.employeeId],
          )
        ).rows as { debut: string; fin: string | null }[];
      const avant = await contrats();
      expect(avant).toHaveLength(1);
      expect(avant[0]!.fin).toBeNull();
      const r = await rh.newContract(admin, moussa.employeeId, {
        contractType: 'cdd',
        startDate: await jour(10),
        endDate: await jour(100),
        affectation: { positionTitle: 'Analyste', orgUnitId: uDFC },
      });
      expect((await contrats())[0]!.fin).toBe(await jour(9));

      // Seul le dernier s'annule ; commencé, il ne s'annule plus.
      const premier = (
        await raw(`SELECT id FROM contracts WHERE employee_id = $1 ORDER BY start_date LIMIT 1`, [
          moussa.employeeId,
        ])
      ).rows[0].id as string;
      expect(await codeOf(() => rh.annulerContrat(admin, moussa.employeeId, premier))).toBe(
        'people.contrat_pas_le_dernier',
      );

      await rh.annulerContrat(admin, moussa.employeeId, r.id);
      expect(await contrats()).toEqual(avant);
      expect(await codeOf(() => rh.annulerContrat(admin, moussa.employeeId, premier))).toBe(
        'people.contrat_commence',
      );
    });

    it('annulé, le contrat qui ramenait un membre à la DCH ne lui garde plus ses délégations', async () => {
      const awa = await agent(
        'Awa',
        uDCH,
        { type: 'cdd', debut: -300, fin: -2 },
        mariama.employeeId,
      );
      await raw(
        `INSERT INTO habilitations (id, tenant_id, capacite, employee_id)
         VALUES ($1,$2,'demandes.conges',$3)`,
        [randomUUID(), tenantId, awa.employeeId],
      );
      const r = await rh.newContract(admin, awa.employeeId, {
        contractType: 'cdd',
        startDate: await jour(10),
        endDate: await jour(375),
        affectation: { positionTitle: 'Gestionnaire RH', orgUnitId: uDCH },
      });
      await inactiver();
      const ouvertes = async () =>
        (
          await raw(
            `SELECT count(*)::int AS n FROM habilitations WHERE employee_id = $1 AND fin_at IS NULL`,
            [awa.employeeId],
          )
        ).rows[0].n as number;
      expect(await ouvertes()).toBe(1);
      await rh.annulerContrat(admin, awa.employeeId, r.id);
      expect(await ouvertes()).toBe(0);
    });

    it('un départ enregistré avant le début : le contrat suivant n’aura pas lieu', async () => {
      await raw(
        `UPDATE contracts SET contract_type = 'cdd', end_date = CURRENT_DATE + 5 WHERE employee_id = $1`,
        [moussa.employeeId],
      );
      await rh.newContract(admin, moussa.employeeId, {
        contractType: 'cdi',
        startDate: await jour(10),
        affectation: await placeDe(moussa),
      });
      const r = await rh.archive(admin, {
        ids: [moussa.employeeId],
        archived: true,
        motif: 'demission',
      });
      expect(r.done).toBe(1);
      expect(await enAttente(moussa)).toBe(0);
      const { rows } = await raw(
        `SELECT count(*)::int AS n FROM contracts WHERE employee_id = $1 AND start_date > CURRENT_DATE`,
        [moussa.employeeId],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('une fin de contrat ne contourne pas la désactivation (audit)', () => {
  const role = (userId: string, r: 'admin' | 'employee') =>
    raw(`UPDATE user_tenant_memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      tenantId,
      userId,
      r,
    ]);
  const contratDe = async (a: Agent) =>
    (
      await raw(
        `SELECT id, start_date::text AS du FROM contracts WHERE employee_id = $1
          ORDER BY start_date DESC LIMIT 1`,
        [a.employeeId],
      )
    ).rows[0] as { id: string; du: string };
  /** Un membre de la DCH : ni administrateur, ni directeur. */
  const rh = () => ({ userId: ibou.userId, tenantId, role: 'employee' }) as SessionUser;

  it('une fin passée ne ferme ni le dossier d’un responsable d’unité, ni celui du dernier administrateur', async () => {
    const c = await contratDe(omar);
    const finir = async () =>
      people.corrigerContrat(admin, omar.employeeId, c.id, {
        contractType: 'cdd',
        startDate: c.du,
        endDate: await jour(-2),
      } as never);
    expect(await codeOf(finir)).toBe('people.fin_refusee');
    expect(
      await codeOf(async () =>
        people.newContract(admin, omar.employeeId, {
          affectation: await placeDe(omar),
          contractType: 'cdd',
          startDate: await jour(-10),
          endDate: await jour(-2),
        }),
      ),
    ).toBe('people.fin_refusee');
    expect((await statut(omar)).status).toBe('active');

    await role(moussa.userId, 'admin');
    await role(adminUserId, 'employee');
    try {
      const m = await contratDe(moussa);
      expect(
        await codeOf(async () =>
          people.corrigerContrat(admin, moussa.employeeId, m.id, {
            contractType: 'cdd',
            startDate: m.du,
            endDate: await jour(-2),
          }),
        ),
      ).toBe('people.fin_refusee');
    } finally {
      await role(adminUserId, 'admin');
      await role(moussa.userId, 'employee');
    }
  });

  it('le compte d’un administrateur parti ne se rouvre que par l’administrateur ou le directeur', async () => {
    expect(await inactiver()).toBe(1);
    await role(fatou.userId, 'admin');
    const contrat = async (debut: number) => ({
      affectation: await placeDe(fatou),
      contractType: 'cdi' as const,
      startDate: await jour(debut),
    });
    expect(
      await codeOf(async () => people.newContract(rh(), fatou.employeeId, await contrat(0))),
    ).toBe('people.reactivation_reservee');
    // Le jour venu non plus : un contrat qui commence plus tard rouvrirait le dossier.
    expect(
      await codeOf(async () => people.newContract(rh(), fatou.employeeId, await contrat(5))),
    ).toBe('people.reactivation_reservee');
    const r = await people.archive(rh(), { ids: [fatou.employeeId], archived: false });
    expect(r.skipped[0]?.reason).toMatch(/^Compte administrateur/);
    const directrice = {
      userId: mariama.userId,
      tenantId,
      role: 'employee',
      dirigeLaDCH: true,
    } as SessionUser;
    expect(
      await codeOf(async () => people.newContract(directrice, fatou.employeeId, await contrat(0))),
    ).toBe('AUCUNE ERREUR');
    expect((await statut(fatou)).status).toBe('active');
  });
});
