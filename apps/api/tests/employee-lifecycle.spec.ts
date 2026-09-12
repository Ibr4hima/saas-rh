/**
 * Fin de dossier : archiver, rouvrir, effacer (migration 0018).
 *
 * Deux gestes qu'il ne faut surtout pas confondre. Archiver ferme le portail
 * et garde le dossier — l'agent est parti, la loi laisse encore conserver ses
 * données, et le rendre actif rouvre l'accès AVEC LES MÊMES IDENTIFIANTS.
 * Effacer ne laisse rien : ni dossier, ni congés, ni pièces, ni portail — pas
 * même la copie que le journal d'audit prend au passage de chaque suppression.
 *
 * C'est cette dernière qui justifie ce fichier : sans elle, « supprimer
 * définitivement » resterait une formule. Le test le plus important est celui
 * qui relit `audit_log` après coup.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { PeopleService } from '../src/modules/people/people.service';

const env = loadEnv();

const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

interface Dossier {
  employeeId: string;
  personId: string;
  userId: string | null;
  /** Le prénom du dossier : c'est lui qu'on traque dans le journal d'audit. */
  numero: string;
}

/** Un dossier complet : personne, employé, et le portail si on le demande. */
async function creerDossier(numero: string, avecPortail: boolean): Promise<Dossier> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  const userId = avecPortail ? randomUUID() : null;

  if (userId) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'hash-secret','Agent',$3)`,
      [userId, `${numero.toLowerCase()}-${userId}@test.local`, numero],
    );
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
       VALUES ($1,$2,$3,'employee')`,
      [randomUUID(), tenantId, userId],
    );
  }
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, phone, birth_date)
     VALUES ($1,$2,$3,$4,'Test','+221770000000','1990-05-04')`,
    [personId, tenantId, userId, numero],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, numero],
  );
  return { employeeId, personId, userId, numero };
}

/** Tout ce qu'un dossier vivant accumule autour de lui. */
async function garnir(d: Dossier): Promise<{ requestId: string }> {
  const typeId = randomUUID();
  const requestId = randomUUID();
  await raw(`INSERT INTO absence_types (id, tenant_id, name) VALUES ($1,$2,'Congé annuel')`, [
    typeId,
    tenantId,
  ]);
  await raw(
    `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
     VALUES ($1,$2,$3,$4,'2026-03-02','2026-03-06',5,'pending')`,
    [requestId, tenantId, d.employeeId, typeId],
  );
  await raw(
    `INSERT INTO absence_approvals (id, tenant_id, request_id, level, decision, decided_by_user_id)
     VALUES ($1,$2,$3,1,'approved',$4)`,
    [randomUUID(), tenantId, requestId, adminUserId],
  );
  await raw(
    `INSERT INTO absence_documents (id, tenant_id, request_id, filename, size_bytes, data)
     VALUES ($1,$2,$3,'certificat.pdf',12,'\\x00')`,
    [randomUUID(), tenantId, requestId],
  );
  await raw(
    `INSERT INTO absence_balances (id, tenant_id, employee_id, absence_type_id, year, entitled_days)
     VALUES ($1,$2,$3,$4,2026,30)`,
    [randomUUID(), tenantId, d.employeeId, typeId],
  );
  await raw(
    `INSERT INTO employee_documents (id, tenant_id, employee_id, category, label, filename, content_type, size_bytes, data, uploaded_by_user_id, uploaded_by_side)
     VALUES ($1,$2,$3,'diplome','Diplôme','diplome.pdf','application/pdf',12,'\\x00',$4,'hr')`,
    [randomUUID(), tenantId, d.employeeId, adminUserId],
  );
  await raw(
    `INSERT INTO document_requests (id, tenant_id, employee_id, doc_types, status, requested_by_user_id)
     VALUES ($1,$2,$3,ARRAY['work_certificate'],'received',$4)`,
    [randomUUID(), tenantId, d.employeeId, d.userId ?? adminUserId],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, position_title, validity)
     VALUES ($1,$2,$3,'Analyste','[2024-01-01,)')`,
    [randomUUID(), tenantId, d.employeeId],
  );
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
     VALUES ($1,$2,$3,'cdi','2024-01-01')`,
    [randomUUID(), tenantId, d.employeeId],
  );
  await raw(
    `INSERT INTO invitations (id, tenant_id, person_id, email, role, token_hash, expires_at, invited_by_user_id)
     VALUES ($1,$2,$3,$4,'employee',$5, now() + interval '7 days', $6)`,
    [
      randomUUID(),
      tenantId,
      d.personId,
      // L'email porte le NOM : c'est très exactement ce que la première
      // version de l'effacement laissait dans le journal.
      `${d.numero.toLowerCase()}.diop@invite.test.local`,
      `inv-${randomUUID()}`,
      adminUserId,
    ],
  );
  // Une notification qui PARLE de lui, dans la boîte de la RH : elle le nomme
  // et pointe vers son dossier. C'est celle-là qui survivait à l'effacement.
  await raw(
    `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, body, link)
     VALUES ($1,$2,$3,'document_request',$4,'Attestation de travail','/documents')`,
    [randomUUID(), tenantId, adminUserId, `${d.numero} Test demande des documents`],
  );
  if (d.userId) {
    await raw(
      `INSERT INTO sessions (id, user_id, tenant_id, token_hash, ip, expires_at)
       VALUES ($1,$2,$3,$4,'10.0.0.1', now() + interval '8 hours')`,
      [randomUUID(), d.userId, tenantId, `tok-${randomUUID()}`],
    );
    await raw(
      `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, body)
       VALUES ($1,$2,$3,'holiday_reminder','Rappel',$4)`,
      [randomUUID(), tenantId, d.userId, `Bonjour ${d.numero}, un jour férié approche.`],
    );
  }
  return { requestId };
}

const compte = async (table: string, where: string, params: unknown[]): Promise<number> => {
  const r = await raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return (r.rows[0] as { n: number }).n;
};

let awa: Dossier;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [adminUserId, `cycle-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Cycle',$2)`, [
    tenantId,
    `cycle-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'admin')`,
    [randomUUID(), tenantId, adminUserId],
  );
});

