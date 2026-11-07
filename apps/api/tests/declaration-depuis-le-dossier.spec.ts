/**
 * La déclaration de mouvement d'une personne qui a son dossier dans
 * l'application (ADR-0199) : la DCH choisit l'agent, la fiche reprend ce que
 * le dossier porte et le fige ; le serveur le reprend aussi, quoi qu'on lui
 * envoie. Le numéro de la CNI, celui de l'IPRES et le salaire de base ne se
 * lisent qu'avec l'accès aux données sensibles. Sans dossier, la DCH
 * renseigne tout, comme avant.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DossierPourLaDeclaration, SessionUser } from '@teranga/contracts';
import {
  ansPlusTot,
  aujourdhuiIso,
  CAPACITES_DELEGABLES,
  codeDuPays,
  repriseDeLaDeclaration,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { GenerationService } from '../src/modules/documents/generation.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const crypto = new EncryptionService();

let ownerPool: Pool;
let db: TenantDb;
let generation: GenerationService;

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

/** Un dossier : la personne, l'agent, son poste et son contrat. */
async function dossier(
  prenom: string,
  nom: string,
  {
    personne = {},
    contrat = 'cdi',
    fin = null,
    archive = false,
  }: {
    personne?: Record<string, unknown>;
    contrat?: string;
    fin?: string | null;
    archive?: boolean;
  } = {},
): Promise<{ employeeId: string; userId: string }> {
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
  const colonnes = Object.keys(personne);
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name${colonnes
      .map((c) => `, ${c}`)
      .join('')})
     VALUES ($1,$2,$3,$4,$5${colonnes.map((_, i) => `, $${i + 6}`).join('')})`,
    [personId, tenantId, userId, prenom, nom, ...Object.values(personne)],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, categorie,
                            status, archived_at, fin_activite)
     VALUES ($1,$2,$3,$4,'2019-03-01','7b',$5,$6,$7)`,
    [
      employeeId,
      tenantId,
      personId,
      `DM-${prenom}`,
      archive ? 'archived' : 'active',
      archive ? new Date('2026-09-30T18:00:00Z') : null,
      archive ? '2026-09-30' : null,
    ],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, position_title, validity)
     VALUES ($1,$2,$3,'Comptable', daterange('2019-03-01', $4))`,
    [randomUUID(), tenantId, employeeId, archive ? '2026-10-01' : null],
  );
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
     VALUES ($1,$2,$3,$4,'2024-01-01',$5)`,
    [randomUUID(), tenantId, employeeId, contrat, fin],
  );
  return { employeeId, userId };
}

let direction: SessionUser;
let delegue: SessionUser;
let moussa: { employeeId: string; userId: string };
let binta: { employeeId: string; userId: string };

/** Ce qu'une fiche dit d'abord, faux pour Moussa : le dossier le remet à sa place. */
const saisie = (f: Record<string, unknown> = {}) => ({
  mouvements: ['changement_d_emploi'],
  effetLe: '2026-10-01',
  civilite: 'madame',
  prenom: 'Autre',
  nom: 'Personne',
  naissanceLe: '1999-01-01',
  naissanceA: 'Bamako',
  naissancePays: 'ML',
  nationalite: 'ML',
  perePrenom: 'Oumar',
  merePrenom: 'Kadiatou',
  mereNom: 'Traoré',
  adresse: 'Hamdallaye, Bamako',
  cni: 'AB12',
  cniDelivreeLe: '2023-01-01',
  cniDelivreeA: 'Dakar',
  cniDelivreePar: 'Directeur Général de la Sûreté Nationale',
  situationDeFamille: 'celibataire',
  conjoints: [],
  enfants: ['Fatou Sarr', 'Cheikh Sarr'],
  entreeLe: '2020-01-01',
  profession: 'Comptable',
  emploi: 'Caissier',
  categorie: '1A',
  contrat: 'cdi',
  residence: 'Bamako',
  serviceMilitaire: false,
  horaire: 40,
  salaire: 100000,
  dispositions: [],
  ...f,
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  generation = new GenerationService(
    db,
    crypto,
    new AttestationService(db),
    new AbsencesService(db),
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX',$2)`, [
    tenantId,
    `dmt-${tenantId.slice(0, 8)}`,
  ]);
  const mariama = await dossier('Mariama', 'Cissé', { personne: { gender: 'female' } });
  const awa = await dossier('Awa', 'Diop', { personne: { gender: 'female' } });
  direction = {
    userId: mariama.userId,
    tenantId,
    role: 'employee',
    dirigeLaDCH: true,
    capacites: [...CAPACITES_DELEGABLES],
  } as SessionUser;
  delegue = {
    userId: awa.userId,
    tenantId,
    role: 'employee',
    capacites: ['generation.declaration_mouvement'],
  } as SessionUser;
  moussa = await dossier('Moussa', 'Sarr', {
    personne: {
      gender: 'male',
      birth_date: '1985-04-12',
      lieu_de_naissance: 'thiès',
      birth_place: 'Sénégal',
      nationality: 'SN',
      prenom_du_pere: 'Ibrahima',
      prenom_de_la_mere: 'Aminata',
      nom_de_la_mere: 'Ndiaye',
      address_line: 'Sacré-Cœur 3, Villa 12',
      ville: 'Dakar',
      national_id_encrypted: crypto.encrypt('1 234 1985 00123'),
      id_document_type: 'cni',
      id_document_issued_on: ansPlusTot(aujourdhuiIso(), 3),
      marital_status: 'married',
      epouses: ['Fatou Diop'],
      nombre_enfants: 2,
    },
    contrat: 'cdd',
    fin: '2027-12-31',
  });
  await raw(
    `INSERT INTO remunerations (id, tenant_id, employee_id, salaire_de_base, numero_ipres)
     VALUES ($1,$2,$3,650000,'123456')`,
    [randomUUID(), tenantId, moussa.employeeId],
  );
  binta = await dossier('Binta', 'Ba', { personne: { gender: 'female' }, contrat: 'stage' });
  // Samba a quitté l'APIX : sa déclaration de départ se prépare encore.
  await dossier('Samba', 'Ndiaye', { personne: { gender: 'male' }, archive: true });
});

