/**
 * L'attestation de reprise de service après disponibilité, sur le modèle de
 * l'APIX (ADR-0104) : ce qu'elle DIT, avec les dates saisies par la DCH.
 *
 * L'agent, son poste et son unité viennent du dossier ; qui dirige l'unité a
 * un poste qui la nomme déjà. La DCH saisit le premier et le dernier jour de
 * la disponibilité, puis le jour de la reprise.
 * Qui atteste dirige la DCH. Les coquilles du modèle sont corrigées
 * (ADR-0095).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saisiesDe } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  attestationDeReprise,
  textesDeLAttestationDeReprise,
  textesDeReprisePour,
  type RepriseData,
} from '../src/modules/documents/attestation-reprise';
import type { TextesDUneAttestation } from '../src/modules/documents/feuille';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
const employes: Record<string, string> = {};

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/** Un paragraphe en clair : ses passages mis bout à bout, l'espace insécable rendue ordinaire. */
const enClair = (textes: TextesDUneAttestation, i: number) =>
  (textes.paragraphes[i] ?? [])
    .map((p) => p.texte)
    .join('')
    .replace(/ /g, ' ');

/** Ce qui est en gras dans un paragraphe. */
const enGras = (textes: TextesDUneAttestation, i: number) =>
  (textes.paragraphes[i] ?? []).filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '));

const enTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.withTenant({ tenantId, userId: adminUserId }, fn);

const DATES = { debut: '2026-01-02', fin: '2026-07-01', reprise: '2026-07-02' };

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'une reprise ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<RepriseData> = {}): RepriseData => ({
  agent: { nom: 'Awa DIOP', genre: 'female' },
  employeeNumber: 'REP-001',
  depuis: '2018-03-01',
  poste: 'Chargée d’études',
  contrat: 'cdi',
  affectation: {
    unite: { nom: 'Direction de l’Environnement des Affaires', type: 'direction' },
    responsable: false,
  },
  signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
  ...DATES,
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Reprise')`,
    [adminUserId, `rep-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `rep-${tenantId.slice(0, 8)}`,
  ]);
  const sommet = randomUUID();
  const uDCH = randomUUID();
  const uDEA = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [sommet, tenantId],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1, $2, 'direction', 'Direction du Capital Humain', $3, true)`,
    [uDCH, tenantId, sommet],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
     VALUES ($1, $2, 'direction', 'Direction de l’Environnement des Affaires', $3)`,
    [uDEA, tenantId, sommet],
  );

  for (const [cle, prenom, nom, genre, statut, type, poste, unite] of [
    ['dch', 'Mariama', 'Cissé', 'female', 'active', 'cdi', 'Directrice de la DCH', uDCH],
    ['agent', 'Awa', 'Diop', 'female', 'active', 'cdi', 'Chargée d’études', uDEA],
    ['sans_unite', 'Moussa', 'Ndiaye', 'male', 'active', 'cdi', 'Analyste', null],
    ['stage', 'Fatou', 'Sall', 'female', 'active', 'stage', 'Stagiaire', uDEA],
    ['sorti', 'Ousmane', 'Fall', 'male', 'archived', 'cdi', 'Juriste', uDEA],
  ] as const) {
    const personId = randomUUID();
    const employeeId = randomUUID();
    employes[cle] = employeeId;
    await raw(
      `INSERT INTO persons (id, tenant_id, given_name, family_name, gender) VALUES ($1, $2, $3, $4, $5)`,
      [personId, tenantId, prenom, nom, genre],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
       VALUES ($1, $2, $3, $4, '2018-03-01', $5)`,
      [employeeId, tenantId, personId, `REP-${cle}`, statut],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, $4, '2018-03-01')`,
      [randomUUID(), tenantId, employeeId, type],
    );
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity, responsable)
       VALUES ($1, $2, $3, $4, $5, daterange('2018-03-01', NULL), $6)`,
      [randomUUID(), tenantId, employeeId, unite, poste, cle === 'dch'],
    );
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDCH, employes.dch]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM contracts WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM assignments WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1 AND parent_id IS NOT NULL', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = $1', [adminUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la page', () => {
  it('trois dates à saisir : le début et la fin de la disponibilité, la reprise', () => {
    expect(saisiesDe('attestation_reprise_disponibilite')).toEqual(['debut', 'fin', 'reprise']);
  });

  it('tient sur UNE feuille, et porte un nom de fichier tiré du matricule', async () => {
    const { filename, pdf } = await enTenant((tx) =>
      attestationDeReprise.pdf(tx, employes.agent!, DATES),
    );
    expect(filename).toBe('attestation-reprise-disponibilite-REP-agent.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestationDeReprise(dossier(), new Date('2026-10-18T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 18 octobre 2026');
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE REPRISE DE SERVICE');
  });

  it('le paragraphe, coquilles corrigées ; les noms et le jour de la reprise en gras', () => {
    const textes = textesDeLAttestationDeReprise(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente ' +
        'que Madame Awa DIOP, Chargée d’études à la Direction de l’Environnement des Affaires, mise ' +
        'en disponibilité pour la période allant du 2 janvier 2026 au 1er juillet 2026, a repris ' +
        'service le 2 juillet 2026.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Madame Mariama CISSÉ',
      'Madame Awa DIOP',
      '2 juillet 2026',
    ]);
    expect(enClair(textes, 1)).toBe(
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
    );
  });

  it('au masculin ; sans unité, ou à sa tête, le poste seul ; sans poste, rien', () => {
    const textes = (d: Partial<RepriseData>) =>
      enClair(textesDeLAttestationDeReprise(dossier(d), new Date()), 0);
    expect(
      textes({
        agent: { nom: 'Moussa NDIAYE', genre: 'male' },
        poste: 'Analyste',
        affectation: null,
      }),
    ).toMatch(
      /que Monsieur Moussa NDIAYE, Analyste, mis en disponibilité pour la période allant du /,
    );
    expect(textes({ poste: null, affectation: null })).toMatch(
      /que Madame Awa DIOP, mise en disponibilité pour la période/,
    );
    expect(
      textes({
        affectation: {
          unite: { nom: 'Service Comptabilité', type: 'service' },
          responsable: false,
        },
      }),
    ).toMatch(/Chargée d’études au Service Comptabilité, mise en disponibilité/);
    expect(
      textes({
        poste: 'Cheffe du département Études',
        affectation: {
          unite: { nom: 'Département Études', type: 'department' },
          responsable: true,
        },
      }),
    ).toMatch(/que Madame Awa DIOP, Cheffe du département Études, mise en disponibilité/);
  });

  it('qui atteste, au genre de son dossier ; la place vacante laisse des pointillés', () => {
    const signee = (signataire: RepriseData['signataire']) =>
      textesDeLAttestationDeReprise(dossier({ signataire }), new Date());
    const parUnDirecteur = signee({ nom: 'Babacar GUEYE', genre: 'male' });
    expect(parUnDirecteur.timbre).toBe('Le Directeur du Capital Humain');
    expect(enClair(parUnDirecteur, 0)).toMatch(
      /^Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste/,
    );
    expect(enClair(signee(null), 0)).toMatch(
      /^Je soussigné\(e\), …+, Directeur du Capital Humain, atteste/,
    );
  });
});

