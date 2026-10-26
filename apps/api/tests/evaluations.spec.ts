/**
 * L'évaluation annuelle sur la grille de l'APIX (ADR-0149), contre la base.
 *
 * L'organigramme du test :
 *
 *   Direction Générale (Cheikh, le DG)
 *   └─ Direction du Capital Humain (Mariama, qui la dirige ; Ndèye, de la DCH)
 *        └─ Département Études (Awa, N+1 Mariama)
 *             ├─ Moussa, cadre, N+1 Awa
 *             ├─ Khady, cadre, N+1 Awa, qui encadre Ibou (non cadre)
 *             ├─ Aïssatou, cadre, N+1 Awa
 *             ├─ Fatou, non cadre ; Ousmane, à renseigner
 *             └─ Lamine, en stage
 *
 * On vérifie que la DCH fixe la période, que le N+1 remplit la grille de
 * chacun de ses agents, que l'agent la lit sans la page 6, la valide ou la
 * renvoie, que le N+2 est facultatif et ne bloque jamais, et que la DCH
 * suit les grilles et reçoit leur PDF. Le texte mis en forme (ADR-0150), les
 * échéances des objectifs à venir et les formations de l'APIX Academy
 * proposées au N+1 ont leurs propres cas.
 *
 * La période se pose autour d'aujourd'hui : le test ne dépend pas du jour où
 * il tourne.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  besoinsDeFormation,
  ceQuiManque,
  champsTropLongs,
  contenuDeGrilleSchema,
  CRITERES_CADRE,
  grilleVide,
  periodeDEvaluationEnLettres,
  texteBrut,
  texteRicheDe,
  type ContenuDeGrille,
  type SessionUser,
  type TexteRiche,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademySuiviService } from '../src/modules/academy/academy-suivi.service';
import { annoncerLOuverture, reconcilierLesGrilles } from '../src/modules/evaluations/circuit';
import { EvaluationsService } from '../src/modules/evaluations/evaluations.service';
import { grilleDuPersonnelCadre, initiales } from '../src/modules/evaluations/grille-cadre';

const env = loadEnv();
const tenantId = randomUUID();

/** Un jour autour d'aujourd'hui, AAAA-MM-JJ. */
const jour = (decalage: number) =>
  new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
const DU = jour(-10);
const AU = jour(20);
const ANNEE = Number(DU.slice(0, 4));

type Nom =
  | 'dg'
  | 'mariama'
  | 'ndeye'
  | 'awa'
  | 'moussa'
  | 'khady'
  | 'ibou'
  | 'aissatou'
  | 'fatou'
  | 'ousmane'
  | 'lamine';
const NOMS: Nom[] = [
  'dg',
  'mariama',
  'ndeye',
  'awa',
  'moussa',
  'khady',
  'ibou',
  'aissatou',
  'fatou',
  'ousmane',
  'lamine',
];
const comptes = Object.fromEntries(NOMS.map((n) => [n, randomUUID()])) as Record<Nom, string>;
const agents = Object.fromEntries(NOMS.map((n) => [n, randomUUID()])) as Record<Nom, string>;
const unites = { generale: randomUUID(), dch: randomUUID(), etudes: randomUUID() };
/** Les formations de l'APIX Academy : Moussa a terminé « Excel », et anime « Accueil ». */
const cours = { gestion: randomUUID(), excel: randomUUID(), accueil: randomUUID() };

/** La DCH : Mariama la dirige ; Ndèye en suit le tableau de bord. */
const session = (qui: Nom) =>
  ({
    userId: comptes[qui],
    tenantId,
    role: 'employee',
    capacites: qui === 'mariama' || qui === 'ndeye' ? ['pilotage'] : [],
    dirigeLaDCH: qui === 'mariama',
  }) as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let evaluations: EvaluationsService;

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

