/**
 * L'accueil de la campagne d'évaluation annuelle (ADR-0211).
 *
 * Ce qui compte : toute personne y lit sa fiche comme celle de son dossier
 * (poste, direction, département, service, N+1, statut) et l'état de son
 * auto-évaluation ; un N+1 y voit les agents à évaluer, avec l'état de
 * chaque auto-évaluation. L'évaluateur choisi pour la campagne remplace le
 * N+1 de l'organigramme, sans toucher à l'organigramme. Ni le sommet de
 * l'organigramme ni un stage ne sont évalués.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { CampagneService } from '../src/modules/campagne/campagne.service';

const env = loadEnv();
const tenantId = randomUUID();

/** Un jour autour d'aujourd'hui, AAAA-MM-JJ. */
const jour = (decalage: number) =>
  new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
const AUJOURD_HUI = jour(0);
const ANNEE = Number(AUJOURD_HUI.slice(0, 4));

type Nom = 'dg' | 'awa' | 'moussa' | 'fatou' | 'ibou' | 'ousmane' | 'lamine';
const NOMS: Nom[] = ['dg', 'awa', 'moussa', 'fatou', 'ibou', 'ousmane', 'lamine'];
const comptes = Object.fromEntries(NOMS.map((n) => [n, randomUUID()])) as Record<Nom, string>;
const agents = Object.fromEntries(NOMS.map((n) => [n, randomUUID()])) as Record<Nom, string>;
const unites = {
  generale: randomUUID(),
  dch: randomUUID(),
  developpement: randomUUID(),
  administration: randomUUID(),
};

const session = (qui: Nom | 'admin') =>
  ({
    userId: qui === 'admin' ? ADMIN : comptes[qui],
    tenantId,
    role: qui === 'admin' ? 'admin' : 'employee',
  }) as SessionUser;
const ADMIN = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let campagne: CampagneService;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

async function agent(
  qui: Nom,
  prenom: string,
  nom: string,
  n1: Nom | null,
  unite: string,
  poste: string,
  o: { personnel?: 'cadre' | 'non_cadre' } = {},
) {
  const personId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x',$3,$4)`,
    [comptes[qui], `camp-${qui}-${comptes[qui]}@test.local`, prenom, nom],
  );
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,$5)`,
    [personId, tenantId, comptes[qui], prenom, nom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status,
                            manager_employee_id, personnel)
     VALUES ($1,$2,$3,$4,'2020-01-01','active',$5,$6)`,
    [
      agents[qui],
      tenantId,
      personId,
      `CAMP-${qui.toUpperCase()}`,
      n1 ? agents[n1] : null,
      o.personnel ?? null,
    ],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,$5,daterange('2020-01-01'::date, NULL))`,
    [randomUUID(), tenantId, agents[qui], unite, poste],
  );
}

/** La fiche d'un agent pour l'année : son évaluateur choisi, son auto-évaluation. */
async function fiche(
  qui: Nom,
  o: { evaluateur?: Nom; commencee?: boolean; transmise?: boolean } = {},
) {
  await raw(
    `INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, evaluateur_employee_id,
                                   auto, auto_transmise_le)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      tenantId,
      agents[qui],
      ANNEE,
      o.evaluateur ? agents[o.evaluateur] : null,
      o.commencee || o.transmise ? '{}' : null,
      o.transmise ? new Date() : null,
    ],
  );
}

