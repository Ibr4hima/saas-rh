/**
 * L'attestation de congé, sur le modèle officiel de l'APIX (ADR-0092) : ce
 * qu'elle DIT, avec les dates saisies par la DCH, et quand l'agent reprend.
 *
 * La DCH saisit le premier et le dernier jour du congé, comme on pose un
 * congé ; l'attestation dit la reprise de service, le premier jour ouvré
 * suivant : ni samedi, ni dimanche, ni férié de l'APIX. Un vendredi de fin
 * donne une reprise le lundi ; un 31 décembre, le premier lundi de janvier.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  attestationDeConge,
  textesDeCongePour,
  textesDeLAttestationDeConge,
  type CongeData,
} from '../src/modules/documents/attestation-conge';
import type { TextesDUneAttestation } from '../src/modules/documents/feuille';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let absences: AbsencesService;
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

const textesDe = (employeeId: string, debut: string, fin: string) =>
  enTenant((tx) => textesDeCongePour(tx, absences, employeeId, debut, fin));

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un congé ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<CongeData> = {}): CongeData => ({
  agent: { nom: 'Moussa NDIAYE', genre: 'male' },
  employeeNumber: 'CGE-001',
  depuis: '2023-06-01',
  poste: 'Analyste',
  contrat: 'cdi',
  signataire: { nom: 'Babacar GUEYE', genre: 'male' },
  debut: '2026-09-07',
  reprise: '2026-09-30',
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  absences = new AbsencesService(db);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Conge')`,
    [adminUserId, `cge-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `cge-${tenantId.slice(0, 8)}`,
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
    ['cdi', 'Moussa', 'Ndiaye', 'male', 'active', 'cdi', 'Analyste'],
    ['sans_poste', 'Fatou', 'Sall', 'female', 'active', 'cdd', null],
    ['stage', 'Awa', 'Diop', 'female', 'active', 'stage', 'Stagiaire'],
    ['sorti', 'Ousmane', 'Fall', 'male', 'archived', 'cdi', 'Juriste'],
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
       VALUES ($1, $2, $3, $4, '2023-06-01', $5)`,
      [employeeId, tenantId, personId, `CGE-${cle}`, statut],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, $4, '2023-06-01')`,
      [randomUUID(), tenantId, employeeId, type],
    );
    if (poste) {
      await raw(
        `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
         VALUES ($1, $2, $3, $4, $5, daterange('2023-06-01', NULL))`,
        [randomUUID(), tenantId, employeeId, cle === 'dch' ? uDCH : sommet, poste],
      );
    }
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDCH, employes.dch]);
  // Une fête mobile datée : le lundi 17 août 2026.
  await raw(
    `INSERT INTO holidays (id, tenant_id, year, day, label, fixed_date)
     VALUES ($1, $2, 2026, '2026-08-17', 'Tamkharit', false)`,
    [randomUUID(), tenantId],
  );
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM holidays WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM holiday_seeds WHERE tenant_id = $1', [tenantId]);
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
      attestationDeConge(absences).pdf(tx, employes.cdi!, {
        debut: '2026-09-07',
        fin: '2026-09-29',
      }),
    );
    expect(filename).toBe('attestation-conge-CGE-cdi.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestationDeConge(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE CONGÉ');
  });

  it('les trois paragraphes ; les noms et les dates en gras, la reprise avec son jour', () => {
    const textes = textesDeLAttestationDeConge(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste par la présente que ' +
        'Monsieur Moussa NDIAYE, Analyste, jouira de ses congés administratifs à partir du 7 septembre 2026.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Babacar GUEYE',
      'Monsieur Moussa NDIAYE',
      '7 septembre 2026',
    ]);
    expect(enClair(textes, 1)).toBe('Il reprendra service le mercredi 30 septembre 2026.');
    expect(enGras(textes, 1)).toEqual(['mercredi 30 septembre 2026']);
    expect(enClair(textes, 2)).toBe(
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
    );
  });

  it('accorde avec le genre que porte chaque dossier ; le premier du mois en ordinal', () => {
    const textes = textesDeLAttestationDeConge(
      dossier({
        agent: { nom: 'Fatou SALL', genre: 'female' },
        poste: null,
        signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
        debut: '2026-09-01',
        reprise: '2026-10-01',
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que ' +
        'Madame Fatou SALL jouira de ses congés administratifs à partir du 1er septembre 2026.',
    );
    expect(enClair(textes, 1)).toBe('Elle reprendra service le jeudi 1er octobre 2026.');
  });

  it('sans genre au dossier, les deux formes ; personne à la DCH, un blanc', () => {
    const textes = textesDeLAttestationDeConge(
      dossier({ agent: { nom: 'Ndeye DIALLO', genre: null }, signataire: null }),
      new Date(),
    );
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), …+, Directeur du Capital Humain, /);
    expect(enClair(textes, 1)).toMatch(/^Il\/Elle reprendra service le /);
  });
});

describe('la reprise de service', () => {
  it('le lendemain du dernier jour, un jour de semaine', async () => {
    expect(enClair(await textesDe(employes.cdi!, '2026-09-07', '2026-09-29'), 1)).toBe(
      'Il reprendra service le mercredi 30 septembre 2026.',
    );
  });

  it('après un vendredi, le lundi ; un lundi férié repousse au mardi', async () => {
    expect(enClair(await textesDe(employes.cdi!, '2026-09-14', '2026-09-25'), 1)).toBe(
      'Il reprendra service le lundi 28 septembre 2026.',
    );
    expect(enClair(await textesDe(employes.cdi!, '2026-08-03', '2026-08-14'), 1)).toBe(
      'Il reprendra service le mardi 18 août 2026.',
    );
  });

  it('au passage de l’année, le 1er janvier ne compte pas, même avant qu’on ouvre l’année', async () => {
    expect(enClair(await textesDe(employes.cdi!, '2026-12-14', '2026-12-31'), 1)).toBe(
      'Il reprendra service le lundi 4 janvier 2027.',
    );
  });
});

describe('ce que l’attestation exige', () => {
  it('les deux dates, dans l’ordre', async () => {
    const modele = attestationDeConge(absences);
    for (const saisies of [
      {},
      { debut: '2026-09-07' },
      { fin: '2026-09-29' },
      { debut: '2026-09-29', fin: '2026-09-07' },
      // Le dernier jour suit strictement le premier (ADR-0133).
      { debut: '2026-09-07', fin: '2026-09-07' },
    ]) {
      expect(await codeOf(() => enTenant((tx) => modele.pdf(tx, employes.cdi!, saisies)))).toBe(
        'documents.dates',
      );
    }
  });

  it('un agent en activité, sous contrat de travail', async () => {
    expect(await codeOf(() => textesDe(employes.sorti!, '2026-09-07', '2026-09-29'))).toBe(
      'documents.not_active',
    );
    expect(await codeOf(() => textesDe(employes.stage!, '2026-09-07', '2026-09-29'))).toBe(
      'documents.stage',
    );
  });

  it('sans poste au dossier, pas d’apposition', async () => {
    expect(enClair(await textesDe(employes.sans_poste!, '2026-09-07', '2026-09-29'), 0)).toContain(
      'que Madame Fatou SALL jouira de ses congés administratifs à partir du 7 septembre 2026.',
    );
  });
});
