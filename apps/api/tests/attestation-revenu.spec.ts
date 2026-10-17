/**
 * L'attestation de revenu, sur le modèle officiel de l'APIX (ADR-0087) : ce
 * qu'elle DIT, avec le salaire saisi par la DCH, et sur combien de pages.
 *
 * Elle part chez une banque ou un bailleur, qui relit le montant : en
 * chiffres, puis en lettres, les deux d'accord. Qui atteste dirige la DCH ;
 * les accords suivent le dossier de chaque personne nommée.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  attestationDeRevenu,
  textesDeLAttestationDeRevenu,
  textesDeRevenuPour,
  type RevenuData,
} from '../src/modules/documents/attestation-revenu';
import type { TextesDUneAttestation } from '../src/modules/documents/feuille';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
const employes: Record<string, string> = {};
let uDCH: string;

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

const textesDe = (employeeId: string, salaire = 250_000) =>
  enTenant((tx) => textesDeRevenuPour(tx, employeeId, salaire));

const pdfDe = (employeeId: string, salaire?: number) =>
  enTenant((tx) => attestationDeRevenu.pdf(tx, employeeId, { salaire }));

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un dossier ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<RevenuData> = {}): RevenuData => ({
  agent: { nom: 'Moussa NDIAYE', genre: 'male' },
  employeeNumber: 'EMP-002',
  depuis: '2023-06-01',
  poste: 'Chargé d’études',
  contrat: 'cdi',
  signataire: { nom: 'Babacar GUEYE', genre: 'male' },
  salaire: 250_000,
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Revenu')`,
    [adminUserId, `rev-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `rev-${tenantId.slice(0, 8)}`,
  ]);

  const sommet = randomUUID();
  uDCH = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [sommet, tenantId],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1, $2, 'direction', 'Direction du Capital Humain', $3, true)`,
    [uDCH, tenantId, sommet],
  );

  // Qui dirige la DCH et atteste ; trois dossiers : un CDD, un CDI précédé
  // d'un stage, un stage ; et un dossier sorti.
  for (const [cle, prenom, nom, genre, numero, poste, statut, contrats] of [
    ['dch', 'Mariama', 'Cissé', 'female', 'REV-000', 'DCH', 'active', [['cdi', '2019-01-01']]],
    ['cdd', 'Fatou', 'Sall', 'female', 'REV-001', 'Comptable', 'active', [['cdd', '2025-02-01']]],
    [
      'cdi',
      'Moussa',
      'Ndiaye',
      'male',
      'REV-002',
      'Analyste',
      'active',
      [
        ['stage', '2024-01-01', '2024-06-30'],
        ['cdi', '2024-07-01'],
      ],
    ],
    ['stage', 'Awa', 'Diop', 'female', 'REV-003', 'Stage', 'active', [['stage', '2026-01-05']]],
    ['sorti', 'Ousmane', 'Fall', 'male', 'REV-004', 'Juriste', 'archived', [['cdi', '2020-01-01']]],
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
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [employeeId, tenantId, personId, numero, contrats[0][1], statut],
    );
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1, $2, $3, $4, $5, daterange($6, NULL))`,
      [randomUUID(), tenantId, employeeId, cle === 'dch' ? uDCH : sommet, poste, contrats[0][1]],
    );
    for (const [type, debut, fin] of contrats) {
      await raw(
        `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), tenantId, employeeId, type, debut, fin ?? null],
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
  it('tient sur UNE feuille, même au plus long des montants', async () => {
    for (const salaire of [250_000, 977_777_777]) {
      const { pdf } = await pdfDe(employes.cdi!, salaire);
      expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
    }
  });

  it('porte un nom de fichier tiré du matricule', async () => {
    const { filename } = await pdfDe(employes.cdd!, 250_000);
    expect(filename).toBe('attestation-revenu-REV-001.pdf');
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestationDeRevenu(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE REVENU');
  });

  it('les trois paragraphes ; les noms et la date en gras, le montant en chiffres puis en lettres', () => {
    const textes = textesDeLAttestationDeRevenu(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste par la présente que ' +
        'Monsieur Moussa NDIAYE est employé à APIX-S.A. depuis le 1er juin 2023.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Babacar GUEYE',
      'Monsieur Moussa NDIAYE',
      '1er juin 2023',
    ]);
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction de Chargé d’études et perçoit un salaire net mensuel ' +
        'de 250 000 (deux cent cinquante mille) francs CFA.',
    );
    expect(enGras(textes, 1)).toEqual([]);
    expect(enClair(textes, 2)).toBe(
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
    );
  });

  it('les chiffres et l’unité d’un seul tenant', () => {
    const [passage] = textesDeLAttestationDeRevenu(dossier({ salaire: 1_250_000 }), new Date())
      .paragraphes[1]!;
    expect(passage!.texte).toContain('de 1 250 000 (un million deux cent cinquante mille)');
    expect(passage!.texte).toMatch(/francs CFA\.$/);
  });

  it('accorde avec le genre que porte chaque dossier, timbre compris', () => {
    const textes = textesDeLAttestationDeRevenu(
      dossier({
        agent: { nom: 'Fatou SALL', genre: 'female' },
        poste: 'Comptable',
        signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que ' +
        'Madame Fatou SALL est employée à APIX-S.A. depuis le 1er juin 2023.',
    );
    expect(enClair(textes, 1)).toMatch(
      /^Elle occupe actuellement la fonction de Comptable et perçoit /,
    );
  });

  it('sans genre au dossier, les deux formes, comme sur un formulaire', () => {
    const textes = textesDeLAttestationDeRevenu(
      dossier({ agent: { nom: 'Ndeye DIALLO', genre: null }, signataire: null }),
      new Date(),
    );
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(enClair(textes, 0)).toMatch(
      /^Je soussigné\(e\), …+, Directeur du Capital Humain, atteste/,
    );
    expect(enClair(textes, 0)).toContain('Monsieur/Madame Ndeye DIALLO est employé(e) à APIX-S.A.');
    expect(enClair(textes, 1)).toMatch(/^Il\/Elle occupe actuellement/);
  });

  it('sans poste au dossier, le salaire seul', () => {
    expect(enClair(textesDeLAttestationDeRevenu(dossier({ poste: null }), new Date()), 1)).toBe(
      'Il perçoit un salaire net mensuel de 250 000 (deux cent cinquante mille) francs CFA.',
    );
  });
});

describe('ce que l’attestation lit au dossier', () => {
  it('qui atteste : qui dirige la DCH', async () => {
    const textes = await textesDe(employes.cdd!);
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que ' +
        'Madame Fatou SALL est employée à APIX-S.A. depuis le 1er février 2025.',
    );
  });

  it('quand personne ne dirige la DCH, un blanc à remplir à la main', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uDCH]);
    try {
      expect(enClair(await textesDe(employes.cdd!), 0)).toMatch(
        /^Je soussigné\(e\), …+, Directeur/,
      );
    } finally {
      await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
        uDCH,
        employes.dch,
      ]);
    }
  });

  it('la date d’entrée : le début de l’ancienneté, pas le stage d’avant ; la fonction et le salaire saisi', async () => {
    const textes = await textesDe(employes.cdi!, 487_381);
    expect(enClair(textes, 0)).toContain(
      'Monsieur Moussa NDIAYE est employé à APIX-S.A. depuis le 1er juillet 2024.',
    );
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction d’Analyste et perçoit un salaire net mensuel de ' +
        '487 381 (quatre cent quatre-vingt-sept mille trois cent quatre-vingt-un) francs CFA.',
    );
  });

  it('sans salaire, pas d’attestation', async () => {
    expect(await codeOf(() => pdfDe(employes.cdd!))).toBe('documents.salaire');
  });

  it('un stage relève de l’attestation de stage ; un dossier inactif, du certificat de travail', async () => {
    const stage = await pdfDe(employes.stage!, 100_000).catch((e: ProblemException) => e);
    expect(stage).toBeInstanceOf(ProblemException);
    expect((stage as ProblemException).problem).toMatchObject({
      code: 'documents.stage',
      title: 'Attestation de revenu réservée aux contrats de travail',
    });
    expect(await codeOf(() => pdfDe(employes.sorti!, 100_000))).toBe('documents.not_active');
  });
});