/** La période de l'année, du … à la fin de l'auto-évaluation … au …. */
async function periode(du: number, autoAu: number | null, au: number) {
  await raw(`DELETE FROM evaluation_periodes WHERE tenant_id = $1`, [tenantId]);
  await raw(
    `INSERT INTO evaluation_periodes (id, tenant_id, annee, du, auto_au, au)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), tenantId, ANNEE, jour(du), autoAu === null ? null : jour(autoAu), jour(au)],
  );
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  campagne = new CampagneService(db);

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Campagne',$2)`, [
    tenantId,
    `campagne-${tenantId.slice(0, 8)}`,
  ]);
  const unite = (
    id: string,
    type: string,
    nom: string,
    parent: string | null,
    abrege: string | null = null,
  ) =>
    raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, short_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, tenantId, type, nom, parent, abrege],
    );
  await unite(unites.generale, 'direction', 'Direction Générale', null, 'DG');
  await unite(unites.dch, 'direction', 'Direction du Capital Humain', unites.generale, 'DCH');
  await unite(
    unites.developpement,
    'department',
    'Département Développement du personnel',
    unites.dch,
  );
  await unite(
    unites.administration,
    'service',
    'Service Administration du personnel',
    unites.developpement,
  );

  await agent('dg', 'Cheikh', 'Mbaye', null, unites.generale, 'Direction générale');
  await agent('awa', 'Awa', 'Diop', 'dg', unites.developpement, 'Responsable du département', {
    personnel: 'cadre',
  });
  await agent(
    'moussa',
    'Moussa',
    'Sarr',
    'awa',
    unites.administration,
    'Gestionnaire de l’administration du personnel',
    { personnel: 'cadre' },
  );
  await agent('fatou', 'Fatou', 'Sall', 'awa', unites.administration, 'Secrétaire', {
    personnel: 'non_cadre',
  });
  // N+1 dans l'organigramme : Cheikh Mbaye ; évaluation de la campagne : Awa Diop.
  await agent('ibou', 'Ibou', 'Ndiaye', 'dg', unites.administration, 'Comptable');
  // N+1 dans l'organigramme : Awa Diop ; évaluation de la campagne : Cheikh Mbaye.
  await agent('ousmane', 'Ousmane', 'Fall', 'awa', unites.administration, 'Analyste');
  await agent('lamine', 'Lamine', 'Ba', 'awa', unites.administration, 'Stagiaire');
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
     VALUES ($1,$2,$3,'stage',$4,$5)`,
    [randomUUID(), tenantId, agents.lamine, jour(-30), jour(60)],
  );
  for (const [id, responsable] of [
    [unites.generale, agents.dg],
    [unites.developpement, agents.awa],
  ] as const) {
    await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [responsable, id]);
  }

  await fiche('moussa', { transmise: true });
  await fiche('fatou', { commencee: true });
  await fiche('ibou', { evaluateur: 'awa' });
  await fiche('ousmane', { evaluateur: 'dg' });

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x','Admin','Plateforme')`,
    [ADMIN, `camp-admin-${ADMIN}@test.local`],
  );
  await periode(-2, 3, 10);
});

afterAll(async () => {
  await ownerPool?.end();
  await db?.pool.end();
});

describe('la fiche de qui se connecte', () => {
  it('comme son dossier : poste, direction, département, service, N+1, statut', async () => {
    const { annee, moi, equipe } = await campagne.accueil(session('moussa'));
    expect(annee).toBe(ANNEE);
    expect(moi).toEqual({
      employeeId: agents.moussa,
      prenom: 'Moussa',
      nom: 'Sarr',
      matricule: 'CAMP-MOUSSA',
      poste: 'Gestionnaire de l’administration du personnel',
      personnel: 'cadre',
      direction: 'Direction du Capital Humain',
      directionAbregee: 'DCH',
      departement: 'Département Développement du personnel',
      service: 'Service Administration du personnel',
      evaluateur: { prenom: 'Awa', nom: 'Diop', poste: 'Responsable du département' },
      auto: { etat: 'transmise', transmiseLe: AUJOURD_HUI },
    });
    expect(equipe).toEqual([]);
  });

  it('l’auto-évaluation : commencée, puis à faire sans fiche', async () => {
    expect((await campagne.accueil(session('fatou'))).moi?.auto).toEqual({
      etat: 'en_cours',
      transmiseLe: null,
    });
    expect((await campagne.accueil(session('awa'))).moi?.auto).toEqual({
      etat: 'a_faire',
      transmiseLe: null,
    });
  });

  it('ni le sommet de l’organigramme ni un stage ne sont évalués', async () => {
    expect((await campagne.accueil(session('dg'))).moi?.auto).toBeNull();
    expect((await campagne.accueil(session('lamine'))).moi?.auto).toBeNull();
  });

  it('un compte sans dossier d’agent n’a ni fiche ni équipe', async () => {
    const { moi, equipe } = await campagne.accueil(session('admin'));
    expect(moi).toBeNull();
    expect(equipe).toEqual([]);
  });
});