async function agent(
  qui: Nom,
  prenom: string,
  nom: string,
  n1: Nom | null,
  unite: string,
  poste: string,
  personnel: 'cadre' | 'non_cadre' | null,
  depuis = '2020-01-01',
) {
  const personId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x',$3,$4)`,
    [comptes[qui], `eva-${qui}-${comptes[qui]}@test.local`, prenom, nom],
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
      `EVA-${qui.toUpperCase()}`,
      n1 ? agents[n1] : null,
      personnel,
    ],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,$5,daterange($6::date, NULL))`,
    [randomUUID(), tenantId, agents[qui], unite, poste, depuis],
  );
}

/** La boîte : ce qui a été remplacé par plus récent n'y est plus. */
async function titres(qui: Nom): Promise<string[]> {
  const { rows } = await raw(
    `SELECT title FROM notifications
      WHERE recipient_user_id = $1 AND remplacee_le IS NULL ORDER BY created_at`,
    [comptes[qui]],
  );
  return (rows as { title: string }[]).map((r) => r.title);
}

/** Une liste à puces, une ligne par élément. */
const puces = (...lignes: string[]): TexteRiche =>
  lignes.map((texte) => ({ type: 'puce', niveau: 0, segments: [{ texte }] }));

/** Une grille complète ; le commandement noté pour qui encadre. */
function complete(commandement = false): ContenuDeGrille {
  const vide = grilleVide();
  return {
    ...vide,
    objectifs: [
      { texte: texteRicheDe('Instruire les dossiers d’agrément dans les délais'), niveau: 'B' },
      { texte: texteRicheDe('Former deux collègues aux outils de suivi'), niveau: 'C' },
      { texte: [], niveau: null },
    ],
    raisons: texteRicheDe('La seconde formation a été reportée au début de l’année suivante.'),
    criteres: CRITERES_CADRE.map((c) => (c.commandement && !commandement ? null : 'B')),
    pointsForts: puces('Rigueur', 'Disponibilité'),
    pointsFaibles: texteRicheDe('Des délais parfois serrés.'),
    actions: texteRicheDe('Un atelier de planification.'),
    objectifsAVenir: [
      { texte: 'Réduire les délais d’instruction', echeance: `${ANNEE + 1}-06-30` },
    ],
    formations: [{ courseId: cours.gestion, titre: 'Gestion de projet' }],
    comprehension: 'A',
    tenue: 'B',
    observations: texteRicheDe('Agent fiable.'),
  };
}

/** Une formation publiée de l'APIX Academy, une leçon prête ; rend la leçon. */
async function formation(id: string, titre: string, formateur: Nom | null = null) {
  const moduleId = randomUUID();
  const lecon = randomUUID();
  await raw(
    `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id,
                                  formateur_employee_id, formateur_nom)
     VALUES ($1,$2,$3,'bureautique', now(), $4, $5, $6)`,
    [
      id,
      tenantId,
      titre,
      comptes.mariama,
      formateur ? agents[formateur] : null,
      formateur ? `Formateur ${formateur}` : null,
    ],
  );
  await raw(
    `INSERT INTO academy_modules (id, tenant_id, course_id, position, title) VALUES ($1,$2,$3,0,'Bases')`,
    [moduleId, tenantId, id],
  );
  await raw(
    `INSERT INTO academy_lessons (id, tenant_id, course_id, module_id, position, title,
       video_provider, video_uid, video_status, duration_seconds)
     VALUES ($1,$2,$3,$4,0,'Leçon 1','local',$5,'prete',60)`,
    [lecon, tenantId, id, moduleId, randomUUID()],
  );
  return lecon;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  evaluations = new EvaluationsService(db, new AcademySuiviService());

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Évaluations',$2)`, [
    tenantId,
    `evaluations-${tenantId.slice(0, 8)}`,
  ]);
  const unite = (id: string, type: string, nom: string, parent: string | null) =>
    raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id) VALUES ($1,$2,$3,$4,$5)`,
      [id, tenantId, type, nom, parent],
    );
  await unite(unites.generale, 'direction', 'Direction Générale', null);
  await unite(unites.dch, 'direction', 'Direction du Capital Humain', unites.generale);
  await unite(unites.etudes, 'department', 'Département Études', unites.dch);

  await agent('dg', 'Cheikh', 'Mbaye', null, unites.generale, 'Directeur Général', 'cadre');
  await agent('mariama', 'Mariama', 'Cissé', 'dg', unites.dch, 'Directrice', 'cadre');
  await agent('ndeye', 'Ndèye', 'Faye', 'mariama', unites.dch, 'Gestionnaire RH', 'cadre');
  await agent('awa', 'Awa', 'Diop', 'mariama', unites.etudes, 'Cheffe du département', 'cadre');
  // Arrivé à son poste il y a quatre mois : la case « agent nouveau » se coche d'office.
  await agent(
    'moussa',
    'Moussa',
    'Ndiaye',
    'awa',
    unites.etudes,
    'Chargé d’études',
    'cadre',
    jour(-125),
  );
  await agent('khady', 'Khady', 'Sarr', 'awa', unites.etudes, 'Cheffe de projet', 'cadre');
  await agent('ibou', 'Ibou', 'Faye', 'khady', unites.etudes, 'Assistant', 'non_cadre');
  await agent('aissatou', 'Aïssatou', 'Ba', 'awa', unites.etudes, 'Analyste', 'cadre');
  await agent('fatou', 'Fatou', 'Sall', 'awa', unites.etudes, 'Secrétaire', 'non_cadre');
  await agent('ousmane', 'Ousmane', 'Fall', 'awa', unites.etudes, 'Chauffeur', null);
  await agent('lamine', 'Lamine', 'Ba', 'awa', unites.etudes, 'Stagiaire', 'cadre');
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
     VALUES ($1,$2,$3,'stage',$4,$5)`,
    [randomUUID(), tenantId, agents.lamine, jour(-30), jour(60)],
  );

  // Les avis de l'évaluation restent dans la plateforme : sans courriel, ils
  // n'encombrent pas l'expéditeur que d'autres fichiers vident en parallèle.
  for (const qui of NOMS) {
    for (const sujet of ['evaluation', 'equipe.evaluations']) {
      await raw(
        `INSERT INTO notification_preferences (id, tenant_id, user_id, sujet, plateforme, courriel)
         VALUES ($1,$2,$3,$4,true,false)`,
        [randomUUID(), tenantId, comptes[qui], sujet],
      );
    }
  }

  for (const [id, chef] of [
    [unites.generale, agents.dg],
    [unites.dch, agents.mariama],
    [unites.etudes, agents.awa],
  ] as const) {
    await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [chef, id]);
  }

  await formation(cours.gestion, 'Gestion de projet');
  const excel = await formation(cours.excel, 'Excel avancé');
  await formation(cours.accueil, 'Accueil des investisseurs', 'moussa');
  await raw(
    `INSERT INTO academy_lesson_progress (tenant_id, employee_id, lesson_id, watched, watched_seconds,
                                          completed_at, updated_at)
     VALUES ($1,$2,$3,'[[0,60]]',60, now(), now())`,
    [tenantId, agents.moussa, excel],
  );
});

