/**
 * Actifs et inactifs : la fin de contrat, les motifs, et les portes qu'un
 * contrat arrivé à terme referme.
 *
 * La règle de l'APIX : un agent dont le CDD ou le stage est arrivé à terme
 * n'est plus de l'agence. Son dossier passe de lui-même dans les inactifs le
 * lendemain de son dernier jour ; d'ici là, chaque porte vérifie la date :
 * il ne dirige rien, n'est le n+1 de personne, ne reçoit ni affectation ni
 * invitation au portail. Son compte reste ouvert un mois, restreint, le temps
 * de récupérer ses documents ; ensuite il ne se connecte plus.
 */
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
import {
  agentDuCompte,
  directionDuPersonnel,
  estDeLaDCH,
  pasSurSoi,
  viseur,
} from '../src/modules/acces/dch';
import { AuthService } from '../src/modules/auth/auth.service';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ObjectifsController } from '../src/modules/objectifs/objectifs.controller';
import { inactiverLesContratsEchus } from '../src/modules/people/activite';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleController } from '../src/modules/people/people.controller';
import { PeopleService } from '../src/modules/people/people.service';
import { InvitationsService } from '../src/modules/portal/invitations.service';
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
    // portail lui sert encore un mois.
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

describe('un mois pour récupérer ses documents', () => {
  /** Le dernier jour d'accès : un mois après la fin d'activité, selon la base. */
  const unMoisApres = async (fin: string) => {
    const { rows } = await raw(`SELECT ($1::date + interval '1 month')::date::text AS d`, [fin]);
    return rows[0].d as string;
  };

  it('son contrat terminé, elle se connecte encore un mois : un portail restreint, sans habilitation', async () => {
    const { token, user } = await auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {});
    expect(user).toMatchObject({
      finDAcces: await unMoisApres(await jour(-1)),
      estAgent: false,
      dirigeLaDCH: false,
      capacites: [],
    });
    // Passé ce mois, la porte se ferme : à la connexion, et pour la session ouverte.
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
    expect(user.finDAcces).toBe(await unMoisApres(await jour(0)));
    // Elle suit encore les documents qu'elle a demandés.
    const documents = new DocumentRequestsService(db, new NotificationsService(db));
    await documents.create(user, { docTypes: ['certificat_travail'] });
    expect(await documents.list(user, { scope: 'mine' })).toHaveLength(1);
    // Un mois et un jour plus tard, c'est fini.
    await raw(
      `UPDATE employees SET fin_activite = CURRENT_DATE - interval '1 month' - interval '1 day' WHERE id = $1`,
      [fatou.employeeId],
    );
    expect(await codeOf(() => auth.login({ email: fatou.email, password: MOT_DE_PASSE }, {}))).toBe(
      'auth.employee_archived',
    );
  });

  it('ce qui lui est fermé ce mois-là : demandes d’absence, objectifs, Academy, organigramme', () => {
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

  it('pendant le mois restreint, le rôle d’administrateur ne lui donne plus rien', async () => {
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
      newContractSchema.safeParse({ contractType, startDate: '2026-10-01', endDate: '2027-03-31' })
        .success;
    expect(['cdi', 'cdd', 'stage'].map(contrat)).toEqual([true, true, true]);
    expect(['consultant', 'detachement'].map(contrat)).toEqual([false, false]);
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

  it('un licenciement ou un décès ferme le portail le jour même, sans le mois de délai', async () => {
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
    await people.newContract(admin, moussa.employeeId, {
      contractType: 'cdd',
      startDate: await jour(-2),
      endDate: await jour(200),
    });
    expect((await people.detail(admin, moussa.employeeId)).repriseParDefaut).toBe(await jour(-2));
    await people.archive(admin, { ids: [moussa.employeeId], archived: false });
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
