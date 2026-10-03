/**
 * L'attestation de travail — ce qu'elle DIT, et sur combien de pages.
 *
 * Un document officiel est relu par un tiers : une banque, un consulat, un
 * bailleur. Une faute d'accord n'y est pas une coquille, c'est un défaut de
 * l'employeur. Ce fichier tient les tournures que le générateur produisait de
 * travers, et la tenue de la page — un pied de page qui déborde faisait sortir
 * l'attestation sur DEUX feuilles, la seconde vide.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import {
  AttestationService,
  CONTRACT_LABELS,
  elide,
  frDate,
  rattachement,
} from '../src/modules/documents/attestation.service';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: AttestationService;
const employes: Record<string, string> = {};

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/** Le texte du PDF, lignes recollées — pdfkit coupe où la justification veut. */
async function texte(employeeId: string): Promise<{ contenu: string; pages: number }> {
  const { pdf } = await service.forEmployee(admin, employeeId);
  const brut = pdf.toString('latin1');
  const pages = (brut.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  // pdfkit encode le texte en hexadécimal dans les flux : on relit le PDF avec
  // pdftotext serait plus simple, mais ajouterait un binaire au projet. On se
  // contente ici du compte de pages et on vérifie les tournures sur les
  // fonctions pures, qui sont le lieu réel des fautes.
  return { contenu: brut, pages };
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new AttestationService(db);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Attestation')`,
    [adminUserId, `att-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `att-${tenantId.slice(0, 8)}`,
  ]);

  const unite = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'service', 'Service Comptabilité')`,
    [unite, tenantId],
  );

  // Une femme au Service (unité masculine), un homme sans unité ni contrat :
  // les deux chemins d'accord se croisent sur ces deux dossiers.
  for (const [cle, prenom, nom, genre, numero, poste, avecUnite, typeContrat] of [
    ['femme', 'Fatou', 'Sall', 'female', 'ATT-001', 'Comptable', true, 'cdd'],
    ['homme', 'Moussa', 'Ndiaye', 'male', 'ATT-002', 'Analyste', false, 'stage'],
  ] as const) {
    const personId = randomUUID();
    const employeeId = randomUUID();
    employes[cle] = employeeId;
    await raw(
      `INSERT INTO persons (id, tenant_id, given_name, family_name, gender, birth_date, birth_place)
       VALUES ($1, $2, $3, $4, $5, '1990-01-01', 'Sénégal')`,
      [personId, tenantId, prenom, nom, genre],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
       VALUES ($1, $2, $3, $4, '2025-02-01')`,
      [employeeId, tenantId, personId, numero],
    );
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1, $2, $3, $4, $5, daterange('2025-02-01', NULL))`,
      [randomUUID(), tenantId, employeeId, avecUnite ? unite : null, poste],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, $4, '2025-02-01')`,
      [randomUUID(), tenantId, employeeId, typeContrat],
    );
  }
});

afterAll(async () => {
  await raw('DELETE FROM contracts WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM assignments WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = $1', [adminUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la page', () => {
  it('tient sur UNE feuille', async () => {
    // Le pied de page écrit sous la marge basse déclenchait le saut de page de
    // pdfkit : l'attestation sortait sur deux feuilles, la seconde vide.
    expect((await texte(employes.femme!)).pages).toBe(1);
    expect((await texte(employes.homme!)).pages).toBe(1);
  });

  it('porte un nom de fichier tiré du matricule', async () => {
    const { filename } = await service.forEmployee(admin, employes.femme!);
    expect(filename).toBe('attestation-travail-ATT-001.pdf');
  });
});

describe('les tournures qui étaient fautives', () => {
  it('accorde l’article du contrat avec son genre', () => {
    // « dans le cadre d'un convention de stage » : l'article était collé
    // devant un libellé dont le générateur ignorait le genre.
    expect(CONTRACT_LABELS.stage).toBe('d’une convention de stage');
    expect(CONTRACT_LABELS.cdi).toBe('d’un contrat à durée indéterminée (CDI)');
    for (const libelle of Object.values(CONTRACT_LABELS)) {
      expect(libelle).toMatch(/^d’(un|une) /);
    }
  });

  it('élide devant une voyelle', () => {
    // « le poste de Analyste » — l'élision ne se saute pas.
    expect(elide('le poste d', 'Analyste')).toBe('le poste d’Analyste');
    expect(elide('le poste d', 'Économiste')).toBe('le poste d’Économiste');
    expect(elide('le poste d', 'Comptable')).toBe('le poste de Comptable');
  });

  it('accorde l’article de l’unité de rattachement', () => {
    // « au sein de la Service Comptabilité » : un féminin posé sur tout.
    expect(rattachement('Service Comptabilité')).toBe(', au Service Comptabilité');
    expect(rattachement('Direction du Capital Humain')).toBe(', à la Direction du Capital Humain');
    expect(rattachement('Département Études')).toBe(', au Département Études');
  });

  it('met une unité inconnue entre parenthèses plutôt que de deviner', () => {
    // La forme qui ne peut pas être fautive, faute de savoir le genre.
    expect(rattachement('Task force Diamniadio')).toBe(' (Task force Diamniadio)');
  });

  it('écrit le premier du mois en ordinal', () => {
    // « le 1 février » : Intl ne connaît pas cet usage, c'est le français.
    expect(frDate('2025-02-01')).toBe('1er février 2025');
    expect(frDate('2025-02-02')).toBe('2 février 2025');
    expect(frDate('2025-01-01')).toBe('1er janvier 2025');
    // Le 21 n'est pas un ordinal : la substitution ne doit viser que le 1 seul.
    expect(frDate('2025-02-21')).toBe('21 février 2025');
  });
});