afterAll(async () => {
  await ownerPool?.end();
  await db?.pool.end();
});

describe('la période d’évaluation', () => {
  it('sans période ouverte, le N+1 ne remplit rien', async () => {
    expect(
      await codeOf(() => evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, complete())),
    ).toBe('evaluations.periode_fermee');
    const vue = await evaluations.grille(session('awa'), agents.moussa, ANNEE);
    expect(vue.periode).toBeNull();
    expect(vue.actions.enregistrer).toBe(false);
  });

  it('seule la personne qui dirige la DCH la fixe, sur l’année ou la suivante', async () => {
    expect(await codeOf(() => evaluations.periode(session('awa')))).toBe('auth.forbidden');
    expect(
      await codeOf(() => evaluations.fixerPeriode(session('ndeye'), ANNEE, { du: DU, au: AU })),
    ).toBe('evaluations.periode_reservee');
    expect(
      await codeOf(() =>
        evaluations.fixerPeriode(session('mariama'), ANNEE, {
          du: `${ANNEE + 2}-01-05`,
          au: `${ANNEE + 2}-01-20`,
        }),
      ),
    ).toBe('evaluations.periode_hors_annee');

    const fixee = await evaluations.fixerPeriode(session('mariama'), ANNEE, { du: DU, au: AU });
    expect(fixee.periode).toEqual({ annee: ANNEE, du: DU, au: AU });
    expect(fixee.annees).toEqual([ANNEE]);

    const lue = await evaluations.periode(session('ndeye'));
    expect(lue.annee).toBe(ANNEE);
    expect(lue.modifiable).toBe(false);
  });

  it('son ouverture prévient une fois chaque N+1 qui a des agents à évaluer', async () => {
    await db.withTenant({ tenantId }, (tx) => annoncerLOuverture(tx, tenantId));
    await db.withTenant({ tenantId }, (tx) => annoncerLOuverture(tx, tenantId));
    const annonce = `La période d’évaluation ${ANNEE} est ouverte ${periodeDEvaluationEnLettres({ du: DU, au: AU })}`;
    for (const qui of ['dg', 'mariama', 'awa', 'khady'] as Nom[]) {
      expect((await titres(qui)).filter((t) => t === annonce)).toHaveLength(1);
    }
    for (const qui of ['moussa', 'ibou', 'ndeye'] as Nom[]) {
      expect(await titres(qui)).not.toContain(annonce);
    }
  });
});

describe('l’équipe du N+1', () => {
  it('chaque agent à évaluer, sans stagiaire, avec où en est sa grille', async () => {
    const e = await evaluations.equipe(session('awa'));
    expect(e.annee).toBe(ANNEE);
    expect(e.ouverte).toBe(true);
    expect(e.lignes.map((l) => [l.nom, l.personnel, l.ouEnEst]).sort()).toEqual(
      [
        ['Aïssatou Ba', 'cadre', 'a_remplir'],
        ['Fatou Sall', 'non_cadre', 'a_remplir'],
        ['Khady Sarr', 'cadre', 'a_remplir'],
        ['Moussa Ndiaye', 'cadre', 'a_remplir'],
        ['Ousmane Fall', null, 'a_remplir'],
      ].sort(),
    );
  });

  it('personne n’évalue le DG', async () => {
    const duDG = await evaluations.equipe(session('dg'));
    expect(duDG.lignes.map((l) => l.nom)).toEqual(['Mariama Cissé']);
    const suivi = await evaluations.suivi(session('ndeye'));
    expect(suivi.lignes.map((l) => l.nom)).not.toContain('Cheikh Mbaye');
    expect(suivi.lignes.map((l) => l.nom)).not.toContain('Lamine Ba');
  });
});

