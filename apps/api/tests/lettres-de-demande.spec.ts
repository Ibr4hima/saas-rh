/**
 * La lettre de demande (ADR-0189) : une mise en disponibilité, son
 * renouvellement et une domiciliation bancaire se demandent par lettre.
 * L'agent la joint et, pour une décision, donne la date écrite dessus.
 * Qui traite la demande la lit, et génère le document au titre de la
 * demande, pour l'agent qui l'a faite, sans avoir « Générer des
 * documents ».
 *
 * Le bac d'essai : la DCH, dirigée par Mariama, avec Awa, à qui les trois
 * documents sont délégués, et Khady, sans délégation ; Moussa, à la DSID,
 * sous CDI, qui demande.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FicheDisponibilite, FicheDomiciliation, SessionUser } from '@teranga/contracts';
import { createDocumentRequestSchema, dateDeLaDemande, ficheReprise } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { GenerationService } from '../src/modules/documents/generation.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let demandes: DocumentRequestsService;
let generation: GenerationService;
let habilitations: HabilitationsService;

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

interface Agent {
  employeeId: string;
  session: SessionUser;
}

async function agent(prenom: string, nom: string, unite: string): Promise<Agent> {
  const userId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x',$3,$4)`,
    [userId, `${prenom.toLowerCase()}-${userId}@test.local`, prenom, nom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender)
     VALUES ($1,$2,$3,$4,$5,'male')`,
    [personId, tenantId, userId, prenom, nom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, `LD-${prenom}`],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Comptable', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, employeeId, unite],
  );
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
     VALUES ($1,$2,$3,'cdi','2024-01-01')`,
    [randomUUID(), tenantId, employeeId],
  );
  return {
    employeeId,
    session: {
      userId,
      tenantId,
      role: 'employee',
      givenName: prenom,
      familyName: nom,
    } as SessionUser,
  };
}

async function unite(nom: string, parent: string | null, dch = false): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1,$2,'direction',$3,$4,$5)`,
    [id, tenantId, nom, parent, dch],
  );
  return id;
}

let uDCH: string;
let mariama: Agent;
let awa: Agent;
let khady: Agent;
let moussa: Agent;

/** Un PDF minuscule, mais un PDF : sa signature le dit. */
const pdf = (texte = 'lettre') => Buffer.from(`%PDF-1.4 ${texte}`).toString('base64');
const lettre = (doc: string, datee?: string) => ({
  doc,
  filename: 'Lettre de demande.pdf',
  contentType: 'application/pdf' as const,
  contentBase64: pdf(),
  ...(datee ? { datee } : {}),
});

/** La demande de Moussa, d'un document, avec sa lettre. */
async function demande(doc: string, datee?: string): Promise<string> {
  const corps = createDocumentRequestSchema.parse({
    docTypes: [doc],
    lettres: [lettre(doc, datee)],
  });
  const [id] = (await demandes.create(moussa.session, corps)).ids as [string];
  return id;
}

/** La fiche d'une mise en disponibilité de Moussa, à varier d'un test à l'autre. */
const ficheDeMoussa = (f: Partial<FicheDisponibilite> = {}): FicheDisponibilite => ({
  civilite: 'monsieur',
  prenom: 'Moussa',
  nom: 'Sarr',
  poste: 'Comptable',
  demandeLe: '2026-11-02',
  effetLe: '2026-12-01',
  repriseLe: '2027-06-01',
  pvDirectionGeneraleLe: '2024-05-07',
  pvDirectionGeneraleAdjointeLe: '2024-12-13',
  ...f,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  demandes = new DocumentRequestsService(db, new NotificationsService(db), new EncryptionService());
  generation = new GenerationService(
    db,
    new EncryptionService(),
    new AttestationService(db),
    new AbsencesService(db),
  );
  habilitations = new HabilitationsService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX',$2)`, [
    tenantId,
    `lettres-${tenantId.slice(0, 8)}`,
  ]);
  const uDG = await unite('Direction Générale', null);
  uDCH = await unite('Direction du Capital Humain', uDG, true);
  const uDSID = await unite('Direction des Systèmes', uDG);
  mariama = await agent('Mariama', 'Cissé', uDCH);
  awa = await agent('Awa', 'Diop', uDCH);
  khady = await agent('Khady', 'Fall', uDCH);
  moussa = await agent('Moussa', 'Sarr', uDSID);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
  for (const capacite of [
    'demandes.documents.decision_disponibilite',
    'demandes.documents.decision_renouvellement_disponibilite',
    'demandes.documents.domiciliation_bancaire',
  ] as const) {
    await habilitations.accorder(mariama.session, {
      employeeId: awa.employeeId,
      capacite,
      accordee: true,
    });
  }
});

