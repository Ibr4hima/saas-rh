/**
 * Le certificat de travail, sur le modèle officiel de l'APIX (ADR-0091) : ce
 * qu'il DIT, avec la catégorie saisie par la DCH, et quel emploi il cite.
 *
 * Il se délivre au départ, ou se prépare avant pour un agent encore en poste,
 * jusqu'au dernier jour que la DCH saisit (ADR-0176). Il cite l'emploi du
 * premier jour de l'ancienneté au dernier jour d'activité, le dernier poste
 * occupé, et la catégorie de ce poste dans la convention collective, que le
 * dossier ne porte pas. Qui certifie dirige le sommet de l'organigramme.
 * Pour une personne sans dossier dans l'application, la DCH renseigne une
 * fiche.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb, type Tx } from '../src/db/tenant-db';
import {
  certificatDeTravail,
  certificatHorsDossier,
  textesDeCertificatHorsDossierPour,
  textesDeCertificatPour,
  textesDuCertificatDeTravail,
  type CertificatData,
} from '../src/modules/documents/certificat-travail';
import type { TextesDUneAttestation } from '../src/modules/documents/feuille';

const env = loadEnv();
const tenantId = randomUUID();
const adminUserId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let sommet: string;
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

const textesDe = (employeeId: string, categorie = '7B', fin?: string) =>
  enTenant((tx) => textesDeCertificatPour(tx, employeeId, categorie, fin));

/** Le détail d'un refus : la règle enfreinte, champ par champ. */
async function detailOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.detail ?? '';
    throw err;
  }
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Les données d'un emploi ordinaire, à varier d'un test à l'autre. */
const dossier = (d: Partial<CertificatData> = {}): CertificatData => ({
  agent: { nom: 'Moussa NDIAYE', genre: 'male' },
  debut: '2023-07-01',
  fin: '2026-03-31',
  poste: 'Chargé d’Information',
  signataire: { nom: 'Cheikh MBAYE', genre: 'male' },
  categorie: '7B',
  ...d,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Admin', 'Certificat')`,
    [adminUserId, `crt-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `crt-${tenantId.slice(0, 8)}`,
  ]);
  sommet = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [sommet, tenantId],
  );

  /** Un dossier : ses contrats [type, début, fin], ses affectations [poste, début, fin], son départ. */
  async function creer(
    cle: string,
    [prenom, nom, genre]: [string, string, string | null],
    {
      contrats,
      affectations = [],
      depart,
    }: {
      contrats: [string, string, string | null][];
      affectations?: [string, string, string | null][];
      depart?: [dernierJour: string, motif: string];
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
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status,
                              inactivite_motif, fin_activite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employeeId,
        tenantId,
        personId,
        `CRT-${cle}`,
        contrats[0]![1],
        depart ? 'archived' : 'active',
        depart?.[1] ?? null,
        depart?.[0] ?? null,
      ],
    );
    for (const [type, debut, fin] of contrats) {
      await raw(
        `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), tenantId, employeeId, type, debut, fin],
      );
    }
    for (const [poste, debut, fin] of affectations) {
      await raw(
        `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
         VALUES ($1, $2, $3, $4, $5, daterange($6, $7))`,
        [randomUUID(), tenantId, employeeId, sommet, poste, debut, fin],
      );
    }
    if (depart) {
      await raw(
        `INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, employeeId, depart[0], depart[1]],
      );
    }
  }

  await creer('dg', ['Cheikh', 'Mbaye', 'male'], {
    contrats: [['cdi', '2019-01-01', null]],
    affectations: [['DG', '2019-01-01', null]],
  });
  // Démission après un stage puis un CDI : le stage ne compte pas.
  await creer('demission', ['Moussa', 'Ndiaye', 'male'], {
    contrats: [
      ['stage', '2023-01-02', '2023-06-30'],
      ['cdi', '2023-07-01', null],
    ],
    affectations: [
      ['Stagiaire', '2023-01-02', '2023-07-01'],
      ['Assistant', '2023-07-01', '2025-01-01'],
      ['Chargé d’Information', '2025-01-01', '2026-04-01'],
    ],
    depart: ['2026-03-31', 'demission'],
  });
  // Un CDD arrivé à son terme ; sans genre au dossier.
  await creer('cdd', ['Ndeye', 'Diallo', null], {
    contrats: [['cdd', '2024-02-01', '2025-01-31']],
    affectations: [['Analyste', '2024-02-01', '2025-02-01']],
    depart: ['2025-01-31', 'fin_de_contrat'],
  });
  // Un stage seulement, terminé.
  await creer('stage', ['Awa', 'Diop', 'female'], {
    contrats: [['stage', '2025-03-03', '2025-08-29']],
    depart: ['2025-08-29', 'fin_de_contrat'],
  });
  // En activité.
  await creer('actif', ['Fatou', 'Sall', 'female'], {
    contrats: [['cdi', '2022-05-02', null]],
    affectations: [['Comptable', '2022-05-02', null]],
  });
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [sommet, employes.dg]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM periodes_inactivite WHERE tenant_id = $1', [tenantId]);
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
  it('tient sur UNE feuille, et porte un nom de fichier tiré du matricule', async () => {
    const { filename, pdf } = await enTenant((tx) =>
      certificatDeTravail.pdf(tx, employes.demission!, { categorie: '7B' }),
    );
    expect(filename).toBe('certificat-travail-CRT-demission.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});

describe('les mots du modèle', () => {
  it('l’en-tête, le timbre et le titre', () => {
    const textes = textesDuCertificatDeTravail(dossier(), new Date('2026-10-17T10:00:00'));
    expect(textes.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(textes.lieuEtDate).toBe('Dakar, le 17 octobre 2026');
    expect(textes.timbre).toBe('Le Directeur Général');
    expect(textes.titre).toBe('CERTIFICAT DE TRAVAIL');
  });

  it('les trois paragraphes ; la catégorie après le mot, les noms et les dates en gras', () => {
    const textes = textesDuCertificatDeTravail(dossier(), new Date());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Cheikh MBAYE, Directeur Général de la Société APIX-SA, certifie que ' +
        'Monsieur Moussa NDIAYE a été employé à APIX-SA, sur la période allant du 1er juillet 2023 ' +
        'au 31 mars 2026, en qualité de Chargé d’Information.',
    );
    expect(enGras(textes, 0)).toEqual([
      'Monsieur Cheikh MBAYE',
      'Monsieur Moussa NDIAYE',
      '1er juillet 2023',
      '31 mars 2026',
    ]);
    expect(enClair(textes, 1)).toBe(
      'Ce poste de Chargé d’Information est classé à la catégorie 7B de la Convention Collective du Commerce.',
    );
    expect(enGras(textes, 1)).toEqual([]);
    expect(enClair(textes, 2)).toBe(
      'En foi de quoi, le présent certificat est établi pour servir et valoir ce que de droit.',
    );
  });

  it('écrit la catégorie en capitales, quelle que soit la saisie', () => {
    const textes = textesDuCertificatDeTravail(dossier({ categorie: '7b' }), new Date());
    expect(enClair(textes, 1)).toContain('est classé à la catégorie 7B de la Convention');
  });

  it('accorde avec le genre que porte chaque dossier, timbre compris', () => {
    const textes = textesDuCertificatDeTravail(
      dossier({
        agent: { nom: 'Fatou SALL', genre: 'female' },
        poste: 'Analyste',
        signataire: { nom: 'Aïssatou FALL', genre: 'female' },
      }),
      new Date(),
    );
    expect(textes.timbre).toBe('La Directrice Générale');
    expect(enClair(textes, 0)).toMatch(
      /^Je soussignée, Madame Aïssatou FALL, Directrice Générale de la Société APIX-SA, certifie que Madame Fatou SALL a été employée à APIX-SA,/,
    );
    expect(enClair(textes, 1)).toMatch(/^Ce poste d’Analyste est classé à la catégorie 7B /);
  });

  it('sans genre au dossier, les deux formes ; personne au sommet, un blanc', () => {
    const textes = textesDuCertificatDeTravail(
      dossier({ agent: { nom: 'Ndeye DIALLO', genre: null }, signataire: null }),
      new Date(),
    );
    expect(textes.timbre).toBe('Le Directeur Général');
    expect(enClair(textes, 0)).toMatch(/^Je soussigné\(e\), …+, Directeur Général de la Société/);
    expect(enClair(textes, 0)).toContain('Monsieur/Madame Ndeye DIALLO a été employé(e) à APIX-SA');
  });

  it('sans poste au dossier, ni « en qualité de », ni poste nommé ; sans fin, un blanc', () => {
    const textes = textesDuCertificatDeTravail(dossier({ poste: null, fin: null }), new Date());
    expect(enClair(textes, 0)).toMatch(/allant du 1er juillet 2023 au …+\.$/);
    expect(enClair(textes, 1)).toMatch(/^Ce poste est classé à la catégorie 7B /);
  });
});

describe('l’emploi que le certificat cite', () => {
  it('du premier jour de l’ancienneté, sans le stage, au dernier jour ; le dernier poste', async () => {
    const textes = await textesDe(employes.demission!);
    expect(textes.timbre).toBe('Le Directeur Général');
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Cheikh MBAYE, Directeur Général de la Société APIX-SA, certifie que ' +
        'Monsieur Moussa NDIAYE a été employé à APIX-SA, sur la période allant du 1er juillet 2023 ' +
        'au 31 mars 2026, en qualité de Chargé d’Information.',
    );
    expect(enClair(textes, 1)).toMatch(
      /^Ce poste de Chargé d’Information est classé à la catégorie 7B /,
    );
  });

  it('un CDD arrivé à son terme', async () => {
    expect(enClair(await textesDe(employes.cdd!, 'M2'), 0)).toContain(
      'Monsieur/Madame Ndeye DIALLO a été employé(e) à APIX-SA, sur la période allant du ' +
        '1er février 2024 au 31 janvier 2025, en qualité d’Analyste.',
    );
  });

  it('un agent encore en poste : jusqu’au dernier jour saisi, celui que prévoit son départ', async () => {
    expect(enClair(await textesDe(employes.actif!, '7B', '2026-12-31'), 0)).toContain(
      'Madame Fatou SALL a été employée à APIX-SA, sur la période allant du 2 mai 2022 ' +
        'au 31 décembre 2026, en qualité de Comptable.',
    );
  });

  it('en poste, sans dernier jour, pas de certificat ; un dernier jour avant le premier, non plus', async () => {
    expect(await codeOf(() => textesDe(employes.actif!))).toBe('documents.fin');
    expect(await codeOf(() => textesDe(employes.actif!, '7B', '2022-05-01'))).toBe(
      'documents.fin_avant_le_debut',
    );
  });

  it('parti, le dernier jour est celui du départ, quoi que la saisie dise', async () => {
    expect(enClair(await textesDe(employes.demission!, '7B', '2026-12-31'), 0)).toContain(
      'du 1er juillet 2023 au 31 mars 2026',
    );
  });

  it('un stage relève de l’attestation de stage', async () => {
    expect(await codeOf(() => textesDe(employes.stage!))).toBe('documents.stage');
  });

  it('sans catégorie, pas de certificat', async () => {
    expect(
      await codeOf(() => enTenant((tx) => certificatDeTravail.pdf(tx, employes.cdd!, {}))),
    ).toBe('documents.categorie');
  });
});

describe('une personne sans dossier dans l’application (ADR-0176)', () => {
  /** Une fiche ordinaire : partie il y a dix ans, saisie en minuscules. */
  const fiche = (f: Record<string, unknown> = {}) => ({
    civilite: 'monsieur',
    prenom: 'ibrahima',
    nom: 'sarr',
    debut: '2009-01-05',
    fin: '2016-06-30',
    poste: 'chargé de mission',
    categorie: '8a',
    ...f,
  });
  const textesDeLaFiche = (corps: unknown) =>
    enTenant((tx) => textesDeCertificatHorsDossierPour(tx, corps));

  it('la fiche tient lieu de dossier : la personne, l’emploi, le poste et sa catégorie', async () => {
    const textes = await textesDeLaFiche(fiche());
    expect(enClair(textes, 0)).toBe(
      'Je soussigné, Monsieur Cheikh MBAYE, Directeur Général de la Société APIX-SA, certifie que ' +
        'Monsieur Ibrahima SARR a été employé à APIX-SA, sur la période allant du 5 janvier 2009 ' +
        'au 30 juin 2016, en qualité de Chargé de mission.',
    );
    expect(enClair(textes, 1)).toBe(
      'Ce poste de Chargé de mission est classé à la catégorie 8A de la Convention Collective du Commerce.',
    );
    const madame = await textesDeLaFiche(fiche({ civilite: 'madame', prenom: 'aïda' }));
    expect(enClair(madame, 0)).toContain('Madame Aïda SARR a été employée à APIX-SA');
  });

  it('tient sur une feuille, et le nom de la personne fait celui du fichier', async () => {
    const { filename, pdf } = await enTenant((tx) => certificatHorsDossier.pdf(tx, fiche()));
    expect(filename).toBe('certificat-travail-SARR-Ibrahima.pdf');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });

  it('un départ déjà prévu : le dernier jour peut être à venir', async () => {
    expect(enClair(await textesDeLaFiche(fiche({ fin: '2030-01-31' })), 0)).toContain(
      'au 31 janvier 2030',
    );
  });

  it('tout est obligatoire ; le dernier jour ne précède pas le premier, qui n’est pas à venir', async () => {
    expect(await codeOf(() => textesDeLaFiche(fiche({ categorie: undefined })))).toBe(
      'validation_failed',
    );
    expect(await detailOf(() => textesDeLaFiche(fiche({ fin: '2008-12-31' })))).toBe(
      'fin : Pas avant le premier jour',
    );
    expect(await detailOf(() => textesDeLaFiche(fiche({ debut: '2099-01-05' })))).toContain(
      'debut : Ne peut pas être dans le futur',
    );
    expect(await codeOf(() => textesDeLaFiche(fiche({ matricule: 'M0012' })))).toBe(
      'validation_failed',
    );
  });
});
