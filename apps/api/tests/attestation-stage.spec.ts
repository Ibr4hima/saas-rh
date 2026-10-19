/**
 * L'attestation de stage, sur le modèle officiel de l'APIX (ADR-0089) : ce
 * qu'elle DIT, et quel stage elle cite.
 *
 * Elle se délivre le plus souvent après le stage, au départ de l'agent ou
 * après son embauche. Elle cite un stage du dossier, du premier jour (un
 * renouvellement dans le mois ne fait pas un nouveau stage) au dernier (la
 * fin du contrat, ou le départ s'il vient avant), et le poste occupé pendant
 * le stage. À plusieurs stages, la DCH choisit lequel (ADR-0132).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  attestationDeStage,
  textesDeLAttestationDeStage,
  textesDeStagePour,
  type StageData,
} from '../src/modules/documents/attestation-stage';
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

const textesDe = (employeeId: string, debut?: string) =>
  enTenant((tx) => textesDeStagePour(tx, employeeId, debut));

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un stage ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<StageData> = {}): StageData => ({
  agent: { nom: 'Awa DIOP', genre: 'female' },
  employeeNumber: 'STG-001',
  debut: '2026-01-05',
  fin: '2026-06-30',
  poste: 'Stagiaire juriste',
  signataire: { nom: 'Babacar GUEYE', genre: 'male' },
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Stage')`,
    [adminUserId, `stg-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `stg-${tenantId.slice(0, 8)}`,
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

  /** Un dossier : ses contrats [type, début, fin], ses affectations [poste, début, fin], son départ. */
  async function creer(
    cle: string,
    [prenom, nom, genre]: [string, string, string | null],
    {
      statut = 'active',
      contrats,
      affectations = [],
      depart,
      postePrevu = null,
    }: {
      statut?: string;
      contrats: [string, string, string | null][];
      affectations?: [string, string, string | null][];
      depart?: string;
      postePrevu?: string | null;
    },
  ) {
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
      [employeeId, tenantId, personId, `STG-${cle}`, contrats[0]![1], statut],
    );
    for (const [type, debut, fin] of contrats) {
      await raw(
        `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date, planned_position_title)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), tenantId, employeeId, type, debut, fin, postePrevu],
      );
    }
    for (const [poste, debut, fin] of affectations) {
      await raw(
        `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
         VALUES ($1, $2, $3, $4, $5, daterange($6, $7))`,
        [randomUUID(), tenantId, employeeId, cle === 'dch' ? uDCH : sommet, poste, debut, fin],
      );
    }
    if (depart) {
      await raw(
        `INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif)
         VALUES ($1, $2, $3, 'fin_de_contrat')`,
        [tenantId, employeeId, depart],
      );
    }
  }

  await creer('dch', ['Mariama', 'Cissé', 'female'], {
    contrats: [['cdi', '2019-01-01', null]],
    affectations: [['DCH', '2019-01-01', null]],
  });
  // Stage fini, dossier sorti.
  await creer('fini', ['Awa', 'Diop', 'female'], {
    statut: 'archived',
    contrats: [['stage', '2026-01-05', '2026-06-30']],
    affectations: [['Stagiaire juriste', '2026-01-05', '2026-07-01']],
    depart: '2026-06-30',
  });
  // Renouvelé sans interruption : c'est le même stage.
  await creer('renouvele', ['Ousmane', 'Fall', 'male'], {
    statut: 'archived',
    contrats: [
      ['stage', '2025-01-06', '2025-03-31'],
      ['stage', '2025-04-01', '2025-06-30'],
    ],
    affectations: [['Stagiaire comptable', '2025-01-06', '2025-07-01']],
    depart: '2025-06-30',
  });
  // Un départ avant la fin prévue ; sans genre au dossier.
  await creer('depart', ['Ndeye', 'Diallo', null], {
    statut: 'archived',
    contrats: [['stage', '2026-02-02', '2026-07-31']],
    affectations: [['Stagiaire RH', '2026-02-02', '2026-05-16']],
    depart: '2026-05-15',
  });
  // Une embauche après le stage.
  await creer('embauche', ['Moussa', 'Ndiaye', 'male'], {
    contrats: [
      ['stage', '2024-01-01', '2024-06-30'],
      ['cdi', '2024-07-01', null],
    ],
    affectations: [
      ['Stagiaire analyste', '2024-01-01', '2024-07-01'],
      ['Analyste', '2024-07-01', null],
    ],
  });
  // En stage, sans fin fixée ni affectation.
  await creer('encours', ['Fatou', 'Sall', 'female'], {
    contrats: [['stage', '2026-09-01', null]],
    postePrevu: 'Assistante RH',
  });
  // Deux stages, en 2012 puis en 2015, puis l'embauche.
  await creer('deux', ['Khady', 'Faye', 'female'], {
    contrats: [
      ['stage', '2012-03-01', '2012-08-31'],
      ['stage', '2015-01-05', '2015-05-04'],
      ['cdi', '2016-01-04', null],
    ],
    affectations: [
      ['Stagiaire juriste', '2012-03-01', '2012-09-01'],
      ['Stagiaire comptable', '2015-01-05', '2015-05-05'],
      ['Comptable', '2016-01-04', null],
    ],
  });
  // Jamais en stage.
  await creer('cdi', ['Babacar', 'Gueye', 'male'], {
    contrats: [['cdi', '2020-01-01', null]],
    affectations: [['Juriste', '2020-01-01', null]],
  });
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDCH, employes.dch]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM periodes_inactivite WHERE tenant_id = $1', [tenantId]);
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
      attestationDeStage.pdf(tx, employes.fini!, {}),
    );
    expect(filename).toBe('attestation-stage-STG-fini.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDeLAttestationDeStage(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur du Capital Humain');
    expect(textes.titre).toBe('ATTESTATION DE STAGE');
  });

  it('les deux paragraphes ; les noms et les dates en gras, pas le poste', () => {
    const textes = textesDeLAttestationDeStage(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Babacar GUEYE, Directeur du Capital Humain, atteste par la présente que ' +
        'Madame Awa DIOP a effectué un stage sur la période allant du 5 janvier 2026 au 30 juin 2026, ' +
        'en qualité de Stagiaire juriste.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Babacar GUEYE',
      'Madame Awa DIOP',
      '5 janvier 2026',
      '30 juin 2026',
    ]);
    expect(enClair(textes, 1)).toBe(
      'En foi de quoi, la présente attestation est délivrée à l’intéressée pour servir et valoir ce que de droit.',
    );
  });

  it('accorde avec le genre que porte chaque dossier, timbre compris', () => {
    const textes = textesDeLAttestationDeStage(
      dossier({
        agent: { nom: 'Ousmane FALL', genre: 'male' },
        signataire: { nom: 'Mariama CISSÉ', genre: 'female' },
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice du Capital Humain');
    expect(enClair(textes, 0)).toMatch(
      /^Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que Monsieur Ousmane FALL a effectué/,
    );
    expect(enClair(textes, 1)).toContain('délivrée à l’intéressé pour servir');
  });

  it('sans genre au dossier, les deux formes ; personne à la DCH, un blanc', () => {
    const textes = textesDeLAttestationDeStage(
      dossier({ agent: { nom: 'Ndeye DIALLO', genre: null }, signataire: null }),
      new Date(),
    );
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), …+, Directeur du Capital Humain, /);
    expect(enClair(textes, 0)).toContain('que Monsieur/Madame Ndeye DIALLO a effectué');
    expect(enClair(textes, 1)).toContain('délivrée à l’intéressé(e) pour servir');
  });

  it('élide devant une voyelle ; sans poste, la phrase finit sur les dates', () => {
    expect(
      enClair(textesDeLAttestationDeStage(dossier({ poste: 'Assistante RH' }), new Date()), 0),
    ).toMatch(/au 30 juin 2026, en qualité d’Assistante RH\.$/);
    expect(enClair(textesDeLAttestationDeStage(dossier({ poste: null }), new Date()), 0)).toMatch(
      /allant du 5 janvier 2026 au 30 juin 2026\.$/,
    );
  });

  it('une fin que rien ne fixe encore se porte à la main', () => {
    const textes = textesDeLAttestationDeStage(dossier({ fin: null }), new Date());
    expect(enClair(textes, 0)).toMatch(/allant du 5 janvier 2026 au …+, en qualité/);
    expect(enGras(textes, 0).at(-1)).toMatch(/^…+$/);
  });
});

describe('le stage que l’attestation cite', () => {
  it('un stage fini, le dossier sorti', async () => {
    expect(enClair(await textesDe(employes.fini!), 0)).toBe(
      'Je soussignée, Madame Mariama CISSÉ, Directrice du Capital Humain, atteste par la présente que ' +
        'Madame Awa DIOP a effectué un stage sur la période allant du 5 janvier 2026 au 30 juin 2026, ' +
        'en qualité de Stagiaire juriste.',
    );
  });

  it('renouvelé sans interruption, un seul stage, du premier jour au dernier', async () => {
    expect(enClair(await textesDe(employes.renouvele!), 0)).toContain(
      'allant du 6 janvier 2025 au 30 juin 2025, en qualité de Stagiaire comptable.',
    );
  });

  it('un départ avant la fin prévue : le stage finit au départ', async () => {
    expect(enClair(await textesDe(employes.depart!), 0)).toContain(
      'allant du 2 février 2026 au 15 mai 2026, en qualité de Stagiaire RH.',
    );
  });

  it('une embauche ensuite : le stage et son poste, pas le contrat ni le poste d’aujourd’hui', async () => {
    expect(enClair(await textesDe(employes.embauche!), 0)).toContain(
      'Monsieur Moussa NDIAYE a effectué un stage sur la période allant du 1er janvier 2024 au ' +
        '30 juin 2024, en qualité de Stagiaire analyste.',
    );
  });

  it('en cours, sans fin fixée ni affectation : un blanc, et le poste du contrat', async () => {
    expect(enClair(await textesDe(employes.encours!), 0)).toMatch(
      /allant du 1er septembre 2026 au …+, en qualité d’Assistante RH\.$/,
    );
  });

  it('deux stages, en 2012 puis en 2015 : la DCH choisit celui que l’attestation cite', async () => {
    expect(await codeOf(() => textesDe(employes.deux!))).toBe('documents.stage_a_choisir');
    expect(enClair(await textesDe(employes.deux!, '2012-03-01'), 0)).toContain(
      'allant du 1er mars 2012 au 31 août 2012, en qualité de Stagiaire juriste.',
    );
    expect(enClair(await textesDe(employes.deux!, '2015-01-05'), 0)).toContain(
      'allant du 5 janvier 2015 au 4 mai 2015, en qualité de Stagiaire comptable.',
    );
    expect(await codeOf(() => textesDe(employes.deux!, '2013-01-07'))).toBe(
      'documents.stage_inconnu',
    );
  });

  it('sans stage commencé, pas d’attestation', async () => {
    expect(await codeOf(() => textesDe(employes.cdi!))).toBe('documents.sans_stage');
    const futur = randomUUID();
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date)
       VALUES ($1, $2, $3, 'stage', CURRENT_DATE + 30)`,
      [futur, tenantId, employes.cdi],
    );
    try {
      expect(await codeOf(() => textesDe(employes.cdi!))).toBe('documents.sans_stage');
    } finally {
      await raw('DELETE FROM contracts WHERE id = $1', [futur]);
    }
  });
});