async function vider() {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'absence_documents',
    'absence_approvals',
    'absence_requests',
    'absence_balances',
    'absence_types',
    'employee_documents',
    'document_requests',
    'profile_change_requests',
    'assignments',
    'contracts',
    'invitations',
    'notifications',
    'employees',
    'persons',
    'org_units',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM sessions WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1 AND user_id <> $2`, [
    tenantId,
    adminUserId,
  ]);
  await raw(`DELETE FROM users WHERE email LIKE '%@test.local' AND id <> $1`, [adminUserId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

beforeEach(async () => {
  await vider();
  awa = await creerDossier('AWA', true);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [adminUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('archivage', () => {
  it('ferme le dossier et révoque les sessions ouvertes', async () => {
    await garnir(awa);
    expect(await compte('sessions', 'user_id = $1 AND revoked_at IS NULL', [awa.userId])).toBe(1);

    const r = await people.archive(admin, { ids: [awa.employeeId], archived: true });

    expect(r).toEqual({ done: 1, skipped: [] });
    const detail = await people.detail(admin, awa.employeeId);
    expect(detail.status).toBe('archived');
    expect(detail.archivedAt).not.toBeNull();
    expect(await compte('sessions', 'user_id = $1 AND revoked_at IS NULL', [awa.userId])).toBe(0);
  });

  it('ne touche PAS au compte — c’est ce qui rend la réactivation indolore', async () => {
    const avant = await raw(`SELECT email, password_hash, status FROM users WHERE id = $1`, [
      awa.userId,
    ]);
    await people.archive(admin, { ids: [awa.employeeId], archived: true });
    const apres = await raw(`SELECT email, password_hash, status FROM users WHERE id = $1`, [
      awa.userId,
    ]);
    expect(apres.rows[0]).toEqual(avant.rows[0]);
    // L'appartenance aussi : le rôle retrouvé est celui d'avant.
    expect(await compte('user_tenant_memberships', 'user_id = $1', [awa.userId])).toBe(1);
  });

  it('rouvre le dossier, et efface la date d’archivage', async () => {
    await people.archive(admin, { ids: [awa.employeeId], archived: true });
    await people.archive(admin, { ids: [awa.employeeId], archived: false });
    const detail = await people.detail(admin, awa.employeeId);
    expect(detail.status).toBe('active');
    expect(detail.archivedAt).toBeNull();
  });

  it('refuse de fermer le dossier d’un chef d’unité', async () => {
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, manager_employee_id)
       VALUES ($1,$2,'Direction Financière','direction',$3)`,
      [uniteId, tenantId, awa.employeeId],
    );
    const r = await people.archive(admin, { ids: [awa.employeeId], archived: true });
    expect(r.done).toBe(0);
    expect(r.skipped[0]!.reason).toContain('Direction Financière');
    // …mais laisse rouvrir : ce sens-là ne décapite personne.
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [awa.employeeId]);
    expect((await people.archive(admin, { ids: [awa.employeeId], archived: false })).done).toBe(1);
  });

  it('refuse de fermer son propre dossier', async () => {
    const moi = await creerDossier('MOI', false);
    await raw(`UPDATE persons SET user_id = $1 WHERE id = $2`, [adminUserId, moi.personId]);
    const r = await people.archive(admin, { ids: [moi.employeeId], archived: true });
    expect(r.done).toBe(0);
    expect(r.skipped[0]!.reason).toContain('propre dossier');
  });

  it('traite le lot en entier, sauf ce qu’il écarte', async () => {
    const bruno = await creerDossier('BRUNO', false);
    const chef = await creerDossier('CHEF', false);
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, manager_employee_id)
       VALUES ($1,$2,'Service Paie','service',$3)`,
      [randomUUID(), tenantId, chef.employeeId],
    );
    const r = await people.archive(admin, {
      ids: [awa.employeeId, bruno.employeeId, chef.employeeId],
      archived: true,
    });
    expect(r.done).toBe(2);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.id).toBe(chef.employeeId);
  });
});

describe('suppression définitive', () => {
  it('ne laisse rien du dossier ni de ce qui pendait à lui', async () => {
    const { requestId } = await garnir(awa);
    const r = await people.remove(admin, { ids: [awa.employeeId] });
    expect(r).toEqual({ done: 1, skipped: [] });

    expect(await compte('employees', 'id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('persons', 'id = $1', [awa.personId])).toBe(0);
    expect(await compte('absence_requests', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('absence_approvals', 'request_id = $1', [requestId])).toBe(0);
    expect(await compte('absence_documents', 'request_id = $1', [requestId])).toBe(0);
    expect(await compte('absence_balances', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('employee_documents', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('document_requests', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('assignments', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('contracts', 'employee_id = $1', [awa.employeeId])).toBe(0);
    expect(await compte('sessions', 'user_id = $1', [awa.userId])).toBe(0);
    expect(await compte('notifications', 'recipient_user_id = $1', [awa.userId])).toBe(0);
    // Y compris celles qui le nommaient dans la boîte de quelqu'un d'autre.
    // Borné au tenant : « Awa Diop » existe aussi dans les données de démo,
    // et une assertion globale les compterait.
    expect(
      await compte('notifications', "tenant_id = $1 AND title ILIKE '%AWA%'", [tenantId]),
    ).toBe(0);
    expect(await compte('user_tenant_memberships', 'user_id = $1', [awa.userId])).toBe(0);
  });

  it('vide le journal d’audit de ce qu’il avait recopié, et garde la trace', async () => {
    await garnir(awa);
    const personId = awa.personId;
    await people.remove(admin, { ids: [awa.employeeId] });

    const lignes = await raw(
      `SELECT action, old_data, new_data FROM audit_log
        WHERE tenant_id = $1 AND row_id = $2 ORDER BY occurred_at`,
      [tenantId, personId],
    );
    // La trace : on sait qu'une personne a été créée puis supprimée ici.
    expect(lignes.rowCount).toBeGreaterThan(0);
    expect(lignes.rows.map((l: { action: string }) => l.action)).toContain('DELETE');
    // Le contenu : plus rien. Sans cela l'état civil complet — date de
    // naissance, téléphone, pièce d'identité chiffrée — survivrait à
    // l'effacement dans la seule table que l'application ne peut pas purger.
    for (const l of lignes.rows as { old_data: unknown; new_data: unknown }[]) {
      expect(l.old_data).toBeNull();
      expect(l.new_data).toBeNull();
    }

    // Et surtout : le nom ne traîne NULLE PART dans le journal. Cette assertion
    // large est la seule qui tienne dans le temps — la première version de
    // l'effacement nettoyait une liste de tables écrite à la main, et laissait
    // derrière elle l'email porté par l'invitation et le corps de la
    // notification, sur deux tables qu'on avait oublié d'y mettre.
    const partout = await raw(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1
          AND (old_data::text ILIKE '%AWA%' OR new_data::text ILIKE '%AWA%')`,
      [tenantId],
    );
    expect((partout.rows[0] as { n: number }).n).toBe(0);
  });

  it('vide le compte au lieu de le détruire, pour ne pas crever le dossier des autres', async () => {
    // Awa a validé une absence : sa ligne de compte est référencée ailleurs.
    const autre = await creerDossier('BRUNO', false);
    const typeId = randomUUID();
    const requestId = randomUUID();
    await raw(`INSERT INTO absence_types (id, tenant_id, name) VALUES ($1,$2,'Congé')`, [
      typeId,
      tenantId,
    ]);
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4,'2026-04-06','2026-04-10',5,'approved')`,
      [requestId, tenantId, autre.employeeId, typeId],
    );
    await raw(
      `INSERT INTO absence_approvals (id, tenant_id, request_id, level, decision, decided_by_user_id)
       VALUES ($1,$2,$3,1,'approved',$4)`,
      [randomUUID(), tenantId, requestId, awa.userId],
    );

    await people.remove(admin, { ids: [awa.employeeId] });

    const u = await raw(`SELECT email, given_name, family_name, status FROM users WHERE id = $1`, [
      awa.userId,
    ]);
    expect(u.rowCount).toBe(1);
    const compteVide = u.rows[0] as { email: string; given_name: string; status: string };
    expect(compteVide.status).toBe('deleted');
    expect(compteVide.given_name).toBe('Compte');
    expect(compteVide.email).not.toContain('awa');
    // Le visa de Bruno n'a pas bougé : son dossier reste lisible.
    expect(await compte('absence_approvals', 'request_id = $1', [requestId])).toBe(1);
  });

  it('détache les subordonnés et l’unité au lieu de les casser', async () => {
    const subalterne = await creerDossier('BRUNO', false);
    await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [
      awa.employeeId,
      subalterne.employeeId,
    ]);
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type) VALUES ($1,$2,'Service X','service')`,
      [uniteId, tenantId],
    );
    // Chef d'une unité : on refuse tant qu'il n'a pas de successeur…
    await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [
      awa.employeeId,
      uniteId,
    ]);
    expect((await people.remove(admin, { ids: [awa.employeeId] })).done).toBe(0);

    // …et une fois l'unité rendue, la suppression détache les subordonnés.
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uniteId]);
    expect((await people.remove(admin, { ids: [awa.employeeId] })).done).toBe(1);
    const reste = await raw(`SELECT manager_employee_id FROM employees WHERE id = $1`, [
      subalterne.employeeId,
    ]);
    expect(
      (reste.rows[0] as { manager_employee_id: string | null }).manager_employee_id,
    ).toBeNull();
  });

  it('refuse d’effacer le dernier administrateur', async () => {
    const patron = await creerDossier('PATRON', true);
    await raw(`UPDATE user_tenant_memberships SET role = 'admin' WHERE user_id = $1`, [
      patron.userId,
    ]);
    // Deux administrateurs : celui-ci s'efface.
    expect((await people.remove(admin, { ids: [patron.employeeId] })).done).toBe(1);

    // Seul administrateur restant : on ne se laisse pas enfermer dehors.
    const solo = await creerDossier('SOLO', true);
    await raw(`UPDATE user_tenant_memberships SET role = 'admin' WHERE user_id = $1`, [
      solo.userId,
    ]);
    await raw(`DELETE FROM user_tenant_memberships WHERE user_id = $1`, [adminUserId]);
    const r = await people.remove(admin, { ids: [solo.employeeId] });
    expect(r.done).toBe(0);
    expect(r.skipped[0]!.reason).toContain('administrateur');
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'admin')`,
      [randomUUID(), tenantId, adminUserId],
    );
  });

  it('ne franchit pas la frontière du tenant', async () => {
    const autreTenant = randomUUID();
    await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Voisin',$2)`, [
      autreTenant,
      `voisin-${autreTenant.slice(0, 8)}`,
    ]);
    const personId = randomUUID();
    const employeeId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,'Voisin','Test')`,
      [personId, autreTenant],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
       VALUES ($1,$2,$3,'VOISIN','2024-01-01')`,
      [employeeId, autreTenant, personId],
    );

    const r = await people.remove(admin, { ids: [employeeId] });
    expect(r).toEqual({ done: 0, skipped: [] }); // invisible, donc intouchable
    expect(await compte('employees', 'id = $1', [employeeId])).toBe(1);

    await raw(`DELETE FROM employees WHERE tenant_id = $1`, [autreTenant]);
    await raw(`DELETE FROM persons WHERE tenant_id = $1`, [autreTenant]);
    await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [autreTenant]);
    await raw(`DELETE FROM tenants WHERE id = $1`, [autreTenant]);
  });

  it('refuse d’effacer son propre dossier', async () => {
    const moi = await creerDossier('MOI', false);
    await raw(`UPDATE persons SET user_id = $1 WHERE id = $2`, [adminUserId, moi.personId]);
    const r = await people.remove(admin, { ids: [moi.employeeId] });
    expect(r.done).toBe(0);
    expect(await compte('employees', 'id = $1', [moi.employeeId])).toBe(1);
  });
});

describe('le statut ne se change plus par la porte de service', () => {
  it('la modification générique ignore un statut glissé dans le corps', async () => {
    await people.update(admin, awa.employeeId, {
      employee: { status: 'archived' } as never,
    });
    const detail = await people.detail(admin, awa.employeeId);
    expect(detail.status).toBe('active');
  });

  it('un dossier archivé ne s’invite plus au portail', async () => {
    const sansPortail = await creerDossier('SANS', false);
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [sansPortail.employeeId]);
    // Le service d'invitation refuse avant même de chercher un email.
    const { InvitationsService } = await import('../src/modules/portal/invitations.service');
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const invitations = new InvitationsService(db, new AuthService(db));
    expect(
      await codeOf(() =>
        invitations.invite(admin, sansPortail.employeeId, 'employee', 'sans@test.local'),
      ),
    ).toBe('portal.employee_archived');
  });
});
