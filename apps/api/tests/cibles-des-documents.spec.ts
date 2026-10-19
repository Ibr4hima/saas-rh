/**
 * La cible de chaque document (ADR-0130) : « Générer des documents » ne
 * propose que les agents à qui le document s'adresse, et le serveur refuse
 * de le générer pour un autre. Une attestation de travail ne se délivre pas
 * pour un stage, ni un certificat de travail pour un dossier en activité ;
 * le congé de maternité suppose le genre féminin, le départ à la retraite
 * 40 ans au moins et un CDI ou un CDD (ADR-0131). « Demander un document »
 * n'offre à l'agent que les documents de sa cible (ADR-0137).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { CAPACITES_DELEGABLES } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { GenerationService } from '../src/modules/documents/generation.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), membre: randomUUID() };

const session = (userId: string, s: Partial<SessionUser>) =>
  ({ userId, tenantId, role: 'employee', capacites: [], ...s }) as SessionUser;
const dch = session(ids.dch, { dirigeLaDCH: true, capacites: [...CAPACITES_DELEGABLES] });
const membre = session(ids.membre, { capacites: ['generation.contrat_cdi'] });

let ownerPool: Pool;
let db: TenantDb;
let service: GenerationService;

const raw = (q: string, params: unknown[] = []) => ownerPool.query(q, params as never[]);

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Le dossier de chacun : statut, genre, naissance, contrats (type, début, fin). */
const DOSSIERS = {
  // Qui dirige la DCH : son propre dossier ne se propose jamais.
  dch: ['Mariama', 'Cissé', 'active', 'female', '1979-02-10', [['cdi', '2015-01-05', null]]],
  awa: ['Awa', 'Diop', 'active', 'female', '1984-06-01', [['cdi', '2018-03-01', null]]],
  moussa: ['Moussa', 'Ndiaye', 'active', 'male', '1995-01-20', [['cdi', '2020-09-01', null]]],
  cheikh: ['Cheikh', 'Mbaye', 'active', 'male', '1968-05-15', [['cdi', '2001-02-01', null]]],
  // En stage aujourd'hui, embauche prévue l'an prochain.
  binta: [
    'Binta',
    'Sow',
    'active',
    'female',
    '2003-11-02',
    [
      ['stage', '2026-03-01', '2027-02-28'],
      ['cdi', '2027-03-01', null],
    ],
  ],
  // Le stage, puis l'embauche.
  khady: [
    'Khady',
    'Faye',
    'active',
    'female',
    '1999-04-09',
    [
      ['stage', '2023-01-02', '2023-12-31'],
      ['cdi', '2024-01-02', null],
    ],
  ],
  // Un départ après un CDI : le certificat de travail.
  aminata: ['Aminata', 'Fall', 'archived', 'female', '1985-08-30', [['cdi', '2012-04-01', null]]],
  // Deux stages, puis le départ : ni certificat de travail, ni attestation de travail.
  ousmane: [
    'Ousmane',
    'Gaye',
    'archived',
    'male',
    '2001-07-07',
    [
      ['stage', '2019-02-04', '2019-07-31'],
      ['stage', '2025-01-06', '2025-06-30'],
    ],
  ],
  // Ni genre ni date de naissance au dossier.
  fatou: ['Fatou', 'Sall', 'active', null, null, [['cdd', '2025-02-01', '2027-01-31']]],
  ndeye: ['Ndèye', 'Thiam', 'active', 'female', null, [['cdi', '2019-10-01', null]]],
  // En détachement : un contrat de travail, mais ni CDI ni CDD.
  samba: ['Samba', 'Diallo', 'active', 'male', '1975-03-03', [['detachement', '2021-01-04', null]]],
} as const;
type Cle = keyof typeof DOSSIERS;
const employes = {} as Record<Cle, string>;