describe('le remplissage', () => {
  it('la grille suit la fiche : cadre, non cadre, ou à renseigner', async () => {
    expect(
      await codeOf(() => evaluations.enregistrer(session('awa'), agents.fatou, ANNEE, complete())),
    ).toBe('evaluations.non_cadre');
    expect(
      await codeOf(() =>
        evaluations.enregistrer(session('awa'), agents.ousmane, ANNEE, complete()),
      ),
    ).toBe('evaluations.personnel');
    const vue = await evaluations.grille(session('awa'), agents.ousmane, ANNEE);
    expect(vue.personnel).toBeNull();
  });

  it('seul le N+1 d’aujourd’hui la remplit', async () => {
    expect(
      await codeOf(() =>
        evaluations.enregistrer(session('mariama'), agents.moussa, ANNEE, complete()),
      ),
    ).toBe('evaluations.hors_perimetre');
    expect(
      await codeOf(() =>
        evaluations.enregistrer(session('moussa'), agents.moussa, ANNEE, complete()),
      ),
    ).toBe('evaluations.pas_encore');
  });

  it('l’identification vient du dossier et de l’organigramme', async () => {
    const vue = await evaluations.grille(session('awa'), agents.moussa, ANNEE);
    expect(vue.identification).toMatchObject({
      direction: 'Direction du Capital Humain',
      departement: 'Département Études',
      service: null,
      agent: 'Moussa NDIAYE',
      matricule: 'EVA-MOUSSA',
      fonction: 'Chargé d’études',
      nouveauAuPoste: true,
      evaluateur: 'Awa DIOP',
      fonctionEvaluateur: 'Cheffe du département',
    });
    expect(vue.identification.anciennete).toMatch(/mois$/);
    // À l'écran, les noms s'écrivent comme partout ailleurs.
    expect(vue.evaluateur).toBe('Awa Diop');
  });

  it('elle s’enregistre telle qu’elle est, et ne part que complète', async () => {
    const partielle = {
      ...grilleVide(),
      objectifs: [
        { texte: texteRicheDe('Instruire les dossiers'), niveau: null },
        { texte: [], niveau: null },
        { texte: [], niveau: null },
      ],
    };
    const vue = await evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, partielle);
    expect(vue.etat).toBe('brouillon');
    expect(vue.role).toBe('n1');
    expect(vue.contenu.objectifs[0]).toEqual({
      texte: texteRicheDe('Instruire les dossiers'),
      niveau: null,
    });
    expect(vue.actions.envoyer).toBe(true);
    expect(await codeOf(() => evaluations.envoyer(session('awa'), agents.moussa, ANNEE))).toBe(
      'evaluations.incomplete',
    );
    // Un brouillon reste au N+1 : l'agent ne le lit pas.
    expect(await codeOf(() => evaluations.grille(session('moussa'), agents.moussa, ANNEE))).toBe(
      'evaluations.pas_encore',
    );
  });

  it('le critère du commandement ne vaut que pour qui encadre', async () => {
    expect(ceQuiManque(complete(false), false)).toEqual([]);
    expect(ceQuiManque(complete(false), true)).toEqual(['Le niveau de chaque critère']);
    expect((await evaluations.grille(session('awa'), agents.khady, ANNEE)).commandement).toBe(true);
    expect((await evaluations.grille(session('awa'), agents.moussa, ANNEE)).commandement).toBe(
      false,
    );
  });

  it('une grille neuve reprend les objectifs à venir de la précédente', async () => {
    const precedente = {
      ...grilleVide(),
      objectifsAVenir: [
        { texte: 'Objectif fixé l’an passé n° 1', echeance: `${ANNEE}-03-31` },
        { texte: 'Objectif fixé l’an passé n° 2', echeance: null },
      ],
    };
    await raw(
      `INSERT INTO evaluation_grilles (id, tenant_id, employee_id, annee, modele, etat, contenu,
                                       terminee_le)
       VALUES ($1,$2,$3,$4,'cadre','terminee',$5::jsonb, now())`,
      [randomUUID(), tenantId, agents.aissatou, ANNEE - 1, JSON.stringify(precedente)],
    );
    const vue = await evaluations.grille(session('awa'), agents.aissatou, ANNEE);
    expect(vue.etat).toBeNull();
    expect(vue.contenu.objectifs.map((o) => texteBrut(o.texte))).toEqual([
      'Objectif fixé l’an passé n° 1',
      'Objectif fixé l’an passé n° 2',
    ]);
  });

  it('un objectif à l’ouverture, puis autant qu’on en ajoute, dix au plus', async () => {
    expect(grilleVide().objectifs).toEqual([{ texte: [], niveau: null }]);
    const cinq = Array.from({ length: 5 }, (_, i) => ({
      texte: texteRicheDe(`Objectif n° ${i + 1}`),
      niveau: 'B' as const,
    }));
    // Un objectif resté vide ne se garde pas.
    const vue = await evaluations.enregistrer(session('awa'), agents.aissatou, ANNEE, {
      ...complete(),
      objectifs: [...cinq.slice(0, 2), { texte: [], niveau: null }, ...cinq.slice(2)],
    });
    expect(vue.contenu.objectifs.map((o) => texteBrut(o.texte))).toEqual([
      'Objectif n° 1',
      'Objectif n° 2',
      'Objectif n° 3',
      'Objectif n° 4',
      'Objectif n° 5',
    ]);
    const onze = Array.from({ length: 11 }, () => cinq[0]!);
    expect(contenuDeGrilleSchema.safeParse({ ...complete(), objectifs: onze }).success).toBe(false);
  });

  it('sans objectif de travail pour la période à venir, la grille ne part pas', () => {
    expect(ceQuiManque({ ...complete(), objectifsAVenir: [] }, false)).toEqual([
      'Un objectif de travail pour la période à venir',
    ]);
  });
});

