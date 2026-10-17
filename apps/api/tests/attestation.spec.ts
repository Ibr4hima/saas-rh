/**
 * L'attestation de travail, sur le modèle officiel de l'APIX (ADR-0086) : ce
 * qu'elle DIT, et sur combien de pages.
 *
 * Un document officiel est relu par un tiers : une banque, un consulat, un
 * bailleur. Une faute d'accord n'y est pas une coquille, c'est un défaut de
 * l'employeur. Ce fichier tient les mots du modèle, les accords que porte le
 * dossier de chaque personne nommée, et la tenue de la page : un pied de page
 * qui déborde faisait sortir l'attestation sur DEUX feuilles, la seconde vide.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import {
  AttestationService,
  CONTRACT_LABELS,
  elide,
  frDate,
  textesDeLAttestation,
  type AttestationData,
  type TextesDeLAttestation,
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

/** Un paragraphe en clair : ses passages mis bout à bout, l'espace insécable rendue ordinaire. */
const enClair = (textes: TextesDeLAttestation, i: number) =>
  (textes.paragraphes[i] ?? [])
    .map((p) => p.texte)
    .join('')
    .replace(/ /g, ' ');

/** Ce qui est en gras dans un paragraphe. */
const enGras = (textes: TextesDeLAttestation, i: number) =>
  (textes.paragraphes[i] ?? []).filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '));

