/**
 * L'attestation de départ à la retraite, sur le modèle officiel de l'APIX
 * (ADR-0093) : ce qu'elle DIT, avec le jour du départ saisi par la DCH.
 *
 * Elle se délivre avant le départ : l'agent est en activité. Elle cite sa
 * date d'entrée, le début de l'ancienneté (ADR-0083), sa fonction, et le jour
 * où l'agent fera valoir ses droits à la retraite. Qui atteste dirige la DCH.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  attestationDeRetraite,
  textesDeLAttestationDeRetraite,
  textesDeRetraitePour,
  type RetraiteData,
} from '../src/modules/documents/attestation-retraite';
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

const textesDe = (employeeId: string, depart = '2027-03-31') =>
  enTenant((tx) => textesDeRetraitePour(tx, employeeId, depart));

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un départ ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<RetraiteData> = {}): RetraiteData => ({
  agent: { nom: 'Ousmane FALL', genre: 'male' },
  employeeNumber: 'RET-001',
  depuis: '1992-04-01',
  poste: 'Directeur Financier et Comptable',
  contrat: 'cdi',
  signataire: { nom: 'Babacar GUEYE', genre: 'male' },
  depart: '2027-03-31',
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Retraite')`,
    [adminUserId, `ret-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `ret-${tenantId.slice(0, 8)}`,
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
    ['dch', 'Mariama', 'Cissé', 'female', 'active', 'cdi', 'DCH'],
    ['cdi', 'Ousmane', 'Fall', 'male', 'active', 'cdi', 'Économiste'],
    ['sans_poste', 'Aminata', 'Ba', 'female', 'active', 'cdi', null],
    ['stage', 'Awa', 'Diop', 'female', 'active', 'stage', 'Stagiaire'],
    ['sorti', 'Ibrahima', 'Sy', 'male', 'archived', 'cdi', 'Juriste'],
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
       VALUES ($1, $2, $3, $4, '1992-04-01', $5)`,
      [employeeId, tenantId, personId, `RET-${cle}`, statut],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, $4, '1992-04-01')`,
      [randomUUID(), tenantId, employeeId, type],
    );
    if (poste) {
      await raw(
        `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
         VALUES ($1, $2, $3, $4, $5, daterange('1992-04-01', NULL))`,
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

describe('la page', () => {
  it('tient sur UNE feuille, et porte un nom de fichier tiré du matricule', async () => {
    const { filename, pdf } = await enTenant((tx) =>
      attestationDeRetraite.pdf(tx, employes.cdi!, { depart: '2027-03-31' }),
    );
    expect(filename).toBe('attestation-depart-retraite-RET-cdi.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestationDeRetraite(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE DÉPART À LA RETRAITE');
  });

  it('les trois paragraphes ; les noms et les dates en gras, pas la fonction', () => {
    const textes = textesDeLAttestationDeRetraite(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste par la présente que ' +
        'Monsieur Ousmane FALL est employé à APIX-SA depuis le 1er avril 1992.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Babacar GUEYE',
      'Monsieur Ousmane FALL',
      '1er avril 1992',
    ]);
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction de Directeur Financier et Comptable, et fera valoir ses ' +
        'droits à la retraite le 31 mars 2027.',
    );
    expect(enGras(textes, 1)).toEqual(['31 mars 2027']);
    expect(enClair(textes, 2)).toBe(
      'En foi de quoi, la présente attestation est délivrée à l’intéressé pour servir et valoir ce que de droit.',
    );
  });

  it('accorde avec le genre que porte chaque dossier, timbre compris', () => {
    const textes = textesDeLAttestationDeRetraite(
      dossier({
        agent: { nom: 'Aminata BA', genre: 'female' },
        poste: 'Assistante de direction',
        signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(enClair(textes, 0)).toMatch(
      /^Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que Madame Aminata BA est employée à APIX-SA/,
    );
    expect(enClair(textes, 1)).toMatch(/^Elle occupe actuellement la fonction d’Assistante /);
    expect(enClair(textes, 2)).toContain('délivrée à l’intéressée pour servir');
  });

  it('sans genre au dossier, les deux formes ; personne à la DCH, un blanc', () => {
    const textes = textesDeLAttestationDeRetraite(
      dossier({ agent: { nom: 'Ndeye DIALLO', genre: null }, signataire: null }),
      new Date(),
    );
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), …+, Directeur du Capital Humain, /);
    expect(enClair(textes, 0)).toContain('Monsieur/Madame Ndeye DIALLO est employé(e) à APIX-SA');
    expect(enClair(textes, 1)).toMatch(/^Il\/Elle occupe actuellement/);
    expect(enClair(textes, 2)).toContain('délivrée à l’intéressé(e) pour servir');
  });
});

describe('ce que l’attestation lit au dossier, et ce qu’elle exige', () => {
  it('la date d’entrée et la fonction du dossier, le jour du départ saisi', async () => {
    const textes = await textesDe(employes.cdi!, '2027-06-30');
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que ' +
        'Monsieur Ousmane FALL est employé à APIX-SA depuis le 1er avril 1992.',
    );
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction d’Économiste, et fera valoir ses droits à la retraite le 30 juin 2027.',
    );
  });

  it('sans fonction au dossier, le départ seul', async () => {
    expect(enClair(await textesDe(employes.sans_poste!), 1)).toBe(
      'Elle fera valoir ses droits à la retraite le 31 mars 2027.',
    );
  });

  it('sans date de départ, pas d’attestation', async () => {
    expect(
      await codeOf(() => enTenant((tx) => attestationDeRetraite.pdf(tx, employes.cdi!, {}))),
    ).toBe('documents.depart');
  });

  it('un agent en activité, sous contrat de travail', async () => {
    expect(await codeOf(() => textesDe(employes.sorti!))).toBe('documents.not_active');
    expect(await codeOf(() => textesDe(employes.stage!))).toBe('documents.stage');
  });
});