describe('les champs de la grille', () => {
  it('le texte mis en forme s’enregistre rangé, et ce que le PDF ne tient pas est refusé', async () => {
    const contenu = {
      ...complete(),
      objectifs: [
        {
          texte: [
            {
              type: 'paragraphe' as const,
              niveau: 0,
              segments: [
                { texte: 'Instruire ', gras: true },
                { texte: 'les', gras: true },
                { texte: ' dossiers' },
                { texte: '' },
              ],
            },
            { type: 'paragraphe' as const, niveau: 0, segments: [] },
          ],
          niveau: 'B' as const,
        },
        { texte: [], niveau: null },
        { texte: [], niveau: null },
      ],
      raisons: [
        { type: 'numero' as const, niveau: 0, segments: [{ texte: 'Un report' }] },
        { type: 'puce' as const, niveau: 1, segments: [{ texte: 'en mars', italique: true }] },
      ],
    };
    const vue = await evaluations.enregistrer(session('awa'), agents.aissatou, ANNEE, contenu);
    expect(vue.contenu.objectifs[0]!.texte).toEqual([
      {
        type: 'paragraphe',
        niveau: 0,
        segments: [{ texte: 'Instruire les', gras: true }, { texte: ' dossiers' }],
      },
    ]);
    expect(vue.contenu.raisons).toEqual(contenu.raisons);

    // Un objectif est du texte, sans puce ni numéro.
    const avecPuce = { ...contenu, objectifs: [{ texte: puces('Un'), niveau: 'B' }] };
    expect(contenuDeGrilleSchema.safeParse(avecPuce).success).toBe(false);
    // Les points forts, les points faibles et les actions s'écrivent en
    // puces : un paragraphe ou un numéro y devient une puce, à son niveau.
    const enPuces = contenuDeGrilleSchema.parse({
      ...contenu,
      pointsForts: [
        { type: 'paragraphe', niveau: 0, segments: [{ texte: 'Autonome' }] },
        { type: 'numero', niveau: 1, segments: [{ texte: 'et rigoureux', gras: true }] },
      ],
      actions: 'Un atelier de planification',
    });
    expect(enPuces.pointsForts).toEqual([
      { type: 'puce', niveau: 0, segments: [{ texte: 'Autonome' }] },
      { type: 'puce', niveau: 1, segments: [{ texte: 'et rigoureux', gras: true }] },
    ]);
    expect(enPuces.actions).toEqual(puces('Un atelier de planification'));
    // Ce qui dépasse sa place sur le PDF ne s'enregistre pas ; l'écran le dit.
    const trop = { ...contenu, pointsForts: texteRicheDe('x'.repeat(521)) };
    expect(contenuDeGrilleSchema.safeParse(trop).success).toBe(false);
    expect(champsTropLongs(trop)).toEqual(['Les points forts']);
  });

  it('les objectifs à venir se rangent par échéance ; une échéance sans objectif manque', async () => {
    const contenu = {
      ...complete(),
      objectifsAVenir: [
        { texte: 'Sans échéance', echeance: null },
        { texte: 'En juin', echeance: `${ANNEE + 1}-06-30` },
        { texte: '', echeance: null },
        { texte: 'En mars', echeance: `${ANNEE + 1}-03-31` },
      ],
    };
    const vue = await evaluations.enregistrer(session('awa'), agents.aissatou, ANNEE, contenu);
    expect(vue.contenu.objectifsAVenir.map((o) => o.texte)).toEqual([
      'En mars',
      'En juin',
      'Sans échéance',
    ]);
    const orpheline = {
      ...vue.contenu,
      objectifsAVenir: [{ texte: '', echeance: `${ANNEE + 1}-01-15` }],
    };
    expect(ceQuiManque(orpheline, false)).toEqual(['L’objectif de chaque échéance']);
  });

  it('les formations proposées : le catalogue, sans ce que l’agent a terminé ni anime', async () => {
    const vue = await evaluations.grille(session('awa'), agents.moussa, ANNEE);
    expect(vue.formationsProposables).toEqual([
      { courseId: cours.gestion, titre: 'Gestion de projet' },
    ]);
    // La demande garde le titre du catalogue ; une formation inconnue est refusée.
    const demandee = await evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, {
      ...vue.contenu,
      formations: [{ courseId: cours.gestion, titre: 'Autre titre' }],
    });
    expect(demandee.contenu.formations).toEqual([
      { courseId: cours.gestion, titre: 'Gestion de projet' },
    ]);
    expect(
      await codeOf(() =>
        evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, {
          ...vue.contenu,
          formations: [{ courseId: randomUUID(), titre: 'Inconnue' }],
        }),
      ),
    ).toBe('evaluations.formation');
  });

  it('un besoin hors du catalogue se garde tel qu’il est écrit, une fois', async () => {
    const vue = await evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, {
      ...complete(),
      formations: [
        { courseId: cours.gestion, titre: 'Gestion de projet' },
        { courseId: null, titre: '  Excel avancé ' },
        { courseId: null, titre: 'excel avancé' },
        { courseId: null, titre: 'Prise de parole en public' },
      ],
    });
    expect(vue.contenu.formations).toEqual([
      { courseId: cours.gestion, titre: 'Gestion de projet' },
      { courseId: null, titre: 'Excel avancé' },
      { courseId: null, titre: 'Prise de parole en public' },
    ]);
    // Un titre vide n'est pas un besoin.
    expect(
      contenuDeGrilleSchema.parse({ ...complete(), formations: [{ courseId: null, titre: ' ' }] })
        .formations,
    ).toEqual([]);
    // Le titre s'accorde au nombre.
    expect(besoinsDeFormation(1)).toBe('Besoin de formation identifié');
    expect(besoinsDeFormation(0)).toBe('Besoins de formation identifiés');
    expect(besoinsDeFormation(3)).toBe('Besoins de formation identifiés');
  });

  it('une grille d’avant le texte riche se relit, et s’imprime', async () => {
    const ancienne = {
      objectifs: [{ texte: 'Un objectif\nsur deux lignes', niveau: 'B' }],
      raisons: '',
      pointsForts: 'Rigueur.',
      objectifsAVenir: [
        { texte: 'Un objectif', delai: 'Juin' },
        { texte: '', delai: '' },
      ],
      formations: ['Gestion de projet', '', ''],
      observations: 'Agent fiable.',
    };
    await raw(
      `INSERT INTO evaluation_grilles (id, tenant_id, employee_id, annee, modele, etat, contenu,
                                       terminee_le)
       VALUES ($1,$2,$3,$4,'cadre','terminee',$5::jsonb, now())`,
      [randomUUID(), tenantId, agents.khady, ANNEE - 2, JSON.stringify(ancienne)],
    );
    const vue = await evaluations.grille(session('awa'), agents.khady, ANNEE - 2);
    expect(vue.contenu.objectifs[0]!.texte).toEqual(texteRicheDe('Un objectif\nsur deux lignes'));
    expect(vue.contenu.pointsForts).toEqual(puces('Rigueur.'));
    expect(vue.contenu.objectifsAVenir).toEqual([{ texte: 'Un objectif', echeance: null }]);
    expect(vue.contenu.formations).toEqual([{ courseId: null, titre: 'Gestion de projet' }]);
    const { pdf } = await evaluations.pdf(session('awa'), agents.khady, ANNEE - 2);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('le circuit', () => {
  it('le N+1 l’envoie à l’agent, qui la lit sans la partie réservée à la hiérarchie', async () => {
    await evaluations.enregistrer(session('awa'), agents.moussa, ANNEE, complete());
    const envoyee = await evaluations.envoyer(session('awa'), agents.moussa, ANNEE);
    expect(envoyee.etat).toBe('chez_agent');
    expect(envoyee.actions.reprendre).toBe(true);
    expect(await titres('moussa')).toContain(
      `Votre grille d’évaluation ${ANNEE} est à lire et à valider`,
    );

    const lue = await evaluations.grille(session('moussa'), agents.moussa, ANNEE);
    expect(lue.role).toBe('agent');
    expect(lue.contenu.pointsForts).toEqual(puces('Rigueur', 'Disponibilité'));
    expect(lue.contenu.comprehension).toBeNull();
    expect(lue.contenu.tenue).toBeNull();
    expect(lue.contenu.observations).toEqual([]);
    // L'agent ne choisit pas les formations : le catalogue n'est pas montré à l'agent.
    expect(lue.formationsProposables).toEqual([]);
    expect(lue.n2).toBeNull();
    expect(lue.actions).toMatchObject({ valider: true, renvoyer: true, pdf: false });
    expect(await codeOf(() => evaluations.pdf(session('moussa'), agents.moussa, ANNEE))).toBe(
      'evaluations.pdf_reserve',
    );
  });

  it('l’agent la renvoie au N+1 avec un mot', async () => {
    const mot = 'Le deuxième objectif a changé en cours d’année.';
    await evaluations.renvoyer(session('moussa'), agents.moussa, ANNEE, mot);
    const vue = await evaluations.grille(session('awa'), agents.moussa, ANNEE);
    expect(vue.etat).toBe('brouillon');
    expect(vue.renvoi?.mot).toBe(mot);
    expect(await titres('awa')).toContain(
      `Moussa Ndiaye vous renvoie sa grille d’évaluation ${ANNEE}`,
    );
    expect(await titres('moussa')).not.toContain(
      `Votre grille d’évaluation ${ANNEE} est à lire et à valider`,
    );
    expect(
      (await evaluations.equipe(session('awa'))).lignes.find((l) => l.nom === 'Moussa Ndiaye')
        ?.ouEnEst,
    ).toBe('renvoyee');
  });

  it('le N+1 la renvoie, puis la reprend tant que l’agent ne l’a pas validée', async () => {
    await evaluations.envoyer(session('awa'), agents.moussa, ANNEE);
    const reprise = await evaluations.reprendre(session('awa'), agents.moussa, ANNEE);
    expect(reprise.etat).toBe('brouillon');
    expect(reprise.renvoi).toBeNull();
    expect(await titres('moussa')).not.toContain(
      `Votre grille d’évaluation ${ANNEE} est à lire et à valider`,
    );
    await evaluations.envoyer(session('awa'), agents.moussa, ANNEE);
  });

  it('l’agent valide ; le N+1 l’envoie au N+2, puis à la DCH sans attendre', async () => {
    const validee = await evaluations.valider(
      session('moussa'),
      agents.moussa,
      ANNEE,
      'Je partage l’essentiel.',
    );
    expect(validee.etat).toBe('validee_agent');
    expect(validee.commentairesAgent).toBe('Je partage l’essentiel.');
    expect(await titres('awa')).toContain(`Moussa Ndiaye a validé sa grille d’évaluation ${ANNEE}`);

    const chezN1 = await evaluations.grille(session('awa'), agents.moussa, ANNEE);
    expect(chezN1.actions).toMatchObject({ transmettreAuN2: true, terminer: true });
    expect(chezN1.n2?.nom).toBe('Mariama Cissé');

    const auN2 = await evaluations.transmettre(session('awa'), agents.moussa, ANNEE);
    expect(auN2.etat).toBe('chez_n2');
    expect(await titres('mariama')).toContain(
      `Grille d’évaluation ${ANNEE} de Moussa Ndiaye à commenter`,
    );
    expect(await titres('awa')).not.toContain(
      `Moussa Ndiaye a validé sa grille d’évaluation ${ANNEE}`,
    );

    // Le N+2 lit tout, la page 6 comprise.
    const chezN2 = await evaluations.grille(session('mariama'), agents.moussa, ANNEE);
    expect(chezN2.role).toBe('n2');
    expect(chezN2.actions.commenter).toBe(true);
    expect(chezN2.contenu.comprehension).toBe('A');
    expect(chezN2.n2?.nom).toBe('Mariama Cissé');
    const ligne = (await evaluations.equipe(session('mariama'))).lignes.find(
      (l) => l.nom === 'Moussa Ndiaye',
    );
    expect(ligne).toMatchObject({ enN2: true, ouEnEst: 'chez_n2', n1: 'Awa Diop' });

    // Le N+2 ne bloque pas : le N+1 l'envoie à la DCH à tout moment.
    const terminee = await evaluations.terminer(session('awa'), agents.moussa, ANNEE);
    expect(terminee.etat).toBe('terminee');
    expect(await titres('mariama')).not.toContain(
      `Grille d’évaluation ${ANNEE} de Moussa Ndiaye à commenter`,
    );
    expect(await titres('moussa')).toContain(
      `Votre grille d’évaluation ${ANNEE} est transmise à la DCH`,
    );
    expect(
      await codeOf(() =>
        evaluations.commenter(session('mariama'), agents.moussa, ANNEE, 'Trop tard.'),
      ),
    ).toBe('evaluations.etat');
  });

  it('le N+2 commente et valide : la grille part à la DCH', async () => {
    expect(
      await codeOf(() => evaluations.enregistrer(session('awa'), agents.khady, ANNEE, complete())),
    ).toBe('AUCUNE ERREUR');
    // Khady encadre : sans le commandement, la grille ne part pas.
    expect(await codeOf(() => evaluations.envoyer(session('awa'), agents.khady, ANNEE))).toBe(
      'evaluations.incomplete',
    );
    await evaluations.enregistrer(session('awa'), agents.khady, ANNEE, complete(true));
    await evaluations.envoyer(session('awa'), agents.khady, ANNEE);
    await evaluations.valider(session('khady'), agents.khady, ANNEE, '');
    await evaluations.transmettre(session('awa'), agents.khady, ANNEE);
    const commentee = await evaluations.commenter(
      session('mariama'),
      agents.khady,
      ANNEE,
      'Une année solide.',
    );
    expect(commentee.etat).toBe('terminee');
    expect(commentee.commentairesN2).toBe('Une année solide.');
    expect(commentee.dates.valideeN2Le).not.toBeNull();
    expect(await titres('awa')).toContain(
      `Mariama Cissé a commenté la grille d’évaluation ${ANNEE} de Khady Sarr, transmise à la DCH`,
    );
  });

  it('l’appel du N+1 suit le N+1 d’aujourd’hui ; l’ancien garde la lecture', async () => {
    await evaluations.enregistrer(session('awa'), agents.aissatou, ANNEE, complete());
    await evaluations.envoyer(session('awa'), agents.aissatou, ANNEE);
    await evaluations.valider(session('aissatou'), agents.aissatou, ANNEE, '');
    const appel = `Aïssatou Ba a validé sa grille d’évaluation ${ANNEE}`;
    expect(await titres('awa')).toContain(appel);

    await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [
      agents.khady,
      agents.aissatou,
    ]);
    try {
      await db.withTenant({ tenantId }, (tx) => reconcilierLesGrilles(tx, agents.aissatou));
      expect(await titres('khady')).toContain(appel);
      expect(await titres('awa')).not.toContain(appel);
      expect(
        (await evaluations.grille(session('khady'), agents.aissatou, ANNEE)).actions,
      ).toMatchObject({ terminer: true, transmettreAuN2: true });
      // L'ancienne évaluatrice la lit encore, sans rien pouvoir y faire.
      const ancienne = await evaluations.grille(session('awa'), agents.aissatou, ANNEE);
      expect(ancienne.role).toBe('n1');
      expect(ancienne.actions).toMatchObject({
        terminer: false,
        transmettreAuN2: false,
        pdf: true,
      });
    } finally {
      await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [
        agents.awa,
        agents.aissatou,
      ]);
      await db.withTenant({ tenantId }, (tx) => reconcilierLesGrilles(tx, agents.aissatou));
    }
  });
});