describe('l’équipe d’un N+1', () => {
  it('les agents à évaluer, par ordre alphabétique, avec leur auto-évaluation', async () => {
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.map((a) => [a.nom, a.auto.etat])).toEqual([
      ['Ndiaye', 'a_faire'],
      ['Sall', 'en_cours'],
      ['Sarr', 'transmise'],
    ]);
    expect(equipe[2]).toMatchObject({
      employeeId: agents.moussa,
      prenom: 'Moussa',
      matricule: 'CAMP-MOUSSA',
      poste: 'Gestionnaire de l’administration du personnel',
      auto: { transmiseLe: AUJOURD_HUI },
    });
  });

  it('l’évaluateur choisi pour la campagne remplace le N+1, sans toucher à l’organigramme', async () => {
    expect((await campagne.accueil(session('ibou'))).moi?.evaluateur).toEqual({
      prenom: 'Awa',
      nom: 'Diop',
      poste: 'Responsable du département',
    });
    const dg = await campagne.accueil(session('dg'));
    expect(dg.equipe.map((a) => a.nom)).toEqual(['Diop', 'Fall']);
    const { rows } = await raw(
      `SELECT employee_number, manager_employee_id FROM employees WHERE id = ANY($1::uuid[])`,
      [[agents.ibou, agents.ousmane]],
    );
    expect(Object.fromEntries(rows.map((r) => [r.employee_number, r.manager_employee_id]))).toEqual(
      { 'CAMP-IBOU': agents.dg, 'CAMP-OUSMANE': agents.awa },
    );
  });
});

describe('la fiche d’un agent, ouverte depuis sa carte', () => {
  it('la fiche s’ouvre à l’évaluateur, de l’organigramme comme de la campagne', async () => {
    const moussa = await campagne.agentDeLEquipe(session('awa'), agents.moussa);
    expect(moussa.annee).toBe(ANNEE);
    expect(moussa.agent).toMatchObject({
      employeeId: agents.moussa,
      prenom: 'Moussa',
      service: 'Service Administration du personnel',
      evaluateur: { prenom: 'Awa', nom: 'Diop' },
      auto: { etat: 'transmise', transmiseLe: AUJOURD_HUI },
    });
    const ibou = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect(ibou.agent.nom).toBe('Ndiaye');
  });

  it('hors de son équipe, l’agent reste introuvable', async () => {
    const introuvable = { problem: { status: 404, code: 'campagne.agent_hors_equipe' } };
    // Ousmane Fall : N+1 Awa Diop dans l'organigramme, évaluation confiée ailleurs.
    await expect(campagne.agentDeLEquipe(session('awa'), agents.ousmane)).rejects.toMatchObject(
      introuvable,
    );
    await expect(campagne.agentDeLEquipe(session('fatou'), agents.moussa)).rejects.toMatchObject(
      introuvable,
    );
    // Un dossier en stage n'est pas évalué, même par son N+1.
    await expect(campagne.agentDeLEquipe(session('awa'), agents.lamine)).rejects.toMatchObject(
      introuvable,
    );
    await expect(campagne.agentDeLEquipe(session('admin'), agents.moussa)).rejects.toMatchObject(
      introuvable,
    );
  });
});

describe('les phases de la campagne', () => {
  it('à venir, auto-évaluation, évaluation, terminée, et sans période', async () => {
    const phase = async () => (await campagne.accueil(session('moussa'))).phase;
    await periode(2, 5, 12);
    expect(await phase()).toBe('a_venir');
    await periode(-2, 3, 10);
    expect(await phase()).toBe('auto_evaluation');
    expect((await campagne.accueil(session('moussa'))).periode).toEqual({
      du: jour(-2),
      autoAu: jour(3),
      au: jour(10),
    });
    await periode(-8, -3, 10);
    expect(await phase()).toBe('evaluation');
    await periode(-20, -15, -1);
    expect(await phase()).toBe('terminee');
    // Sans fin d'auto-évaluation, toute la période est à l'auto-évaluation.
    await periode(-8, null, 10);
    expect(await phase()).toBe('auto_evaluation');
    await raw(`DELETE FROM evaluation_periodes WHERE tenant_id = $1`, [tenantId]);
    const sans = await campagne.accueil(session('moussa'));
    expect([sans.phase, sans.periode]).toEqual(['non_fixee', null]);
  });
});