const textesDe = (employeeId: string) =>
  db.withTenant({ tenantId, userId: adminUserId }, (tx) => service.textesPour(tx, employeeId));

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
const dossier = (d: Partial<AttestationData> = {}): AttestationData => ({
  agent: { nom: 'Moussa NDIAYE', genre: 'male' },
  employeeNumber: 'EMP-002',
  depuis: '2023-06-01',
  poste: 'Chargé d’études',
  contrat: 'cdi',
  signataire: { nom: 'Cheikh MBAYE', genre: 'male' },
  ...d,
});

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

  const sommet = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [sommet, tenantId],
  );

  // Le sommet de l'organigramme, et qui le dirige et atteste ; trois
  // dossiers : un CDD, un CDI précédé d'un stage, un stage.
  for (const [cle, prenom, nom, genre, numero, poste, contrats] of [
    ['dg', 'Cheikh', 'Mbaye', 'male', 'ATT-000', 'DG', [['cdi', '2020-01-01']]],
    ['cdd', 'Fatou', 'Sall', 'female', 'ATT-001', 'Comptable', [['cdd', '2025-02-01']]],
    [
      'cdi',
      'Moussa',
      'Ndiaye',
      'male',
      'ATT-002',
      'Analyste',
      [
        ['stage', '2024-01-01', '2024-06-30'],
        ['cdi', '2024-07-01'],
      ],
    ],
    ['stage', 'Awa', 'Diop', 'female', 'ATT-003', 'Stagiaire', [['stage', '2026-01-05']]],
  ] as const) {
    const personId = randomUUID();
    const employeeId = randomUUID();
    employes[cle] = employeeId;
    await raw(
      `INSERT INTO persons (id, tenant_id, given_name, family_name, gender) VALUES ($1, $2, $3, $4, $5)`,
      [personId, tenantId, prenom, nom, genre],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
       VALUES ($1, $2, $3, $4, $5)`,
      [employeeId, tenantId, personId, numero, contrats[0][1]],
    );
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1, $2, $3, $4, $5, daterange($6, NULL))`,
      [randomUUID(), tenantId, employeeId, sommet, poste, contrats[0][1]],
    );
    for (const [type, debut, fin] of contrats) {
      await raw(
        `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), tenantId, employeeId, type, debut, fin ?? null],
      );
    }
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [sommet, employes.dg]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
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
    for (const cle of ['cdd', 'cdi']) {
      const { pdf } = await service.forEmployee(admin, employes[cle]!);
      expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
    }
  });

  it('porte un nom de fichier tiré du matricule', async () => {
    const { filename } = await service.forEmployee(admin, employes.cdd!);
    expect(filename).toBe('attestation-travail-ATT-001.pdf');
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestation(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur Général');
    expect(textes.titre).toBe('ATTESTATION DE TRAVAIL');
  });

  it('les trois paragraphes, les noms et la date en gras', () => {
    const textes = textesDeLAttestation(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Cheikh MBAYE, Directeur Général, atteste par la présente que ' +
        'Monsieur Moussa NDIAYE est employé à APIX-SA depuis le 1er juin 2023.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Cheikh MBAYE',
      'Monsieur Moussa NDIAYE',
      '1er juin 2023',
    ]);
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction de Chargé d’études, au titre d’un contrat à durée indéterminée.',
    );
    expect(enClair(textes, 2)).toBe(
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
    );
  });

  it('accorde avec le genre que porte chaque dossier', () => {
    const textes = textesDeLAttestation(
      dossier({
        agent: { nom: 'Fatou SALL', genre: 'female' },
        contrat: 'cdd',
        poste: 'Comptable',
        signataire: { nom: 'Aïssatou FALL', genre: 'female' },
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice Générale');
    expect(enClair(textes, 0)).toBe(
      'Je soussignée, Madame Aïssatou FALL, Directrice Générale, atteste par la présente que ' +
        'Madame Fatou SALL est employée à APIX-SA depuis le 1er juin 2023.',
    );
    expect(enClair(textes, 1)).toBe(
      'Elle occupe actuellement la fonction de Comptable, au titre d’un contrat à durée déterminée.',
    );
  });

  it('sans genre au dossier, les deux formes, comme sur un formulaire', () => {
    const textes = textesDeLAttestation(
      dossier({
        agent: { nom: 'Ndeye DIALLO', genre: null },
        signataire: { nom: 'Cheikh MBAYE', genre: null },
      }),
      new Date(),
    );
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), Monsieur\/Madame Cheikh MBAYE, /);
    expect(enClair(textes, 0)).toContain('Monsieur/Madame Ndeye DIALLO est employé(e) à APIX-SA');
    expect(enClair(textes, 1)).toMatch(/^Il\/Elle occupe actuellement/);
  });

  it('quand personne ne dirige le sommet de l’organigramme, un blanc à remplir à la main', () => {
    const textes = textesDeLAttestation(dossier({ signataire: null }), new Date());
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), …+, Directeur Général, atteste/);
  });

  it('élide devant une voyelle', () => {
    // « la fonction de Analyste » : l'élision ne se saute pas.
    expect(elide('la fonction d', 'Analyste')).toBe('la fonction d’Analyste');
    expect(elide('la fonction d', 'Économiste')).toBe('la fonction d’Économiste');
    expect(elide('la fonction d', 'Comptable')).toBe('la fonction de Comptable');
  });

  it('accorde l’article du contrat avec son genre', () => {
    expect(CONTRACT_LABELS.cdi).toBe('d’un contrat à durée indéterminée');
    expect(CONTRACT_LABELS.cdd).toBe('d’un contrat à durée déterminée');
    for (const libelle of Object.values(CONTRACT_LABELS)) {
      expect(libelle).toMatch(/^d’(un|une) /);
    }
  });

  it('sans poste au dossier, le contrat seul ; sans rien, pas de deuxième paragraphe', () => {
    expect(enClair(textesDeLAttestation(dossier({ poste: null }), new Date()), 1)).toBe(
      'Il est en fonction au titre d’un contrat à durée indéterminée.',
    );
    const sansRien = textesDeLAttestation(dossier({ poste: null, contrat: null }), new Date());
    expect(sansRien.paragraphes).toHaveLength(2);
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

describe('ce que l’attestation lit au dossier', () => {
  it('qui atteste : qui dirige le sommet de l’organigramme', async () => {
    expect(enClair(await textesDe(employes.cdd!), 0)).toMatch(
      /^Je soussigné, Monsieur Cheikh MBAYE, Directeur Général, atteste par la présente que Madame Fatou SALL est employée à APIX-SA depuis le 1er février 2025\.$/,
    );
  });

  it('la date d’entrée : le début de l’ancienneté, pas le stage d’avant', async () => {
    // Entré en stage le 1er janvier 2024, en CDI le 1er juillet : le stage ne
    // donne pas d'ancienneté (ADR-0083).
    const textes = await textesDe(employes.cdi!);
    expect(enClair(textes, 0)).toContain(
      'Monsieur Moussa NDIAYE est employé à APIX-SA depuis le 1er juillet 2024.',
    );
    expect(enClair(textes, 1)).toBe(
      'Il occupe actuellement la fonction d’Analyste, au titre d’un contrat à durée indéterminée.',
    );
  });

  it('le contrat commencé, pas celui enregistré d’avance', async () => {
    const futur = randomUUID();
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, 'cdi', CURRENT_DATE + 30)`,
      [futur, tenantId, employes.cdd],
    );
    try {
      const paragraphe = enClair(await textesDe(employes.cdd!), 1);
      expect(paragraphe).toContain('au titre d’un contrat à durée déterminée');
      expect(paragraphe).not.toContain('indéterminée');
    } finally {
      await raw('DELETE FROM contracts WHERE id = $1', [futur]);
    }
  });

  it('un stage relève de l’attestation de stage', async () => {
    expect(await codeOf(() => service.forEmployee(admin, employes.stage!))).toBe('documents.stage');
  });
});
