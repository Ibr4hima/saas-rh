/**
 * La fiche reçoit tout ce que la DCH tient sur chaque agent (ADR-0158) :
 * la naissance, la famille, l'adresse, le contact d'urgence, l'emploi, et la
 * rémunération, réservée à l'accès aux données sensibles.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  type CreateEmployeeInput,
  type SessionUser,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { dossierDeLAgent } from '../src/modules/documents/dossier';
import { PeopleService } from '../src/modules/people/people.service';

const env = loadEnv();
const tenantId = randomUUID();
const userId = randomUUID();

/** La DCH avec l'accès aux données sensibles, et sans. */
const sensible = {
  userId,
  tenantId,
  role: 'employee',
  capacites: ['personnel.gerer', 'personnel.sensible'],
} as SessionUser;
const gestion = { ...sensible, capacites: ['personnel.gerer'] } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;

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

let n = 0;
/** Un dossier minimal, au matricule unique ; `plus` le complète. */
function dossier(plus: Partial<CreateEmployeeInput> = {}): CreateEmployeeInput {
  n += 1;
  return createEmployeeSchema.parse({
    person: { givenName: `Agent${n}`, familyName: 'Fiche', ...plus.person },
    employee: { employeeNumber: `FC-${n}`, hiredOn: '2024-03-01', ...plus.employee },
    ...(plus.remuneration ? { remuneration: plus.remuneration } : {}),
  });
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','DCH')`,
    [userId, `fiche-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Fiche',$2)`, [
    tenantId,
    `fiche-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
});

afterAll(async () => {
  await ownerPool.end();
});

describe('la fiche complète', () => {
  it('reçoit la naissance, la famille, l’adresse, le contact d’urgence et l’emploi', async () => {
    const chef = await people.create(sensible, dossier());
    const { id } = await people.create(
      sensible,
      dossier({
        person: {
          givenName: 'Moussa',
          familyName: 'Fall',
          gender: 'male',
          maritalStatus: 'married',
          lieuDeNaissance: 'Thiès',
          prenomDuPere: 'Ibrahima',
          prenomDeLaMere: 'Awa',
          nomDeLaMere: 'Sarr',
          epouses: ['Fatou Ndiaye', 'Aïda Sow'],
          nombreEnfants: 3,
          ville: 'Rufisque',
          region: 'dakar',
          emergencyContactName: 'Awa Sarr',
          emergencyContactPhone: '+221771234567',
          lienContactUrgence: 'mere',
          idDocumentType: 'cni',
          nationalId: '1 234 1990 01234',
        },
        employee: {
          employeeNumber: 'FC-MF',
          hiredOn: '2024-03-01',
          lieuDeTravail: 'Siège',
          projet: 'Guichet unique',
          categorie: '5B',
          responsableFonctionnelId: chef.id,
        },
      }),
    );
    const e = await people.detail(sensible, id);
    expect(e.person).toMatchObject({
      lieuDeNaissance: 'Thiès',
      prenomDuPere: 'Ibrahima',
      prenomDeLaMere: 'Awa',
      nomDeLaMere: 'Sarr',
      epouses: ['Fatou Ndiaye', 'Aïda Sow'],
      nombreEnfants: 3,
      ville: 'Rufisque',
      region: 'dakar',
      lienContactUrgence: 'mere',
      // La CNI se garde en chiffres seuls.
      nationalId: '1234199001234',
    });
    expect(e).toMatchObject({
      lieuDeTravail: 'Siège',
      projet: 'Guichet unique',
      categorie: '5B',
      responsableFonctionnel: { id: chef.id, matricule: expect.stringMatching(/^FC-/) },
      matriculeProvisoire: false,
      entreeAuMois: false,
    });
  });

  it('garde la rémunération pour l’accès aux données sensibles', async () => {
    const { id } = await people.create(
      sensible,
      dossier({
        remuneration: {
          salaireDeBase: 450_000,
          sursalaire: 0,
          nombreDeParts: 2.5,
          banque: 'cbao',
          rib: 'sn012 01001 036123456789 54',
          numeroIpres: 'IP-77',
        },
      }),
    );
    expect((await people.detail(sensible, id)).remuneration).toMatchObject({
      salaireDeBase: 450_000,
      sursalaire: 0,
      brutSocial: null,
      nombreDeParts: 2.5,
      banque: 'cbao',
      rib: 'SN0120100103612345678954',
      numeroIpres: 'IP-77',
    });
    // Chiffré en base, comme la pièce d'identité.
    const { rows } = await raw(`SELECT rib_chiffre FROM remunerations WHERE employee_id = $1`, [
      id,
    ]);
    expect(rows[0].rib_chiffre).not.toContain('SN012');
    // Sans l'accès : ni lue, ni écrite.
    expect((await people.detail(gestion, id)).remuneration).toBeNull();
    expect(
      await codeOf(() =>
        people.update(gestion, id, updateEmployeeSchema.parse({ remuneration: { carburant: 1 } })),
      ),
    ).toBe('people.donnees_sensibles');
    expect(
      await codeOf(() => people.create(gestion, dossier({ remuneration: { salaireDeBase: 1 } }))),
    ).toBe('people.donnees_sensibles');
    // Absent, inchangé ; null, effacé.
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({ remuneration: { salaireDeBase: null, carburant: 60_000 } }),
    );
    expect((await people.detail(sensible, id)).remuneration).toMatchObject({
      salaireDeBase: null,
      carburant: 60_000,
      banque: 'cbao',
    });
  });

  it('déclare des épouses pour un homme marié seulement, quatre au plus', async () => {
    const femme = createEmployeeSchema.safeParse({
      person: { givenName: 'A', familyName: 'B', gender: 'female', epouses: ['X'] },
      employee: { employeeNumber: 'X1', hiredOn: '2024-01-01' },
    });
    expect(femme.error?.issues[0]?.message).toBe(
      'Les épouses se renseignent pour un homme marié seulement',
    );
    const cinq = createEmployeeSchema.safeParse({
      person: {
        givenName: 'A',
        familyName: 'B',
        gender: 'male',
        maritalStatus: 'married',
        epouses: ['1', '2', '3', '4', '5'],
      },
      employee: { employeeNumber: 'X1', hiredOn: '2024-01-01' },
    });
    expect(cinq.success).toBe(false);

    // En modification : la fiche telle qu'elle sera.
    const { id } = await people.create(
      sensible,
      dossier({ person: { givenName: 'Ali', familyName: 'Ba', gender: 'male' } }),
    );
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ person: { epouses: ['Coumba'] } }),
        ),
      ),
    ).toBe('people.epouses');
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({ person: { maritalStatus: 'married', epouses: ['Coumba'] } }),
    );
    expect((await people.detail(sensible, id)).person.epouses).toEqual(['Coumba']);
    // Divorcé, avec une épouse déclarée : refusé tant qu'on ne la retire pas.
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ person: { maritalStatus: 'divorced' } }),
        ),
      ),
    ).toBe('people.epouses');
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({ person: { maritalStatus: 'divorced', epouses: [] } }),
    );
    expect((await people.detail(sensible, id)).person.epouses).toEqual([]);
  });

  it('vérifie la CNI, le téléphone sénégalais et l’adresse professionnelle', async () => {
    const cni = createEmployeeSchema.safeParse({
      person: {
        givenName: 'A',
        familyName: 'B',
        idDocumentType: 'cni',
        nationalId: '123456789012',
      },
      employee: { employeeNumber: 'X1', hiredOn: '2024-01-01' },
    });
    expect(cni.error?.issues[0]?.message).toBe('Le numéro de CNI compte 13 chiffres');
    // Un passeport garde son propre format.
    expect(
      createEmployeeSchema.safeParse({
        person: { givenName: 'A', familyName: 'B', idDocumentType: 'passport', nationalId: 'A12' },
        employee: { employeeNumber: 'X1', hiredOn: '2024-01-01' },
      }).success,
    ).toBe(true);
    const telephone = (phone: string) =>
      createEmployeeSchema.safeParse({
        person: { givenName: 'A', familyName: 'B', phone },
        employee: { employeeNumber: 'X1', hiredOn: '2024-01-01' },
      }).success;
    expect(telephone('+221771234567')).toBe(true);
    expect(telephone('+221331234567')).toBe(true);
    expect(telephone('+221871234567')).toBe(false);
    expect(telephone('+22177123456')).toBe(false);
    expect(telephone('+33612345678')).toBe(true);

    const { id } = await people.create(
      sensible,
      dossier({
        person: {
          givenName: 'Sira',
          familyName: 'Diatta',
          idDocumentType: 'cni',
          nationalId: '1234567890123',
        },
      }),
    );
    // Le type déjà enregistré compte : douze chiffres sur une CNI, refusé.
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ person: { nationalId: '123456789012' } }),
        ),
      ),
    ).toBe('people.cni');
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ employee: { workEmail: 's.diatta@gmail.com' } }),
        ),
      ),
    ).toBe('people.courriel_pro');
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({ employee: { workEmail: 's.diatta@apix.sn' } }),
    );
    expect(
      await codeOf(() =>
        people.create(
          sensible,
          dossier({
            employee: {
              employeeNumber: 'FC-MAIL',
              hiredOn: '2024-01-01',
              workEmail: 'a@exemple.sn',
            },
          }),
        ),
      ),
    ).toBe('people.courriel_pro');
  });

  it('prend un responsable fonctionnel en activité, jamais l’agent concerné', async () => {
    const { id } = await people.create(sensible, dossier());
    const parti = await people.create(sensible, dossier());
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [parti.id]);
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ employee: { responsableFonctionnelId: id } }),
        ),
      ),
    ).toBe('people.fonctionnel_soi');
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          id,
          updateEmployeeSchema.parse({ employee: { responsableFonctionnelId: parti.id } }),
        ),
      ),
    ).toBe('people.fonctionnel_inactif');
  });

  it('corrige sans délai un matricule provisoire, et oublie le mois d’une date précisée', async () => {
    const { id } = await people.create(sensible, dossier(), {
      matriculeProvisoire: true,
      entreeAuMois: true,
    });
    const autre = await people.create(sensible, dossier());
    // Trente et un jours plus tard, un matricule ordinaire est figé.
    await raw(`UPDATE employees SET created_at = now() - interval '31 days' WHERE id = ANY($1)`, [
      [id, autre.id],
    ]);
    expect((await people.detail(sensible, id)).matriculeFige).toBe(false);
    expect(
      await codeOf(() =>
        people.update(
          sensible,
          autre.id,
          updateEmployeeSchema.parse({ employee: { employeeNumber: 'FC-NEUF' } }),
        ),
      ),
    ).toBe('people.matricule_fige');
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({
        employee: { employeeNumber: 'FC-VRAI', hiredOn: '2024-03-13' },
      }),
    );
    expect(await people.detail(sensible, id)).toMatchObject({
      employeeNumber: 'FC-VRAI',
      matriculeProvisoire: false,
      matriculeFige: true,
      entreeAuMois: false,
      hiredOn: '2024-03-13',
    });
  });

  it('n’établit pas de document sur une date d’entrée connue au mois', async () => {
    const { id } = await people.create(
      sensible,
      dossier({ person: { givenName: 'Ndeye', familyName: 'Seck' } }),
      { entreeAuMois: true },
    );
    const lire = () =>
      db.withTenant({ tenantId, userId }, (tx) =>
        dossierDeLAgent(tx, id, 'Attestation de travail'),
      );
    expect(await codeOf(lire)).toBe('documents.entree_au_mois');
    await people.update(
      sensible,
      id,
      updateEmployeeSchema.parse({ employee: { hiredOn: '2024-03-04' } }),
    );
    expect((await lire()).depuis).toBe('2024-03-04');
  });
});