afterAll(async () => {
  for (const table of [
    'remunerations',
    'contracts',
    'assignments',
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

/** Un dossier complet, que chaque test fait varier. */
const complet = (d: Partial<DossierPourLaDeclaration> = {}): DossierPourLaDeclaration => ({
  civilite: 'monsieur',
  prenom: 'moussa',
  nom: 'Sarr',
  naissanceLe: '1985-04-12',
  naissanceA: 'thiès',
  naissancePays: 'SN',
  nationalite: 'SN',
  perePrenom: 'Ibrahima',
  merePrenom: 'Aminata',
  mereNom: 'Ndiaye',
  adresse: 'Sacré-Cœur 3, Villa 12',
  residence: 'Dakar',
  cni: '1234198500123',
  cniDelivreeLe: ansPlusTot(aujourdhuiIso(), 3),
  ipres: '123456',
  situationDeFamille: 'marie',
  epouses: ['Fatou Diop'],
  nombreDEnfants: 2,
  entreeLe: '2019-03-01',
  emploi: 'comptable',
  categorie: '7b',
  contrat: 'cdd',
  debut: '2024-01-01',
  fin: '2027-12-31',
  salaire: 650000,
  ...d,
});

describe('ce que la déclaration reprend du dossier', () => {
  it('tout ce que le dossier porte et que la fiche admet, mis en forme comme elle', () => {
    expect(repriseDeLaDeclaration(complet())).toEqual({
      civilite: 'monsieur',
      prenom: 'Moussa',
      nom: 'Sarr',
      naissanceLe: '1985-04-12',
      naissanceA: 'Thiès',
      naissancePays: 'SN',
      nationalite: 'SN',
      perePrenom: 'Ibrahima',
      merePrenom: 'Aminata',
      mereNom: 'Ndiaye',
      adresse: 'Sacré-Cœur 3, Villa 12',
      residence: 'Dakar',
      cni: '1234198500123',
      cniDelivreeLe: ansPlusTot(aujourdhuiIso(), 3),
      ipres: '123456',
      situationDeFamille: 'marie',
      conjoints: ['Fatou Diop'],
      nombreDEnfants: 2,
      entreeLe: '2019-03-01',
      emploi: 'Comptable',
      categorie: '7B',
      contrat: 'cdd',
      cddDu: '2024-01-01',
      cddAu: '2027-12-31',
      salaire: 650000,
    });
  });

  it('ce que la fiche refuserait reste à saisir', () => {
    const r = repriseDeLaDeclaration(
      complet({
        // Une CNI échue, un numéro qui n'en est pas un, vingt et un enfants.
        cniDelivreeLe: ansPlusTot(aujourdhuiIso(), 11),
        cni: '12345',
        nombreDEnfants: 21,
        categorie: 'Une catégorie bien trop longue pour la case du formulaire',
        // Un CDD qui finirait avant de commencer : sa fin se saisit.
        fin: '2023-12-31',
        // Une entrée connue au mois seulement : le serveur l'a laissée.
        entreeLe: null,
        salaire: 0,
      }),
    );
    for (const champ of [
      'cni',
      'cniDelivreeLe',
      'nombreDEnfants',
      'categorie',
      'cddAu',
      'entreeLe',
      'salaire',
    ]) {
      expect(r).not.toHaveProperty(champ);
    }
    expect(r.cddDu).toBe('2024-01-01');
  });

  it('la CNI et sa délivrance suivent la nationalité ; les épouses, un homme marié', () => {
    // Sans nationalité, la règle de la carte n'est pas connue : elle se saisit.
    const sansNationalite = repriseDeLaDeclaration(complet({ nationalite: null }));
    expect(sansNationalite).not.toHaveProperty('cni');
    expect(sansNationalite).not.toHaveProperty('cniDelivreeLe');
    // Une femme mariée : son époux se saisit, le dossier ne le nomme pas.
    expect(repriseDeLaDeclaration(complet({ civilite: 'madame', epouses: [] }))).not.toHaveProperty(
      'conjoints',
    );
    // Un CDI : ni début, ni fin de CDD.
    const cdi = repriseDeLaDeclaration(complet({ contrat: 'cdi', fin: null }));
    expect(cdi.contrat).toBe('cdi');
    expect(cdi).not.toHaveProperty('cddDu');
  });

  it('le pays de naissance, gardé par son nom, se retrouve par son code', () => {
    expect(codeDuPays('Sénégal')).toBe('SN');
    expect(codeDuPays('cote d’ivoire')).toBe('CI');
    expect(codeDuPays('Atlantide')).toBeNull();
  });
});

describe('le dossier lu pour la déclaration', () => {
  it('qui dirige la DCH lit tout ce que le dossier porte', async () => {
    const d = await generation.dossierPourLaDeclaration(direction, moussa.employeeId);
    expect(d).toMatchObject({
      civilite: 'monsieur',
      naissancePays: 'SN',
      cni: '1234198500123',
      ipres: '123456',
      salaire: 650000,
      situationDeFamille: 'marie',
      epouses: ['Fatou Diop'],
      nombreDEnfants: 2,
      entreeLe: '2019-03-01',
      emploi: 'Comptable',
      contrat: 'cdd',
      debut: '2024-01-01',
      fin: '2027-12-31',
    });
  });

  it('sans l’accès aux données sensibles, ni la CNI, ni l’IPRES, ni le salaire', async () => {
    const d = await generation.dossierPourLaDeclaration(delegue, moussa.employeeId);
    expect(d).toMatchObject({ cni: null, ipres: null, salaire: null, nom: 'Sarr' });
    // La date de délivrance n'est pas une donnée sensible.
    expect(d.cniDelivreeLe).not.toBeNull();
  });

  it('les agents proposés : sous CDI ou CDD, dossiers inactifs compris ; jamais soi', async () => {
    const noms = (await generation.agents(direction, 'declaration_mouvement', '')).map(
      (a) => a.givenName,
    );
    expect(noms).toEqual(expect.arrayContaining(['Moussa', 'Samba', 'Awa']));
    expect(noms).not.toContain('Binta');
    expect(noms).not.toContain('Mariama');
    expect(
      await codeOf(() => generation.dossierPourLaDeclaration(direction, binta.employeeId)),
    ).toBe('documents.contrat');
  });
});

describe('la déclaration générée pour l’agent choisi', () => {
  it('le serveur reprend le dossier, quoi que dise la fiche', async () => {
    // Une nationalité malienne sans date d'entrée au Sénégal : la fiche seule
    // ne passe pas. Le dossier dit la nationalité sénégalaise, le mariage et le
    // CDD : reprise, elle passe.
    expect(
      await codeOf(() => generation.pdfSansAgent(direction, 'declaration_mouvement', saisie())),
    ).toBe('validation_failed');
    const { filename } = await generation.pdfSansAgent(
      direction,
      'declaration_mouvement',
      saisie(),
      undefined,
      moussa.employeeId,
    );
    expect(filename).toBe('declaration-mouvement-SARR-Moussa.pdf');
  });

  it('autant d’enfants nommés que le dossier en compte', async () => {
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(
          direction,
          'declaration_mouvement',
          saisie({ enfants: ['Fatou Sarr'] }),
          undefined,
          moussa.employeeId,
        ),
      ),
    ).toBe('documents.enfants');
  });

  it('sans l’accès aux données sensibles, la CNI et le salaire saisis restent', async () => {
    const { filename } = await generation.pdfSansAgent(
      delegue,
      'declaration_mouvement',
      saisie({ cni: '1234198500123', salaire: 640000 }),
      undefined,
      moussa.employeeId,
    );
    expect(filename).toBe('declaration-mouvement-SARR-Moussa.pdf');
  });

  it('un agent hors de la cible, ou soi, ne se choisit pas', async () => {
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(
          direction,
          'declaration_mouvement',
          saisie(),
          undefined,
          binta.employeeId,
        ),
      ),
    ).toBe('documents.contrat');
    const soi = await raw(
      `SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id WHERE p.user_id = $1`,
      [direction.userId],
    );
    expect(
      await codeOf(() =>
        generation.pdfSansAgent(
          direction,
          'declaration_mouvement',
          saisie(),
          undefined,
          soi.rows[0].id as string,
        ),
      ),
    ).not.toBe('AUCUNE ERREUR');
  });
});