describe('l’agent qui part', () => {
  it('reste dans la liste du N+1 quand sa grille existe déjà', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [agents.moussa]);
    try {
      const noms = (await evaluations.equipe(session('awa'))).lignes.map((l) => l.nom);
      expect(noms).toContain('Moussa Ndiaye');
      // Sans grille, un départ sort de la liste.
      await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [agents.fatou]);
      expect((await evaluations.equipe(session('awa'))).lignes.map((l) => l.nom)).not.toContain(
        'Fatou Sall',
      );
    } finally {
      await raw(`UPDATE employees SET status = 'active' WHERE id = ANY($1::uuid[])`, [
        [agents.moussa, agents.fatou],
      ]);
    }
  });
});

describe('la DCH', () => {
  it('suit chaque agent qu’on évalue, et où en est sa grille', async () => {
    const s = await evaluations.suivi(session('ndeye'));
    const ou = (nom: string) => s.lignes.find((l) => l.nom === nom);
    expect(ou('Moussa Ndiaye')).toMatchObject({ ouEnEst: 'terminee', enRetard: false });
    expect(ou('Khady Sarr')?.ouEnEst).toBe('terminee');
    expect(ou('Aïssatou Ba')?.ouEnEst).toBe('validee_agent');
    expect(ou('Fatou Sall')).toMatchObject({ ouEnEst: 'a_remplir', personnel: 'non_cadre' });
    expect(ou('Moussa Ndiaye')?.direction).toBe('Direction du Capital Humain');
    expect(await codeOf(() => evaluations.suivi(session('awa')))).toBe('auth.forbidden');
  });

  it('passé la fin de la période, ce qui n’est pas transmis est en retard', async () => {
    await raw(`UPDATE evaluation_periodes SET au = $1 WHERE tenant_id = $2`, [jour(-1), tenantId]);
    try {
      const s = await evaluations.suivi(session('ndeye'));
      const ou = (nom: string) => s.lignes.find((l) => l.nom === nom);
      expect(ou('Fatou Sall')?.enRetard).toBe(true);
      expect(ou('Aïssatou Ba')?.enRetard).toBe(true);
      expect(ou('Moussa Ndiaye')?.enRetard).toBe(false);
      // En retard, la grille reste ouverte au N+1.
      expect(
        (await evaluations.grille(session('awa'), agents.ousmane, ANNEE)).actions.enregistrer,
      ).toBe(true);
    } finally {
      await raw(`UPDATE evaluation_periodes SET au = $1 WHERE tenant_id = $2`, [AU, tenantId]);
    }
  });

  it('reçoit les grilles terminées au dossier, et leur PDF', async () => {
    // Avec les deux notes de la synthèse du N+1.
    expect(await evaluations.dossier(session('ndeye'), agents.moussa)).toEqual([
      expect.objectContaining({ annee: ANNEE, modele: 'cadre', comprehension: 'A', tenue: 'B' }),
    ]);
    expect(await codeOf(() => evaluations.dossier(session('awa'), agents.moussa))).toBe(
      'auth.forbidden',
    );

    const { filename, pdf } = await evaluations.pdf(session('ndeye'), agents.moussa, ANNEE);
    expect(filename).toBe(`grille-evaluation-${ANNEE}-EVA-MOUSSA.pdf`);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Les paraphes s'écrivent dans l'écriture manuscrite, embarquée.
    expect(pdf.includes(Buffer.from('Allura'))).toBe(true);

    // Une grille en cours reste à la hiérarchie.
    expect(await codeOf(() => evaluations.grille(session('ndeye'), agents.aissatou, ANNEE))).toBe(
      'evaluations.hors_perimetre',
    );
  });
});

