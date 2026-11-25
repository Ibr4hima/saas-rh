/**
 * Les attestations du congé de maternité, sur les modèles de l'APIX
 * (ADR-0105) : ce qu'elles DISENT, avec le jour saisi par la DCH.
 *
 * La cessation de paiement et d'activités suspend le salaire au premier jour
 * du congé ; la reprise de service dit le retour, le jour écrit avec son jour
 * de la semaine. Le dossier donne le nom et le poste ; qui atteste dirige
 * la DCH. Un dossier au genre masculin est refusé. Les coquilles des
 * modèles sont corrigées (ADR-0095).
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
  attestationDeCessation,
  attestationDeRepriseDeService,
  textesDeCessationPour,
  textesDeLaCessation,
  textesDeLaRepriseDeService,
  textesDeRepriseDeServicePour,
  type CongeDeMaterniteData,
} from '../src/modules/documents/conge-de-maternite';
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

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un congé de maternité, à varier d'un test à l'autre. */
const dossier = (d: Partial<CongeDeMaterniteData> = {}): CongeDeMaterniteData => ({
  agent: { nom: 'Awa DIOP', genre: 'female' },
  employeeNumber: 'MAT-001',
  depuis: '2018-03-01',
  poste: 'Chargée d’études',
  contrat: 'cdi',
  signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
  jour: '2026-06-01',
  ...d,
});

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Maternite')`,
    [adminUserId, `mat-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `mat-${tenantId.slice(0, 8)}`,
  ]);
  const sommet = randomUUID();
  const uDCH = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [sommet, tenantId],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1, $2, 'direction', 'Direction du Capital Humain', $3, true)`,
    [uDCH, tenantId, sommet],
  );
  for (const [cle, prenom, nom, genre, statut, type, poste] of [
    ['dch', 'Babacar', 'Gueye', 'male', 'active', 'cdi', 'Directeur de la DCH'],
    ['titulaire', 'Awa', 'Diop', 'female', 'active', 'cdi', 'Chargée d’études'],
    ['sans_poste', 'Fatou', 'Sall', 'female', 'active', 'cdd', null],
    ['masculin', 'Moussa', 'Ndiaye', 'male', 'active', 'cdi', 'Analyste'],
    ['sortie', 'Aminata', 'Fall', 'female', 'archived', 'cdi', 'Juriste'],
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
      [employeeId, tenantId, personId, `MAT-${cle}`, statut],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, $4, '2018-03-01')`,
      [randomUUID(), tenantId, employeeId, type],
    );
    if (poste) {
      await raw(
        `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
         VALUES ($1, $2, $3, $4, $5, daterange('2018-03-01', NULL))`,
        [randomUUID(), tenantId, employeeId, cle === 'dch' ? uDCH : sommet, poste],
      );
    }
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

describe('la cessation de paiement et d’activités', () => {
  it('une date à saisir : le premier jour du congé de maternité', () => {
    expect(saisiesDe('attestation_cessation')).toEqual(['debut']);
  });

  it('l’en-tête, le timbre, le titre sur deux lignes accentué, la pièce jointe', () => {
    const textes = textesDeLaCessation(dossier(), new Date('2026-10-18T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 18 octobre 2026');
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE CESSATION DE PAIEMENT ET\nD’ACTIVITÉS');
    expect(textes.pieceJointe).toBe('Certificat médical');
  });

  it('le salaire suspendu à compter du jour saisi ; les noms et le jour en gras', () => {
    const textes = textesDeLaCessation(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente ' +
        'que le salaire de Madame Awa DIOP, Chargée d’études, est suspendu à compter du ' +
        '1er juin 2026, pour jouissance de ses congés de maternité.',
    );
    expect(enGras(textes, 0)).toEqual(['Madame Mariama CISSÉ', 'Madame Awa DIOP', '1er juin 2026']);
    expect(enClair(textes, 1)).toBe(
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
    );
    expect(enClair(textesDeLaCessation(dossier({ poste: null }), new Date()), 0)).toMatch(
      /que le salaire de Madame Awa DIOP est suspendu à compter du/,
    );
  });

  it('une page, nommée d’après le matricule ; le dossier et qui atteste viennent de l’application', async () => {
    const { filename, pdf } = await enTenant((tx) =>
      attestationDeCessation.pdf(tx, employes.titulaire!, { debut: '2026-06-01' }),
    );
    expect(filename).toBe('attestation-cessation-MAT-titulaire.pdf');
    expect(pages(pdf)).toBe(1);
    const textes = await enTenant((tx) =>
      textesDeCessationPour(tx, employes.titulaire!, '2026-06-01'),
    );
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(enClair(textes, 0)).toMatch(
      /^Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste par la présente que le salaire de Madame Awa DIOP, Chargée d’études, est suspendu/,
    );
  });
});

describe('la reprise de service', () => {
  it('une date à saisir : le jour de la reprise', () => {
    expect(saisiesDe('attestation_reprise_service')).toEqual(['reprise']);
  });

  it('le titre ; la reprise écrite avec son jour de la semaine, en gras', () => {
    const textes = textesDeLaRepriseDeService(
      dossier({ jour: '2026-10-05' }),
      new Date('2026-10-18T10:00:00'),
    );
    expect(textes.titre).toBe('ATTESTATION DE REPRISE DE SERVICE');
    expect(textes.pieceJointe).toBeUndefined();
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente ' +
        'que Madame Awa DIOP, Chargée d’études, a repris service le lundi 5 octobre 2026, suite à ' +
        'ses congés de maternité.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Madame Mariama CISSÉ',
      'Madame Awa DIOP',
      'lundi 5 octobre 2026',
    ]);
    // Le premier du mois, ordinal ; sans poste, sans incise.
    expect(
      enClair(
        textesDeLaRepriseDeService(dossier({ jour: '2026-10-01', poste: null }), new Date()),
        0,
      ),
    ).toMatch(/que Madame Awa DIOP a repris service le jeudi 1er octobre 2026,/);
  });

  it('qui atteste, au genre de son dossier ; la place vacante laisse des pointillés', () => {
    expect(
      enClair(textesDeLaRepriseDeService(dossier({ signataire: null }), new Date()), 0),
    ).toMatch(/^Je soussigné\(e\), …+, Directeur du Capital Humain, atteste/);
  });

  it('une page, nommée d’après le matricule', async () => {
    const { filename, pdf } = await enTenant((tx) =>
      attestationDeRepriseDeService.pdf(tx, employes.titulaire!, { reprise: '2026-10-05' }),
    );
    expect(filename).toBe('attestation-reprise-service-MAT-titulaire.pdf');
    expect(pages(pdf)).toBe(1);
    const sansPoste = await enTenant((tx) =>
      textesDeRepriseDeServicePour(tx, employes.sans_poste!, '2026-10-05'),
    );
    expect(enClair(sansPoste, 0)).toMatch(/que Madame Fatou SALL a repris service le lundi/);
  });
});

describe('les refus', () => {
  it('sans le jour, refusée en le disant ; un dossier au genre masculin, inactif ou en stage, refusé', async () => {
    const code = (fn: (tx: Tx) => Promise<unknown>) => codeOf(() => enTenant(fn));
    expect(await code((tx) => attestationDeCessation.pdf(tx, employes.titulaire!, {}))).toBe(
      'documents.dates',
    );
    expect(await code((tx) => attestationDeRepriseDeService.pdf(tx, employes.titulaire!, {}))).toBe(
      'documents.dates',
    );
    expect(
      await code((tx) =>
        attestationDeCessation.pdf(tx, employes.masculin!, { debut: '2026-06-01' }),
      ),
    ).toBe('documents.maternite');
    expect(
      await code((tx) =>
        attestationDeRepriseDeService.pdf(tx, employes.masculin!, { reprise: '2026-10-05' }),
      ),
    ).toBe('documents.maternite');
    expect(
      await code((tx) => attestationDeCessation.pdf(tx, employes.sortie!, { debut: '2026-06-01' })),
    ).toBe('documents.not_active');
  });
});
