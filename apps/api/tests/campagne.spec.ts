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
import {
  autoEvaluationVide,
  competencesDe,
  datesDeLaCampagneSchema,
  evaluationDuN1Vide,
  partieReserveeVide,
  type AutoEvaluation,
  type EcritureDeLEvaluation,
  type SessionUser,
} from '@teranga/contracts';
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
    // L'adresse professionnelle de l'agent, et le sexe inscrit au dossier du N+1 (ADR-0224).
    await raw(`UPDATE employees SET work_email = 'moussa.sarr@camp.test' WHERE id = $1`, [
      agents.moussa,
    ]);
    await raw(
      `UPDATE persons SET gender = 'female' WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [agents.awa],
    );
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
      email: 'moussa.sarr@camp.test',
      evaluateur: {
        prenom: 'Awa',
        nom: 'Diop',
        poste: 'Responsable du département',
        genre: 'female',
      },
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
      genre: 'female',
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

describe('l’auto-évaluation (ADR-0215)', () => {
  const OBJ1 = randomUUID();
  const OBJ2 = randomUUID();
  const brouillon: AutoEvaluation = {
    ...autoEvaluationVide(),
    vecu: 'Une année chargée, avec la reprise des dossiers.',
    objectifs: {
      [OBJ1]: { niveau: 'B', resultats: '', commentaire: '' },
      // Un objectif qui n'est pas sur la fiche : il ne s'enregistre pas.
      [randomUUID()]: { niveau: 'A', resultats: 'Hors fiche.', commentaire: '' },
    },
  };
  const complete: AutoEvaluation = {
    ...brouillon,
    difficultes: 'Non.',
    objectifs: {
      [OBJ1]: { niveau: 'B', resultats: 'Délai de 48 heures tenu.', commentaire: '' },
      [OBJ2]: {
        niveau: 'C',
        resultats: 'Deux tiers des dossiers à jour.',
        commentaire: 'Archives.',
      },
    },
  };

  beforeAll(async () => {
    await raw(`UPDATE fiches_entretien SET objectifs = $1::jsonb WHERE employee_id = $2`, [
      JSON.stringify([
        { id: OBJ1, intitule: 'Délivrer les attestations sous 48 heures', indicateurs: 'Délai' },
        { id: OBJ2, intitule: 'Tenir à jour les dossiers du personnel', indicateurs: '' },
      ]),
      agents.ibou,
    ]);
    await periode(-2, 3, 10);
  });

  it('se lit vide, avec les objectifs de la fiche, ouverte à l’écriture', async () => {
    const v = await campagne.monAuto(session('ibou'));
    expect(v.objectifs.map((o) => o.id)).toEqual([OBJ1, OBJ2]);
    expect(v.auto).toEqual(autoEvaluationVide());
    expect([v.etat, v.modifiable, v.evaluateur?.nom]).toEqual(['a_faire', true, 'Diop']);
  });

  it('garde le brouillon, que le N+1 ne lit pas', async () => {
    const v = await campagne.enregistrerMonAuto(session('ibou'), brouillon);
    expect(v.etat).toBe('en_cours');
    expect(v.auto.vecu).toBe(brouillon.vecu);
    expect(Object.keys(v.auto.objectifs)).toEqual([OBJ1]);
    const vu = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect(vu.objectifs).toHaveLength(2);
    expect(vu.autoEvaluation).toBeNull();
  });

  it('ne part pas incomplète, et dit ce qui manque', async () => {
    await expect(campagne.transmettreMonAuto(session('ibou'), brouillon)).rejects.toMatchObject({
      problem: {
        status: 422,
        code: 'campagne.auto_incomplete',
        detail:
          'À compléter : les difficultés rencontrées, les résultats de l’objectif 1, ' +
          'le niveau de l’objectif 2, les résultats de l’objectif 2.',
      },
    });
    expect((await campagne.monAuto(session('ibou'))).etat).toBe('en_cours');
  });

  it('complète, part au N+1, qui la lit ; elle ne change plus', async () => {
    const v = await campagne.transmettreMonAuto(session('ibou'), complete);
    expect([v.etat, v.modifiable, v.transmiseLe]).toEqual(['transmise', false, AUJOURD_HUI]);
    const vu = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect(vu.autoEvaluation?.difficultes).toBe('Non.');
    expect(vu.autoEvaluation?.objectifs[OBJ2]?.niveau).toBe('C');
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.auto.etat).toBe('transmise');
    await expect(campagne.enregistrerMonAuto(session('ibou'), complete)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.auto_transmise' },
    });
  });

  it('se ferme quand la période de l’auto-évaluation est passée', async () => {
    await periode(-8, -3, 10);
    expect((await campagne.monAuto(session('fatou'))).modifiable).toBe(false);
    await expect(
      campagne.enregistrerMonAuto(session('fatou'), autoEvaluationVide()),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.auto_fermee' } });
    await periode(-2, 3, 10);
  });

  it('n’existe ni au sommet de l’organigramme, ni pour un stage, ni sans dossier', async () => {
    for (const qui of ['dg', 'lamine', 'admin'] as const) {
      await expect(campagne.monAuto(session(qui))).rejects.toMatchObject({
        problem: { status: 404, code: 'campagne.sans_auto_evaluation' },
      });
    }
  });
});

describe('l’évaluation du N+1 (ADR-0216)', () => {
  /** Toutes les compétences d'une fiche au niveau B, le management laissé de côté. */
  const competencesB = (personnel: 'cadre' | 'non_cadre') =>
    Object.fromEntries(
      competencesDe(personnel)
        .filter((c) => !c.cadres)
        .map((c) => [c.cle, 'B' as const]),
    );

  it('s’ouvre au N+1 une fois l’auto-évaluation transmise, vide', async () => {
    const v = await campagne.agentDeLEquipe(session('awa'), agents.moussa);
    expect([v.etatDeLEvaluation, v.modifiable]).toEqual(['a_faire', true]);
    expect(v.evaluation).toEqual(evaluationDuN1Vide());
    expect(v.reservee).toEqual(partieReserveeVide());
    // Fatou Sall n'a pas transmis : pas d'évaluation.
    expect((await campagne.agentDeLEquipe(session('awa'), agents.fatou)).modifiable).toBe(false);
    await expect(
      campagne.enregistrerEvaluation(session('awa'), agents.fatou, {
        evaluation: evaluationDuN1Vide(),
        reservee: partieReserveeVide(),
      }),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.auto_non_transmise' } });
  });

  it('garde le brouillon : les objectifs de la fiche, les compétences de l’agent', async () => {
    const { objectifs } = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    const [o1] = objectifs;
    const v = await campagne.enregistrerEvaluation(session('awa'), agents.ibou, {
      evaluation: {
        ...evaluationDuN1Vide(),
        objectifs: {
          [o1!.id]: { niveau: 'B', commentaire: 'Délai tenu.' },
          [randomUUID()]: { niveau: 'A', commentaire: 'Hors fiche.' },
        },
        // Ibou Ndiaye n'est pas cadre : le management ne s'enregistre pas.
        competences: { connaissances: 'B', management: 'A' },
      },
      reservee: { comprehension: 'B', tenue: null, observations: 'Bonne année.' },
    });
    expect(v.etatDeLEvaluation).toBe('en_cours');
    expect(Object.keys(v.evaluation.objectifs)).toEqual([o1!.id]);
    expect(v.evaluation.competences).toEqual({ connaissances: 'B' });
    expect(v.reservee.comprehension).toBe('B');
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.evaluation).toBe('en_cours');
  });

  it('ne part pas incomplète, et dit ce qui manque', async () => {
    const v = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    const erreur = await campagne
      .transmettreEvaluation(session('awa'), agents.ibou, {
        evaluation: v.evaluation,
        reservee: v.reservee,
      })
      .then(
        () => null,
        (e: { problem: { status: number; code: string; detail: string } }) => e.problem,
      );
    expect(erreur).toMatchObject({ status: 422, code: 'campagne.evaluation_incomplete' });
    expect(erreur?.detail).toContain('l’appréciation de l’objectif 2');
    expect(erreur?.detail).toContain('la compétence « Qualité du travail »');
    expect(erreur?.detail).toContain('les points forts');
    expect(erreur?.detail).toContain('la tenue du poste');
    expect(erreur?.detail).not.toContain('Management');
  });

  it('complète, part à l’agent ; elle ne change plus', async () => {
    const v = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    const complete: EcritureDeLEvaluation = {
      evaluation: {
        ...v.evaluation,
        objectifs: Object.fromEntries(
          v.objectifs.map((o) => [o.id, { niveau: 'B' as const, commentaire: '' }]),
        ),
        competences: competencesB('non_cadre'),
        pointsForts: 'Rigueur et disponibilité.',
        axesDeDeveloppement: 'Déléguer davantage.',
        // Une ligne ajoutée puis laissée vide ne part pas.
        plan: [
          { action: 'Tutorat par un pair', delai: '3 mois', suivi: '' },
          { action: ' ', delai: '', suivi: '' },
        ],
        objectifsAVenir: [{ objectif: '', indicateur: '', echeance: null }],
      },
      reservee: { comprehension: 'B', tenue: 'A', observations: '' },
    };
    const t = await campagne.transmettreEvaluation(session('awa'), agents.ibou, complete);
    expect([t.etatDeLEvaluation, t.modifiable, t.evaluationTransmiseLe]).toEqual([
      'transmise',
      false,
      AUJOURD_HUI,
    ]);
    expect(t.evaluation.plan).toEqual([
      { action: 'Tutorat par un pair', delai: '3 mois', suivi: '' },
    ]);
    expect(t.evaluation.objectifsAVenir).toEqual([]);
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.evaluation).toBe('transmise');
    await expect(
      campagne.enregistrerEvaluation(session('awa'), agents.ibou, complete),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.evaluation_transmise' } });
  });

  it('pour le personnel cadre, le management se remplit s’il y a lieu', async () => {
    const t = await campagne.transmettreEvaluation(session('awa'), agents.moussa, {
      evaluation: {
        ...evaluationDuN1Vide(),
        competences: competencesB('cadre'),
        pointsForts: 'Autonomie.',
        axesDeDeveloppement: 'Prise de parole.',
      },
      reservee: { comprehension: 'A', tenue: 'B', observations: '' },
    });
    expect(t.etatDeLEvaluation).toBe('transmise');
    expect(t.evaluation.competences.management).toBeUndefined();
  });

  it('ne s’ouvre qu’à l’évaluateur, et pendant la période', async () => {
    const vide = { evaluation: evaluationDuN1Vide(), reservee: partieReserveeVide() };
    await expect(
      campagne.enregistrerEvaluation(session('fatou'), agents.moussa, vide),
    ).rejects.toMatchObject({ problem: { status: 404, code: 'campagne.agent_hors_equipe' } });
    // Ousmane Fall a transmis ; son évaluateur pour la campagne est Cheikh Mbaye.
    await raw(
      `UPDATE fiches_entretien SET auto = '{}'::jsonb, auto_transmise_le = now()
        WHERE employee_id = $1`,
      [agents.ousmane],
    );
    await periode(-20, -15, -1);
    await expect(
      campagne.enregistrerEvaluation(session('dg'), agents.ousmane, vide),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.evaluation_fermee' } });
    await periode(-2, 3, 10);
    const v = await campagne.enregistrerEvaluation(session('dg'), agents.ousmane, vide);
    expect(v.etatDeLEvaluation).toBe('en_cours');
  });
});

describe('la validation par l’agent (ADR-0217)', () => {
  it('se lit une fois transmise, sans le brouillon du N+1 ni la partie réservée', async () => {
    // Cheikh Mbaye a commencé l'évaluation d'Ousmane Fall, sans la transmettre.
    const attente = await campagne.monEvaluation(session('ousmane'));
    expect([attente.etat, attente.evaluation, attente.validable]).toEqual([
      'en_attente',
      null,
      false,
    ]);
    await expect(campagne.validerMonEvaluation(session('ousmane'))).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.evaluation_non_transmise' },
    });

    const v = await campagne.monEvaluation(session('ibou'));
    expect([v.etat, v.transmiseLe, v.validable, v.renvoyable]).toEqual([
      'a_valider',
      AUJOURD_HUI,
      true,
      true,
    ]);
    expect(v.personnel).toBe('non_cadre');
    expect(v.evaluation?.pointsForts).toBe('Rigueur et disponibilité.');
    expect(v.evaluateur).toMatchObject({ prenom: 'Awa', nom: 'Diop' });
    expect(JSON.stringify(v)).not.toContain('comprehension');
    expect((await campagne.accueil(session('ibou'))).monEvaluation).toEqual({
      etat: 'a_valider',
      transmiseLe: AUJOURD_HUI,
      valideeLe: null,
      renvoyeeLe: null,
    });
  });

  it('en désaccord, repart au N+1 avec un mot ; le N+1 la reprend et la transmet', async () => {
    const mot = 'Le niveau de l’objectif 2 ne tient pas compte du retard des données.';
    const r = await campagne.renvoyerMonEvaluation(session('ibou'), mot);
    expect([r.etat, r.evaluation, r.validable, r.renvoyeeLe]).toEqual([
      'renvoyee',
      null,
      false,
      AUJOURD_HUI,
    ]);
    expect(r.renvoi).toEqual({ mot, le: AUJOURD_HUI });

    const n1 = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect([n1.etatDeLEvaluation, n1.modifiable, n1.evaluationTransmiseLe]).toEqual([
      'renvoyee',
      true,
      null,
    ]);
    expect(n1.renvoi?.mot).toBe(mot);
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.evaluation).toBe('renvoyee');
    await expect(campagne.validerMonEvaluation(session('ibou'))).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.evaluation_non_transmise' },
    });

    const t = await campagne.transmettreEvaluation(session('awa'), agents.ibou, {
      evaluation: {
        ...n1.evaluation,
        objectifs: Object.fromEntries(
          n1.objectifs.map((o) => [o.id, { niveau: 'B' as const, commentaire: 'Revu.' }]),
        ),
      },
      reservee: n1.reservee,
    });
    expect([t.etatDeLEvaluation, t.renvoi]).toEqual(['transmise', null]);
    expect((await campagne.monEvaluation(session('ibou'))).etat).toBe('a_valider');
  });

  it('validée, elle ne change plus : ni renvoi, ni écriture du N+1', async () => {
    const v = await campagne.validerMonEvaluation(session('ibou'));
    expect([v.etat, v.valideeLe, v.validable, v.renvoyable]).toEqual([
      'validee',
      AUJOURD_HUI,
      false,
      false,
    ]);
    expect(v.evaluation?.pointsForts).toBe('Rigueur et disponibilité.');
    for (const geste of [
      () => campagne.validerMonEvaluation(session('ibou')),
      () => campagne.renvoyerMonEvaluation(session('ibou'), 'Trop tard.'),
    ]) {
      await expect(geste()).rejects.toMatchObject({
        problem: { status: 409, code: 'campagne.evaluation_validee' },
      });
    }
    await expect(
      campagne.enregistrerEvaluation(session('awa'), agents.ibou, {
        evaluation: evaluationDuN1Vide(),
        reservee: partieReserveeVide(),
      }),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.evaluation_validee' } });
    const n1 = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect([n1.etatDeLEvaluation, n1.valideeLe, n1.modifiable]).toEqual([
      'validee',
      AUJOURD_HUI,
      false,
    ]);
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.evaluation).toBe('validee');
  });

  it('après la période, le renvoi se ferme ; la validation, non', async () => {
    await periode(-20, -15, -1);
    expect((await campagne.monEvaluation(session('moussa'))).renvoyable).toBe(false);
    await expect(
      campagne.renvoyerMonEvaluation(session('moussa'), 'À revoir.'),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.evaluation_fermee' } });
    expect((await campagne.validerMonEvaluation(session('moussa'))).etat).toBe('validee');
    await periode(-2, 3, 10);
  });

  it('n’existe pas sans évaluation : au sommet, en stage, sans dossier', async () => {
    for (const qui of ['dg', 'lamine', 'admin'] as const) {
      await expect(campagne.monEvaluation(session(qui))).rejects.toMatchObject({
        problem: { status: 404, code: 'campagne.sans_auto_evaluation' },
      });
    }
    expect((await campagne.accueil(session('dg'))).monEvaluation).toBeNull();
    expect((await campagne.accueil(session('fatou'))).monEvaluation?.etat).toBe('en_attente');
  });
});

describe('les commentaires du N+2 (ADR-0218)', () => {
  it('le N+2 voit les équipes de ses N+1, où qu’en soient les fiches', async () => {
    // Cheikh Mbaye évalue Awa Diop, qui évalue Ibou Ndiaye, Fatou Sall et Moussa Sarr.
    const { aCommenter, equipe } = await campagne.accueil(session('dg'));
    expect(aCommenter.map((a) => [a.employeeId, a.commentaires])).toEqual([
      [agents.ibou, 'a_commenter'],
      [agents.fatou, 'en_attente'],
      [agents.moussa, 'a_commenter'],
    ]);
    expect(aCommenter[0]!.n1).toMatchObject({ prenom: 'Awa', nom: 'Diop' });
    // Au sommet de l'organigramme, son équipe n'a pas de N+2.
    expect(equipe.every((a) => a.commentaires === null)).toBe(true);
    const awa = await campagne.accueil(session('awa'));
    expect(awa.aCommenter).toEqual([]);
    expect(awa.equipe.find((a) => a.employeeId === agents.ibou)?.commentaires).toBe('a_commenter');
  });

  it('s’ouvre au N+2 en entier, partie réservée comprise, une fois validée par l’agent', async () => {
    const v = await campagne.ficheDuN2(session('dg'), agents.ibou);
    expect([v.etat, v.modifiable, v.valideeLe]).toEqual(['a_commenter', true, AUJOURD_HUI]);
    expect(v.fiche?.reservee.comprehension).toBe('B');
    expect(v.fiche?.evaluation.pointsForts).toBe('Rigueur et disponibilité.');
    expect(v.agent.evaluateur).toMatchObject({ prenom: 'Awa', nom: 'Diop' });

    const attente = await campagne.ficheDuN2(session('dg'), agents.fatou);
    expect([attente.etat, attente.fiche, attente.modifiable]).toEqual(['en_attente', null, false]);
    await expect(
      campagne.enregistrerCommentaires(session('dg'), agents.fatou, 'Trop tôt.'),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.fiche_non_validee' } });

    // Le N+1 n'est pas le N+2 ; sans N+2 (le N+1 au sommet), personne ne l'est.
    for (const [qui, agent] of [
      ['awa', agents.ibou],
      ['dg', agents.ousmane],
      ['fatou', agents.moussa],
    ] as const) {
      await expect(campagne.ficheDuN2(session(qui), agent)).rejects.toMatchObject({
        problem: { status: 404, code: 'campagne.agent_hors_perimetre' },
      });
    }
  });

  it('garde le brouillon, que le N+1 ne lit pas', async () => {
    const v = await campagne.enregistrerCommentaires(session('dg'), agents.ibou, 'Brouillon.');
    expect([v.etat, v.commentaires]).toEqual(['en_cours', 'Brouillon.']);
    const n1 = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect(n1.n2).toMatchObject({ prenom: 'Cheikh', nom: 'Mbaye' });
    expect([n1.etatDesCommentaires, n1.commentairesDuN2]).toEqual(['en_cours', null]);
    expect((await campagne.agentDeLEquipe(session('dg'), agents.ousmane)).n2).toBeNull();
  });

  it('transmis au N+1, ils ne changent plus ; l’agent ne les lit jamais', async () => {
    const texte = 'Un agent fiable, à préparer à plus de responsabilités.';
    const v = await campagne.transmettreCommentaires(session('dg'), agents.ibou, texte);
    expect([v.etat, v.transmisLe, v.modifiable, v.commentaires]).toEqual([
      'transmis',
      AUJOURD_HUI,
      false,
      texte,
    ]);
    await expect(
      campagne.transmettreCommentaires(session('dg'), agents.ibou, 'Encore.'),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.commentaires_transmis' } });
    const n1 = await campagne.agentDeLEquipe(session('awa'), agents.ibou);
    expect(n1.etatDesCommentaires).toBe('transmis');
    expect(n1.commentairesDuN2).toEqual({
      texte,
      le: AUJOURD_HUI,
      par: { prenom: 'Cheikh', nom: 'Mbaye', poste: 'Direction générale' },
    });
    expect(JSON.stringify(await campagne.monEvaluation(session('ibou')))).not.toContain('fiable');
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.commentaires).toBe('transmis');
  });

  it('sans un mot, la fiche revient au N+1 sans commentaire', async () => {
    const v = await campagne.transmettreCommentaires(session('dg'), agents.moussa, '');
    expect([v.etat, v.commentaires]).toEqual(['transmis', '']);
    expect(
      (await campagne.agentDeLEquipe(session('awa'), agents.moussa)).commentairesDuN2?.texte,
    ).toBe('');
  });
});

describe('la transmission à la DCH (ADR-0221)', () => {
  it('le N+1 transmet la fiche une fois les commentaires du N+2 reçus ; elle ne change plus', async () => {
    const avant = await campagne.accueil(session('awa'));
    expect(avant.equipe.find((a) => a.employeeId === agents.ibou)?.dch).toBe('a_transmettre');
    expect(avant.equipe.find((a) => a.employeeId === agents.fatou)?.dch).toBe('en_attente');

    const v = await campagne.transmettreALaDCH(session('awa'), agents.ibou);
    expect([v.dch, v.transmiseALaDCHLe, v.modifiable]).toEqual(['transmise', AUJOURD_HUI, false]);
    const { equipe } = await campagne.accueil(session('awa'));
    expect(equipe.find((a) => a.employeeId === agents.ibou)?.dch).toBe('transmise');

    await expect(campagne.transmettreALaDCH(session('awa'), agents.ibou)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_transmise' },
    });
    await expect(campagne.transmettreALaDCH(session('awa'), agents.fatou)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_non_validee' },
    });
    // Le N+2 ne la transmet pas : la transmission revient à l'évaluateur de l'agent.
    await expect(campagne.transmettreALaDCH(session('dg'), agents.ibou)).rejects.toMatchObject({
      problem: { status: 404, code: 'campagne.agent_hors_equipe' },
    });
  });

  it('chez le N+2, elle attend ; le N+1 la reprend, la renvoie au N+2, ou la transmet', async () => {
    // Le N+2 de Moussa Sarr n'a pas encore transmis ses commentaires.
    await raw(
      `UPDATE fiches_entretien SET commentaires_n2 = 'Brouillon du N+2.',
              commentaires_n2_transmis_le = NULL
        WHERE employee_id = $1 AND annee = $2`,
      [agents.moussa, ANNEE],
    );
    const attente = await campagne.agentDeLEquipe(session('awa'), agents.moussa);
    expect([attente.etatDesCommentaires, attente.dch]).toEqual(['en_cours', 'en_attente']);
    await expect(campagne.transmettreALaDCH(session('awa'), agents.moussa)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_chez_le_n2' },
    });

    const reprise = await campagne.reprendreAuN2(session('awa'), agents.moussa);
    expect([reprise.etatDesCommentaires, reprise.dch, reprise.repriseAuN2Le]).toEqual([
      'reprise',
      'a_transmettre',
      AUJOURD_HUI,
    ]);
    // Le N+2 ne l'ouvre plus, ni ne la commente.
    await expect(campagne.ficheDuN2(session('dg'), agents.moussa)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_reprise' },
    });
    await expect(
      campagne.enregistrerCommentaires(session('dg'), agents.moussa, 'Encore.'),
    ).rejects.toMatchObject({ problem: { status: 409, code: 'campagne.fiche_reprise' } });
    const { aCommenter } = await campagne.accueil(session('dg'));
    expect(aCommenter.find((a) => a.employeeId === agents.moussa)?.commentaires).toBe('reprise');
    await expect(campagne.reprendreAuN2(session('awa'), agents.moussa)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_pas_chez_le_n2' },
    });

    // Renvoyée au N+2, qui retrouve son brouillon.
    const renvoyee = await campagne.renvoyerAuN2(session('awa'), agents.moussa);
    expect([renvoyee.etatDesCommentaires, renvoyee.dch, renvoyee.repriseAuN2Le]).toEqual([
      'en_cours',
      'en_attente',
      null,
    ]);
    expect((await campagne.ficheDuN2(session('dg'), agents.moussa)).commentaires).toBe(
      'Brouillon du N+2.',
    );

    await campagne.reprendreAuN2(session('awa'), agents.moussa);
    const transmise = await campagne.transmettreALaDCH(session('awa'), agents.moussa);
    expect([transmise.dch, transmise.etatDesCommentaires]).toEqual(['transmise', 'reprise']);
    await expect(campagne.renvoyerAuN2(session('awa'), agents.moussa)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_transmise' },
    });
  });

  it('sans N+2, elle part dès la validation de l’agent', async () => {
    // Cheikh Mbaye, au sommet de l'organigramme, évalue Ousmane Fall.
    await raw(
      `UPDATE fiches_entretien SET evaluation_transmise_le = now(), validee_le = now()
        WHERE employee_id = $1 AND annee = $2`,
      [agents.ousmane, ANNEE],
    );
    const { equipe } = await campagne.accueil(session('dg'));
    const ousmane = equipe.find((a) => a.employeeId === agents.ousmane);
    expect([ousmane?.commentaires, ousmane?.dch]).toEqual([null, 'a_transmettre']);
    await expect(campagne.reprendreAuN2(session('dg'), agents.ousmane)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_pas_chez_le_n2' },
    });
    expect((await campagne.transmettreALaDCH(session('dg'), agents.ousmane)).dch).toBe('transmise');
  });

  it('la DCH suit chaque fiche de l’année, et lit en entier celles qui lui sont transmises', async () => {
    for (const geste of [
      () => campagne.suiviDeLaDCH(session('awa')),
      () => campagne.ficheDeLaDCH(session('awa'), agents.ibou),
      () => campagne.pdfDeLaDCH(session('awa'), agents.ibou),
    ]) {
      await expect(geste()).rejects.toMatchObject({ problem: { status: 403 } });
    }
    // L'habilitation « Tableau de bord », confiée par la DCH, ou l'administration.
    const dch = { ...session('fatou'), capacites: ['pilotage'] } as SessionUser;
    const suivi = await campagne.suiviDeLaDCH(dch);
    expect(suivi.fiches.map((f) => [f.nom, f.etape])).toEqual([
      ['Diop', 'auto_a_faire'],
      ['Fall', 'transmise'],
      ['Ndiaye', 'transmise'],
      ['Sall', 'auto_en_cours'],
      ['Sarr', 'transmise'],
    ]);
    expect(suivi.fiches[2]).toMatchObject({
      direction: 'DCH',
      n1: { prenom: 'Awa', nom: 'Diop' },
      transmiseLe: AUJOURD_HUI,
    });
    expect((await campagne.accueil(session('admin'))).dch).toEqual({ fiches: 5, transmises: 3 });
    expect((await campagne.accueil(session('awa'))).dch).toBeNull();

    await expect(campagne.ficheDeLaDCH(dch, agents.fatou)).rejects.toMatchObject({
      problem: { status: 409, code: 'campagne.fiche_non_transmise' },
    });
    const f = await campagne.ficheDeLaDCH(session('admin'), agents.ibou);
    expect(f.fiche.reservee.comprehension).toBe('B');
    expect(f.commentairesDuN2?.texte).toBe(
      'Un agent fiable, à préparer à plus de responsabilités.',
    );
    expect([f.transmiseLe, f.valideeLe, f.repriseAuN2Le]).toEqual([AUJOURD_HUI, AUJOURD_HUI, null]);
    expect(f.transmisePar).toMatchObject({ prenom: 'Awa', nom: 'Diop' });
    expect(f.n2).toMatchObject({ prenom: 'Cheikh', nom: 'Mbaye' });

    const { filename, pdf } = await campagne.pdfDeLaDCH(dch, agents.ibou);
    expect(filename).toBe(`fiche-entretien-${ANNEE}-CAMP-IBOU-complete.pdf`);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('l’administration de la campagne (ADR-0222)', () => {
  it('est réservée aux comptes d’administration', async () => {
    for (const geste of [
      () => campagne.administration(session('awa')),
      () => campagne.fixerLesDates(session('awa'), { du: jour(-2), autoAu: jour(3), au: jour(10) }),
      () => campagne.choisirLEvaluateur(session('awa'), agents.fatou, agents.dg),
    ]) {
      await expect(geste()).rejects.toMatchObject({
        problem: { status: 403, code: 'campagne.administration_reservee' },
      });
    }
    expect((await campagne.accueil(session('admin'))).administration).toBe(true);
    expect((await campagne.accueil(session('awa'))).administration).toBe(false);
  });

  it('liste les agents à évaluer, leur N+1 dans l’organigramme et le choix de l’administration', async () => {
    const { agents: liste } = await campagne.administration(session('admin'));
    // Le sommet de l'organigramme et les stages restent hors de la campagne.
    expect(liste.map((a) => a.nom)).toEqual(['Diop', 'Fall', 'Ndiaye', 'Sall', 'Sarr']);
    const ibou = liste.find((a) => a.employeeId === agents.ibou)!;
    expect(ibou.organigramme).toMatchObject({ prenom: 'Cheikh', nom: 'Mbaye' });
    expect(ibou.choisi).toMatchObject({ prenom: 'Awa', nom: 'Diop', matricule: 'CAMP-AWA' });
    const fatou = liste.find((a) => a.employeeId === agents.fatou)!;
    expect([fatou.organigramme?.nom, fatou.choisi, fatou.transmise]).toEqual(['Diop', null, false]);
    expect(ibou.transmise).toBe(true);
  });

  it('fixe les dates : le début, la fin de l’auto-évaluation, la fin', async () => {
    const v = await campagne.fixerLesDates(session('admin'), {
      du: jour(-4),
      autoAu: jour(1),
      au: jour(12),
    });
    expect(v.periode).toEqual({ du: jour(-4), autoAu: jour(1), au: jour(12) });
    expect((await campagne.accueil(session('moussa'))).periode?.autoAu).toBe(jour(1));
    // Les dates se suivent, et la période commence dans l'année évaluée ou la suivante.
    expect(
      datesDeLaCampagneSchema.safeParse({ du: jour(5), autoAu: jour(2), au: jour(9) }).success,
    ).toBe(false);
    await expect(
      campagne.fixerLesDates(session('admin'), {
        du: `${ANNEE + 2}-01-05`,
        autoAu: `${ANNEE + 2}-01-10`,
        au: `${ANNEE + 2}-01-20`,
      }),
    ).rejects.toMatchObject({ problem: { status: 422, code: 'campagne.dates_hors_annee' } });
    await periode(-2, 3, 10);
  });

  it('choisit librement l’évaluateur, puis revient à l’organigramme', async () => {
    // Fatou Sall a Awa Diop pour N+1 dans l'organigramme ; Cheikh Mbaye l'évalue pour la campagne.
    const v = await campagne.choisirLEvaluateur(session('admin'), agents.fatou, agents.dg);
    expect(v.agents.find((a) => a.employeeId === agents.fatou)?.choisi?.nom).toBe('Mbaye');
    expect((await campagne.accueil(session('dg'))).equipe.map((a) => a.employeeId)).toContain(
      agents.fatou,
    );
    expect((await campagne.accueil(session('awa'))).equipe.map((a) => a.employeeId)).not.toContain(
      agents.fatou,
    );
    // Choisir le N+1 de l'organigramme, c'est revenir à l'organigramme.
    const retour = await campagne.choisirLEvaluateur(session('admin'), agents.fatou, agents.awa);
    expect(retour.agents.find((a) => a.employeeId === agents.fatou)?.choisi).toBeNull();
    await campagne.choisirLEvaluateur(session('admin'), agents.fatou, agents.dg);
    const sans = await campagne.choisirLEvaluateur(session('admin'), agents.fatou, null);
    expect(sans.agents.find((a) => a.employeeId === agents.fatou)?.choisi).toBeNull();
    expect((await campagne.accueil(session('awa'))).equipe.map((a) => a.employeeId)).toContain(
      agents.fatou,
    );
  });

  it('refuse l’agent comme son propre évaluateur, un évaluateur inconnu, une fiche transmise, un agent hors campagne', async () => {
    for (const [agent, evaluateur, status, code] of [
      [agents.fatou, agents.fatou, 422, 'campagne.evaluateur_soi_meme'],
      [agents.fatou, randomUUID(), 422, 'campagne.evaluateur_introuvable'],
      [agents.ibou, agents.dg, 409, 'campagne.fiche_transmise'],
      [agents.dg, agents.awa, 404, 'campagne.agent_introuvable'],
      [agents.lamine, agents.awa, 404, 'campagne.agent_introuvable'],
    ] as const) {
      await expect(
        campagne.choisirLEvaluateur(session('admin'), agent, evaluateur),
      ).rejects.toMatchObject({ problem: { status, code } });
    }
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