describe('le PDF, à la taille de ce qui est écrit', () => {
  /** Le nombre de pages d'un PDF : ses dictionnaires de page. */
  const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  const imprimer = (contenu: ContenuDeGrille) =>
    grilleDuPersonnelCadre(
      {
        annee: ANNEE,
        identification: {
          direction: 'Direction du Capital Humain',
          departement: null,
          service: null,
          agent: 'Moussa NDIAYE',
          matricule: 'EMP-002',
          fonction: 'Chargé d’études',
          anciennete: '3 ans',
          nouveauAuPoste: false,
          evaluateur: 'Awa DIOP',
          fonctionEvaluateur: 'Cheffe du département',
        },
        contenu,
        commandement: false,
        nouveauAuPoste: false,
        ratification: {
          evaluateur: 'Awa DIOP',
          envoyeeLe: null,
          agent: 'Moussa NDIAYE',
          valideeLe: null,
          commentaires: '',
        },
        n2: null,
      },
      null,
    );
  const objectifs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      texte: texteRicheDe(`Objectif de l’année écoulée n° ${i + 1}`),
      niveau: 'B' as const,
    }));

  it('six pages pour un objectif comme pour cinq ; dix ont une page de suite', async () => {
    expect(pages(await imprimer({ ...complete(), objectifs: objectifs(1) }))).toBe(6);
    expect(pages(await imprimer({ ...complete(), objectifs: objectifs(5) }))).toBe(6);
    const dix = await imprimer({
      ...complete(),
      objectifs: objectifs(10),
      formations: Array.from({ length: 10 }, (_, i) => ({
        courseId: null,
        titre: `Besoin n° ${i + 1}`,
      })),
    });
    expect(pages(dix)).toBe(7);
  });
});

describe('les paraphes', () => {
  it('les initiales de chaque prénom et de chaque nom, sans les particules', () => {
    expect(initiales('Mariama CISSÉ')).toBe('M.C.');
    expect(initiales('Cheikh Tidiane MBAYE')).toBe('C.T.M.');
    expect(initiales('Jean-Pierre DIOP')).toBe('J.-P.D.');
    expect(initiales('Fatou de SOUZA')).toBe('F.S.');
    expect(initiales('Élodie NDOYE')).toBe('É.N.');
  });
});