const noms = async (doc: string, q = '') =>
  (await service.agents(dch, doc, q)).map((a) => a.givenName);

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Cibles', $2)`, [
    tenantId,
    `cibles-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Cibles')`,
      [userId, `cibles-${cle}-${userId}@test.local`, cle],
    );
  }
  let numero = 0;
  for (const [cle, [prenom, nom, statut, genre, naissance, contrats]] of Object.entries(
    DOSSIERS,
  ) as [Cle, (typeof DOSSIERS)[Cle]][]) {
    const personId = randomUUID();
    const employeeId = randomUUID();
    employes[cle] = employeeId;
    numero += 1;
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender, birth_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [personId, tenantId, cle === 'dch' ? ids.dch : null, prenom, nom, genre, naissance],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status,
                              archived_at, fin_activite, inactivite_motif)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        employeeId,
        tenantId,
        personId,
        `CIB-${String(numero).padStart(3, '0')}`,
        contrats[0][1],
        statut,
        statut === 'archived' ? '2026-07-01T00:00:00Z' : null,
        statut === 'archived' ? '2026-06-30' : null,
        statut === 'archived' ? 'demission' : null,
      ],
    );
    for (const [type, debut, fin] of contrats) {
      await raw(
        `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), tenantId, employeeId, type, debut, fin],
      );
    }
  }
});

afterAll(async () => {
  for (const table of ['contracts', 'employees', 'persons', 'holidays', 'holiday_seeds']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la liste des agents, document par document', () => {
  it('l’attestation de travail : les dossiers en activité sous contrat de travail, ni stage, ni dossier inactif, ni soi', async () => {
    const attendus = ['Awa', 'Moussa', 'Cheikh', 'Khady', 'Fatou', 'Ndèye', 'Samba'];
    for (const doc of [
      'attestation_travail',
      'attestation_revenu',
      'attestation_conge',
      'attestation_reprise_disponibilite',
    ]) {
      expect((await noms(doc)).sort()).toEqual([...attendus].sort());
    }
  });

  it('le certificat de travail : les dossiers inactifs, sous contrat de travail', async () => {
    expect(await noms('certificat_travail')).toEqual(['Aminata']);
  });

  it('l’attestation de stage : un stage commencé, en activité ou non', async () => {
    expect((await noms('attestation_stage')).sort()).toEqual(['Binta', 'Khady', 'Ousmane']);
  });

  it('le congé de maternité : le genre féminin, en activité, sous contrat de travail', async () => {
    for (const doc of ['attestation_cessation', 'attestation_reprise_service']) {
      expect((await noms(doc)).sort()).toEqual(['Awa', 'Khady', 'Ndèye']);
    }
  });

  it('le départ à la retraite : dès 40 ans, sous CDI ou CDD, la date de naissance au dossier', async () => {
    expect((await noms('attestation_depart_retraite')).sort()).toEqual(['Awa', 'Cheikh']);
  });

  it('la recherche : un nom ou un matricule, sans égard aux accents ni à l’ordre', async () => {
    expect(await noms('attestation_travail', 'diop awa')).toEqual(['Awa']);
    expect(await noms('attestation_travail', 'ndeye')).toEqual(['Ndèye']);
    expect(await noms('attestation_travail', 'cib-002')).toEqual(['Awa']);
    // Hors de la cible, le nom ne sort pas.
    expect(await noms('attestation_travail', 'binta')).toEqual([]);
  });

  it('chaque agent porte sa situation : la page garde l’agent choisi d’un document à l’autre', async () => {
    const [khady] = await service.agents(dch, 'attestation_stage', 'khady');
    expect(khady?.situation).toEqual({
      enActivite: true,
      contrat: 'cdi',
      stage: true,
      genre: 'female',
      age: expect.any(Number),
    });
  });
});

describe('le refus', () => {
  it('hors de la cible, le document ne se génère pas, et le refus dit pourquoi', async () => {
    expect(await codeOf(() => service.pdf(dch, 'attestation_travail', employes.binta))).toBe(
      'documents.stage',
    );
    expect(
      await codeOf(() => service.pdf(dch, 'certificat_travail', employes.awa, { categorie: '7B' })),
    ).toBe('documents.en_activite');
    expect(
      await codeOf(() =>
        service.pdf(dch, 'attestation_cessation', employes.fatou, { debut: '2026-11-02' }),
      ),
    ).toBe('documents.genre');
    const jeune = await service
      .pdf(dch, 'attestation_depart_retraite', employes.moussa, { depart: '2027-01-31' })
      .catch((e: unknown) => e);
    expect((jeune as ProblemException).problem).toMatchObject({
      status: 422,
      code: 'documents.age',
      title: 'Attestation de départ à la retraite : moins de 40 ans',
    });
    const detache = await service
      .pdf(dch, 'attestation_depart_retraite', employes.samba, { depart: '2027-01-31' })
      .catch((e: unknown) => e);
    expect((detache as ProblemException).problem).toMatchObject({
      code: 'documents.contrat',
      title: 'Attestation de départ à la retraite : ni CDI ni CDD',
    });
    const sansNaissance = await service
      .pdf(dch, 'attestation_depart_retraite', employes.ndeye, { depart: '2027-01-31' })
      .catch((e: unknown) => e);
    expect((sansNaissance as ProblemException).problem).toMatchObject({
      code: 'documents.age',
      title: 'Attestation de départ à la retraite : date de naissance manquante',
    });
  });

  it('dans la cible, le document se génère', async () => {
    const { filename } = await service.pdf(dch, 'attestation_depart_retraite', employes.cheikh, {
      depart: '2028-05-31',
    });
    expect(filename).toBe('attestation-depart-retraite-CIB-004.pdf');
    const certificat = await service.pdf(dch, 'certificat_travail', employes.aminata, {
      categorie: '7B',
    });
    expect(certificat.filename).toBe('certificat-travail-CIB-007.pdf');
  });
});

describe('l’attestation de stage', () => {
  it('à plusieurs stages, la page demande lequel ; l’attestation cite celui-là', async () => {
    expect(await service.stages(dch, employes.ousmane)).toEqual([
      { debut: '2019-02-04', fin: '2019-07-31', poste: null },
      { debut: '2025-01-06', fin: '2025-06-30', poste: null },
    ]);
    expect(await codeOf(() => service.pdf(dch, 'attestation_stage', employes.ousmane))).toBe(
      'documents.stage_a_choisir',
    );
    const { filename } = await service.pdf(dch, 'attestation_stage', employes.ousmane, {
      stage: '2019-02-04',
    });
    expect(filename).toBe('attestation-stage-CIB-008.pdf');
    // Sans stage au dossier, pas de liste : l'agent est hors de la cible.
    expect(await codeOf(() => service.stages(dch, employes.awa))).toBe('documents.sans_stage');
  });
});

describe('qui voit la cible', () => {
  it('qui ne génère pas le document n’en voit pas la cible ; un document sans agent n’en a pas', async () => {
    expect(await codeOf(() => service.agents(membre, 'attestation_travail', ''))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(() => service.agents(dch, 'contrat_cdi', ''))).toBe('documents.sans_agent');
  });
});

describe('les documents qu’un agent demande (ADR-0137)', () => {
  const agents = ['awa', 'moussa', 'binta', 'khady', 'samba'] as const;
  const comptes = {} as Record<(typeof agents)[number], SessionUser>;
  let demandes: DocumentRequestsService;

  beforeAll(async () => {
    demandes = new DocumentRequestsService(
      db,
      new NotificationsService(db),
      new EncryptionService(),
    );
    for (const cle of agents) {
      const userId = randomUUID();
      await raw(
        `INSERT INTO users (id, email, password_hash, given_name, family_name)
         VALUES ($1, $2, 'x', $3, 'Cibles')`,
        [userId, `cibles-agent-${cle}-${userId}@test.local`, cle],
      );
      await raw(
        `UPDATE persons SET user_id = $1 WHERE id = (SELECT person_id FROM employees WHERE id = $2)`,
        [userId, employes[cle]],
      );
      comptes[cle] = session(userId, {});
    }
  });

  afterAll(async () => {
    const userIds = Object.values(comptes).map((c) => c.userId);
    await raw(`UPDATE persons SET user_id = NULL WHERE user_id = ANY($1)`, [userIds]);
    await raw(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
  });

  it('la liste n’offre que les documents de sa cible : le contrat, le genre, l’âge, le stage en décident', async () => {
    const liste = (cle: (typeof agents)[number]) => demandes.demandables(comptes[cle]);
    const emploi = [
      'domiciliation_bancaire',
      'decision_disponibilite',
      'decision_renouvellement_disponibilite',
      'declaration_mouvement',
    ];
    // Awa : un CDI, 42 ans, le genre féminin ; ni stage, ni départ.
    expect(await liste('awa')).toEqual([
      'attestation_conge',
      'attestation_travail',
      'attestation_reprise_service',
      'attestation_reprise_disponibilite',
      'attestation_depart_retraite',
      'attestation_cessation',
      'attestation_revenu',
      ...emploi,
    ]);
    // Moussa : un CDI, 31 ans, le genre masculin : ni la maternité, ni la retraite.
    expect(await liste('moussa')).toEqual([
      'attestation_conge',
      'attestation_travail',
      'attestation_reprise_disponibilite',
      'attestation_revenu',
      ...emploi,
    ]);
    // Binta, en stage : l'attestation de stage seule.
    expect(await liste('binta')).toEqual(['attestation_stage']);
    // Khady, en CDI après son stage : l'attestation de stage aussi.
    expect(await liste('khady')).toContain('attestation_stage');
    // Samba, en détachement : un contrat de travail, mais ni CDI ni CDD.
    expect(await liste('samba')).toEqual([
      'attestation_conge',
      'attestation_travail',
      'attestation_reprise_disponibilite',
      'attestation_revenu',
    ]);
  });

  it('le serveur refuse un document hors de sa cible, et dit pourquoi', async () => {
    const refus = (cle: (typeof agents)[number], doc: string) =>
      codeOf(() => demandes.create(comptes[cle], { docTypes: [doc] as never }));
    expect(await refus('binta', 'attestation_travail')).toBe('documents.stage');
    expect(await refus('moussa', 'attestation_cessation')).toBe('documents.genre');
    expect(await refus('moussa', 'attestation_depart_retraite')).toBe('documents.age');
    expect(await refus('moussa', 'attestation_stage')).toBe('documents.sans_stage');
    expect(await refus('moussa', 'certificat_travail')).toBe('documents.en_activite');
    expect(await refus('samba', 'domiciliation_bancaire')).toBe('documents.contrat');
    // Rien n'est parti.
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM document_requests WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});