beforeEach(async () => {
  for (const table of ['notifications', 'document_requests']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
});

afterAll(async () => {
  for (const table of ['notifications', 'document_requests', 'habilitations', 'contracts']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'assignments',
    'org_units',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la demande et sa lettre', () => {
  const messages = (corps: unknown) => {
    const r = createDocumentRequestSchema.safeParse(corps);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('les trois documents exigent leur lettre ; les autres n’en prennent pas', () => {
    expect(messages({ docTypes: ['decision_disponibilite'] })).toEqual([
      'Décision de mise en disponibilité : joignez votre lettre de demande',
    ]);
    expect(messages({ docTypes: ['domiciliation_bancaire'] })).toEqual([
      'Domiciliation bancaire : joignez votre lettre de demande',
    ]);
    expect(messages({ docTypes: ['attestation_travail'] })).toEqual([]);
    expect(
      messages({ docTypes: ['attestation_travail'], lettres: [lettre('domiciliation_bancaire')] }),
    ).toEqual(['Cette lettre ne demande aucun des documents choisis']);
  });

  it('une décision donne la date de la lettre ; la domiciliation, non', () => {
    expect(
      messages({
        docTypes: ['decision_disponibilite'],
        lettres: [lettre('decision_disponibilite')],
      }),
    ).toEqual(['Indiquez la date de votre lettre']);
    expect(
      messages({
        docTypes: ['decision_disponibilite'],
        lettres: [lettre('decision_disponibilite', '2099-01-01')],
      }),
    ).toEqual(['Ne peut pas être dans le futur']);
    expect(
      messages({
        docTypes: ['domiciliation_bancaire'],
        lettres: [lettre('domiciliation_bancaire', '2026-11-02')],
      }),
    ).toEqual(['La domiciliation reprend le jour de l’envoi']);
    expect(
      messages({
        docTypes: ['decision_renouvellement_disponibilite', 'domiciliation_bancaire'],
        lettres: [
          lettre('decision_renouvellement_disponibilite', '2026-11-02'),
          lettre('domiciliation_bancaire'),
        ],
      }),
    ).toEqual([]);
  });

  it('la lettre se garde chiffrée, et la vue dit son nom, sa taille et sa date', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    const [vue] = await demandes.list(moussa.session, { scope: 'mine' });
    expect(vue?.lettre).toEqual({
      filename: 'Lettre de demande.pdf',
      sizeBytes: Buffer.from(pdf(), 'base64').length,
      datee: '2026-11-02',
    });
    // La décision cite la date de la lettre.
    expect(dateDeLaDemande(vue!)).toBe('2026-11-02');
    const { rows } = await raw(
      `SELECT filename, data FROM document_request_lettres WHERE request_id = $1`,
      [id],
    );
    expect(rows[0].filename).not.toContain('Lettre');
    expect(Buffer.from(rows[0].data).subarray(0, 5).toString()).not.toBe('%PDF-');
  });

  it('la domiciliation reprend le jour de l’envoi', async () => {
    await demande('domiciliation_bancaire');
    const [vue] = await demandes.list(moussa.session, { scope: 'mine' });
    expect(vue?.lettre?.datee).toBeNull();
    expect(dateDeLaDemande(vue!)).toBe(vue!.createdAt.slice(0, 10));
  });

  it('une lettre qui n’est pas un PDF se refuse, et rien ne part', async () => {
    const corps = createDocumentRequestSchema.parse({
      docTypes: ['domiciliation_bancaire'],
      lettres: [
        {
          ...lettre('domiciliation_bancaire'),
          contentBase64: Buffer.from('pas un PDF').toString('base64'),
        },
      ],
    });
    expect(await codeOf(() => demandes.create(moussa.session, corps))).toBe('documents.bad_format');
    expect(await demandes.list(moussa.session, { scope: 'mine' })).toEqual([]);
  });

  it('l’agent et qui traite la lisent ; personne d’autre', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    const lue = await demandes.lettre(moussa.session, id);
    expect(lue.filename).toBe('Lettre de demande.pdf');
    expect(lue.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await demandes.lettre(awa.session, id)).data.equals(lue.data)).toBe(true);
    expect(await codeOf(() => demandes.lettre(khady.session, id))).toBe(
      'documents.forbidden_scope',
    );
  });

  it('la demande annulée emporte sa lettre', async () => {
    const id = await demande('domiciliation_bancaire');
    await demandes.cancel(moussa.session, id);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM document_request_lettres
      WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('les avis disent ce que l’agent demande : une disponibilité, pas une décision', async () => {
    const titres = async (id: string, motif: string) =>
      (
        await raw(`SELECT title FROM notifications WHERE dedupe_key LIKE $1`, [
          `document:${id}:${motif}%`,
        ])
      ).rows.map((r: { title: string }) => r.title);
    const dispo = await demande('decision_disponibilite', '2026-11-02');
    const renouvellement = await demande('decision_renouvellement_disponibilite', '2026-11-03');
    expect(await titres(dispo, 'appel')).toContain('Moussa Sarr demande une disponibilité');
    expect(await titres(renouvellement, 'appel')).toContain(
      'Moussa Sarr demande le renouvellement de sa disponibilité',
    );
    await demandes.batchAdvance(awa.session, {
      ids: [dispo],
      status: 'rejected',
      message: 'La lettre ne porte pas de signature',
    });
    expect(await titres(dispo, 'suivi')).toContain('Votre demande de disponibilité a été refusée');
  });

  it('qui traite la retrouve dans la file, avec la lettre', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    const vue = await demandes.une(awa.session, id);
    expect(vue.employeeId).toBe(moussa.employeeId);
    expect(vue.lettre?.datee).toBe('2026-11-02');
    expect(await codeOf(() => demandes.une(khady.session, id))).toBe('documents.request_not_found');
  });
});

describe('ce que la fiche reprend, au titre d’une demande (ADR-0190)', () => {
  const dossier = {
    civilite: 'monsieur' as const,
    prenom: 'Moussa',
    nom: 'Sarr',
    poste: ' Comptable ',
    affectation: 'unite-de-la-dsid',
    contrat: 'cdi' as const,
    debut: '2024-01-01',
  };

  it('l’identité, le poste et la date ; l’affectation ou le contrat selon le document', () => {
    expect(ficheReprise('decision_disponibilite', dossier, '2026-11-02')).toEqual({
      civilite: 'monsieur',
      prenom: 'Moussa',
      nom: 'Sarr',
      poste: 'Comptable',
      demandeLe: '2026-11-02',
    });
    expect(
      ficheReprise('decision_renouvellement_disponibilite', dossier, '2026-11-03'),
    ).toMatchObject({ affectation: 'unite-de-la-dsid', demandeLe: '2026-11-03' });
    expect(ficheReprise('domiciliation_bancaire', dossier, '2026-11-06')).toEqual({
      civilite: 'monsieur',
      prenom: 'Moussa',
      nom: 'Sarr',
      poste: 'Comptable',
      contrat: 'cdi',
      debut: '2024-01-01',
      demandeLe: '2026-11-06',
    });
  });

  it('ce que le dossier ne porte pas reste à saisir', () => {
    const reprise = ficheReprise(
      'decision_renouvellement_disponibilite',
      { ...dossier, civilite: null, poste: '  ', affectation: null },
      '2026-11-03',
    );
    expect(Object.keys(reprise).sort()).toEqual(['demandeLe', 'nom', 'prenom']);
  });
});

describe('le document, généré au titre de la demande', () => {
  it('qui traite lit le dossier de l’agent de la demande, et lui seul', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    const dossier = await generation.dossierPourLaFiche(
      awa.session,
      'decision_disponibilite',
      moussa.employeeId,
      id,
    );
    expect(dossier).toMatchObject({ civilite: 'monsieur', prenom: 'Moussa', nom: 'Sarr' });
    expect(
      await codeOf(() =>
        generation.dossierPourLaFiche(awa.session, 'decision_disponibilite', khady.employeeId, id),
      ),
    ).toBe('auth.forbidden');
    // Sans délégation, la demande ne revient pas à Khady.
    expect(
      await codeOf(() =>
        generation.dossierPourLaFiche(
          khady.session,
          'decision_disponibilite',
          moussa.employeeId,
          id,
        ),
      ),
    ).toBe('demandes.pas_traitant');
    // Sans demande, « Générer des documents » reste à la direction de la DCH.
    expect(
      await codeOf(() =>
        generation.dossierPourLaFiche(awa.session, 'decision_disponibilite', moussa.employeeId),
      ),
    ).toBe('auth.forbidden');
  });

  it('qui traite génère la décision de l’agent, pas celle d’une autre personne', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    const { pdf: decision } = await generation.pdfSansAgent(
      awa.session,
      'decision_disponibilite',
      ficheDeMoussa(),
      id,
    );
    expect(decision.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Aux capitales et aux accents près, c'est le même nom.
    await generation.pdfSansAgent(
      awa.session,
      'decision_disponibilite',
      ficheDeMoussa({ prenom: 'MOUSSA', nom: 'sarr' }),
      id,
    );
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(
          awa.session,
          'decision_disponibilite',
          ficheDeMoussa({ prenom: 'Fatou' }),
          id,
        ),
      ),
    ).toBe('documents.autre_personne');
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(awa.session, 'decision_disponibilite', ficheDeMoussa()),
      ),
    ).toBe('auth.forbidden');
  });

  it('la fiche reprend le dossier et la date de la demande, quoi qu’on y écrive (ADR-0190)', async () => {
    const id = await demande('decision_disponibilite', '2026-11-02');
    // Sans civilité ni poste, avec une demande d'après la prise d'effet : la
    // fiche seule serait refusée. Reprise du dossier et de la lettre, elle passe.
    const { filename } = await generation.pdfSansAgent(
      awa.session,
      'decision_disponibilite',
      ficheDeMoussa({
        civilite: undefined,
        prenom: 'MOUSSA',
        nom: 'sarr',
        poste: '',
        demandeLe: '2026-12-15',
      }),
      id,
    );
    // Le nom du fichier suit le dossier : « Moussa », pas « MOUSSA ».
    expect(filename).toBe('decision-disponibilite-SARR-Moussa.pdf');
  });

  it('qui dirige la DCH passe aussi par la demande ; sans elle, rien ne change', async () => {
    const direction = { ...mariama.session, dirigeLaDCH: true } as SessionUser;
    const id = await demande('decision_disponibilite', '2026-11-02');
    const parLaDemande = await generation.pdfSansAgent(
      direction,
      'decision_disponibilite',
      ficheDeMoussa({ prenom: 'MOUSSA' }),
      id,
    );
    expect(parLaDemande.filename).toBe('decision-disponibilite-SARR-Moussa.pdf');
    // « Générer des documents », sans demande : la fiche telle qu'elle est saisie.
    const libre = await generation.pdfSansAgent(
      direction,
      'decision_disponibilite',
      ficheDeMoussa({ prenom: 'MOUSSA' }),
    );
    expect(libre.filename).toBe('decision-disponibilite-SARR-MOUSSA.pdf');
    await demandes.batchAdvance(direction, { ids: [id], status: 'ready' });
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(direction, 'decision_disponibilite', ficheDeMoussa(), id),
      ),
    ).toBe('documents.deja_traitee');
  });

  it('une demande d’un autre document, ou close, n’ouvre rien', async () => {
    const domiciliation = await demande('domiciliation_bancaire');
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(
          awa.session,
          'decision_disponibilite',
          ficheDeMoussa(),
          domiciliation,
        ),
      ),
    ).toBe('documents.request_not_found');
    const decision = await demande('decision_disponibilite', '2026-11-02');
    await demandes.batchAdvance(awa.session, { ids: [decision], status: 'ready' });
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(awa.session, 'decision_disponibilite', ficheDeMoussa(), decision),
      ),
    ).toBe('documents.deja_traitee');
  });

  it('la domiciliation aussi, et le préremplissage des décisions', async () => {
    const id = await demande('domiciliation_bancaire');
    const fiche: FicheDomiciliation = {
      civilite: 'monsieur',
      prenom: 'Moussa',
      nom: 'Sarr',
      poste: 'Comptable',
      debut: '2024-01-01',
      contrat: 'cdi',
      demandeLe: '2026-11-06',
      banque: 'bnde',
      destinataire: 'directeur_general',
      rib: 'SN0120100103612345678901',
      salaire: 850000,
    };
    const { pdf: lettreALaBanque } = await generation.pdfSansAgent(
      awa.session,
      'domiciliation_bancaire',
      fiche,
      id,
    );
    expect(lettreALaBanque.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const decision = await demande('decision_disponibilite', '2026-11-02');
    expect(
      await generation.preremplissage(awa.session, 'decision_disponibilite', decision),
    ).toMatchObject({ pvDirectionGeneraleLe: expect.any(String) });
  });
});