describe('le dossier et les dates', () => {
  it('l’agent, son poste et son unité viennent du dossier ; qui atteste, de l’organigramme', async () => {
    const textes = await enTenant((tx) => textesDeReprisePour(tx, employes.agent!, DATES));
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente ' +
        'que Madame Awa DIOP, Chargée d’études à la Direction de l’Environnement des Affaires, mise ' +
        'en disponibilité pour la période allant du 2 janvier 2026 au 1er juillet 2026, a repris ' +
        'service le 2 juillet 2026.',
    );
    const sansUnite = await enTenant((tx) => textesDeReprisePour(tx, employes.sans_unite!, DATES));
    expect(enClair(sansUnite, 0)).toMatch(
      /que Monsieur Moussa NDIAYE, Analyste, mis en disponibilité/,
    );
    const aLaTete = await enTenant((tx) => textesDeReprisePour(tx, employes.dch!, DATES));
    expect(enClair(aLaTete, 0)).toMatch(
      /que Madame Mariama CISSÉ, Directrice de la DCH, mise en disponibilité/,
    );
  });

  it('les trois dates, dans l’ordre : le dernier jour après le premier, la reprise pas avant le dernier (ADR-0133)', async () => {
    const code = (saisies: { debut?: string; fin?: string; reprise?: string }) =>
      codeOf(() => enTenant((tx) => attestationDeReprise.pdf(tx, employes.agent!, saisies)));
    expect(await code({ debut: DATES.debut, fin: DATES.fin })).toBe('documents.dates');
    expect(await code({ ...DATES, fin: '2025-12-31' })).toBe('documents.dates');
    expect(await code({ ...DATES, fin: DATES.debut })).toBe('documents.dates');
    expect(await code({ ...DATES, reprise: DATES.debut })).toBe('documents.dates');
    expect(await code({ ...DATES, reprise: '2026-05-15' })).toBe('documents.dates');
    expect(await code({ ...DATES, reprise: DATES.fin })).toBe('AUCUNE ERREUR');
  });

  it('un dossier inactif ou un stage est refusé, en le disant', async () => {
    expect(
      await codeOf(() => enTenant((tx) => attestationDeReprise.pdf(tx, employes.sorti!, DATES))),
    ).toBe('documents.not_active');
    expect(
      await codeOf(() => enTenant((tx) => attestationDeReprise.pdf(tx, employes.stage!, DATES))),
    ).toBe('documents.stage');
  });
});
