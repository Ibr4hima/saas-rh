/**
 * Les objectifs, contre la base.
 *
 * L'organigramme du test :
 *
 *   Direction Générale (le DG)
 *   ├─ Direction du Capital Humain (Mariama)
 *   │    └─ Département Études (Awa, n+1 Mariama) — Moussa, n+1 Awa
 *   └─ Direction Financière (Ousmane) — Fatou, n+1 Ousmane
 *
 * On vérifie que chacun fixe ce que sa place lui donne — le DG l'APIX et les
 * directions, le n+1 ses DIRECTS —, que chacun voit ce qui le concerne — les
 * orientations selon leur diffusion, sa direction, les siens —, qu'une
 * formation à suivre se lit dans l'Academy, et que chacun est prévenu.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademyEquipeService } from '../src/modules/academy/academy-equipe.service';
import { capacitesDe } from '../src/modules/acces/dch';
import { ObjectifsService } from '../src/modules/objectifs/objectifs.service';

const env = loadEnv();
const tenantId = randomUUID();
const maintenant = new Date(Date.UTC(2026, 8, 28, 9, 0, 0));

type Nom = 'dg' | 'mariama' | 'awa' | 'moussa' | 'ousmane' | 'fatou';
const comptes = Object.fromEntries(
  (['dg', 'mariama', 'awa', 'moussa', 'ousmane', 'fatou'] as Nom[]).map((n) => [n, randomUUID()]),
) as Record<Nom, string>;
const agents = Object.fromEntries(
  (['dg', 'mariama', 'awa', 'moussa', 'ousmane', 'fatou'] as Nom[]).map((n) => [n, randomUUID()]),
) as Record<Nom, string>;
const unites = {
  generale: randomUUID(),
  dch: randomUUID(),
  etudes: randomUUID(),
  dfc: randomUUID(),
};
const session = (qui: Nom) => ({ userId: comptes[qui], tenantId, role: 'employee' }) as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let objectifs: ObjectifsService;

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

async function agent(qui: Nom, prenom: string, nom: string, n1: Nom | null, unite: string) {
  const personId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x',$3,$4)`,
    [comptes[qui], `obj-${qui}-${comptes[qui]}@test.local`, prenom, nom],
  );
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,$5)`,
    [personId, tenantId, comptes[qui], prenom, nom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01','active',$5)`,
    [agents[qui], tenantId, personId, `OBJ-${qui}`, n1 ? agents[n1] : null],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Poste','[2024-01-01,)')`,
    [randomUUID(), tenantId, agents[qui], unite],
  );
}

async function notifications(qui: Nom): Promise<{ title: string; link: string | null }[]> {
  const { rows } = await raw(
    `SELECT title, link FROM notifications WHERE recipient_user_id = $1 ORDER BY created_at`,
    [comptes[qui]],
  );
  return rows as { title: string; link: string | null }[];
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  objectifs = new ObjectifsService(db, new AcademyEquipeService(db));
  objectifs.horloge = () => maintenant;

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Objectifs',$2)`, [
    tenantId,
    `objectifs-${tenantId.slice(0, 8)}`,
  ]);
  const unite = (id: string, type: string, nom: string, parent: string | null) =>
    raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id) VALUES ($1,$2,$3,$4,$5)`,
      [id, tenantId, type, nom, parent],
    );
  await unite(unites.generale, 'direction', 'Direction Générale', null);
  await unite(unites.dch, 'direction', 'Direction du Capital Humain', unites.generale);
  await unite(unites.etudes, 'department', 'Département Études', unites.dch);
  await unite(unites.dfc, 'direction', 'Direction Financière', unites.generale);

  await agent('dg', 'Cheikh', 'Mbaye', null, unites.generale);
  await agent('mariama', 'Mariama', 'Cissé', 'dg', unites.dch);
  await agent('ousmane', 'Ousmane', 'Fall', 'dg', unites.dfc);
  await agent('awa', 'Awa', 'Diop', 'mariama', unites.etudes);
  await agent('moussa', 'Moussa', 'Ndiaye', 'awa', unites.etudes);
  await agent('fatou', 'Fatou', 'Sall', 'ousmane', unites.dfc);

  for (const [unite, chef] of [
    [unites.generale, agents.dg],
    [unites.dch, agents.mariama],
    [unites.etudes, agents.awa],
    [unites.dfc, agents.ousmane],
  ] as const) {
    await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [chef, unite]);
  }
});

afterAll(async () => {
  await ownerPool?.end();
  await db?.pool.end();
});

describe('qui fixe quoi', () => {
  it('le directeur général fixe les orientations de l’APIX et les objectifs des directions', async () => {
    const tous = await objectifs.creer(session('dg'), {
      niveau: 'apix',
      diffusion: 'tous',
      nature: 'libre',
      titre: 'Faire du Sénégal une destination d’investissement de premier plan',
    });
    expect(tous.annee).toBe(2026);
    expect(tous.auteur).toBe('Cheikh Mbaye');
    await objectifs.creer(session('dg'), {
      niveau: 'apix',
      diffusion: 'directeurs',
      nature: 'libre',
      titre: 'Réduire les délais d’agrément',
    });
    await objectifs.creer(session('dg'), {
      niveau: 'direction',
      directionId: unites.dch,
      nature: 'libre',
      titre: 'Former chaque agent au moins une fois',
      echeance: '2026-12-31',
    });
    await objectifs.creer(session('dg'), {
      niveau: 'direction',
      directionId: unites.dfc,
      nature: 'libre',
      titre: 'Clôturer les comptes avant le 31 mars',
    });

    const vue = await objectifs.objectifsAPIX(session('dg'));
    expect(vue.orientations.map((o) => o.diffusion)).toEqual(['tous', 'directeurs']);
    // La Direction Générale n'est pas une direction ici : ses orientations en tiennent lieu.
    expect(vue.directions.map((d) => d.nom).sort()).toEqual(
      ['Direction Financière', 'Direction du Capital Humain'].sort(),
    );
    expect(vue.directions.find((d) => d.id === unites.dch)!.directeur).toBe('Mariama Cissé');
    expect(vue.directions.find((d) => d.id === unites.dch)!.objectifs).toHaveLength(1);
  });

  it('personne d’autre : ni un directeur, ni pour la Direction Générale', async () => {
    expect(
      await codeOf(() =>
        objectifs.creer(session('mariama'), {
          niveau: 'apix',
          diffusion: 'tous',
          nature: 'libre',
          titre: 'Tentative',
        }),
      ),
    ).toBe('objectifs.reserve_dg');
    expect(
      await codeOf(() =>
        objectifs.creer(session('mariama'), {
          niveau: 'direction',
          directionId: unites.dch,
          nature: 'libre',
          titre: 'Tentative',
        }),
      ),
    ).toBe('objectifs.reserve_dg');
    expect(await codeOf(() => objectifs.objectifsAPIX(session('mariama')))).toBe(
      'objectifs.reserve_dg',
    );
    expect(
      await codeOf(() =>
        objectifs.creer(session('dg'), {
          niveau: 'direction',
          directionId: unites.generale,
          nature: 'libre',
          titre: 'Pour la DG',
        }),
      ),
    ).toBe('objectifs.direction_inconnue');
  });

  it('le n+1 fixe les objectifs de ses directs, et d’eux seuls', async () => {
    const o = await objectifs.creer(session('awa'), {
      niveau: 'individuel',
      employeeId: agents.moussa,
      nature: 'libre',
      titre: 'Livrer l’étude sectorielle',
      description: 'Agro-industrie, avec les chiffres 2025.',
      echeance: '2026-11-15',
    });
    expect(o.auteur).toBe('Awa Diop');
    const tentatives: [Nom, Nom][] = [
      ['mariama', 'moussa'], // son n+2
      ['moussa', 'awa'], // son n+1
      ['awa', 'fatou'], // d'une autre direction
      ['awa', 'awa'], // elle-même
    ];
    for (const [qui, pour] of tentatives) {
      expect(
        await codeOf(() =>
          objectifs.creer(session(qui), {
            niveau: 'individuel',
            employeeId: agents[pour],
            nature: 'libre',
            titre: 'Tentative',
          }),
        ),
      ).toBe('objectifs.hors_equipe');
    }
  });
});

describe('qui voit quoi', () => {
  it('l’agent : les orientations diffusées à tous, sa direction, les siens', async () => {
    const moussa = await objectifs.mesObjectifs(session('moussa'));
    expect(moussa.apix.map((o) => o.diffusion)).toEqual(['tous']);
    expect(moussa.direction?.nom).toBe('Direction du Capital Humain');
    expect(moussa.direction?.objectifs.map((o) => o.titre)).toEqual([
      'Former chaque agent au moins une fois',
    ]);
    expect(moussa.individuels.map((o) => o.titre)).toEqual(['Livrer l’étude sectorielle']);

    const fatou = await objectifs.mesObjectifs(session('fatou'));
    expect(fatou.direction?.nom).toBe('Direction Financière');
    expect(fatou.individuels).toEqual([]);
  });

  it('un directeur reçoit aussi les orientations réservées aux directeurs', async () => {
    const mariama = await objectifs.mesObjectifs(session('mariama'));
    expect(mariama.apix.map((o) => o.diffusion).sort()).toEqual(['directeurs', 'tous']);
  });

  it('chacun est prévenu de ce qui le concerne, dans Mon espace', async () => {
    const moussa = await notifications('moussa');
    expect(moussa.map((n) => n.title)).toEqual(
      expect.arrayContaining([
        'Orientations 2026 de l’APIX',
        'Objectifs 2026 de votre direction',
        'Nouvel objectif : Livrer l’étude sectorielle',
      ]),
    );
    expect(moussa.every((n) => n.link === '/moi/objectifs')).toBe(true);
    // Les orientations réservées aux directeurs ne sont pas annoncées à Moussa :
    // une seule notification d'orientations par jour, et c'est celle « à tous ».
    expect(moussa.filter((n) => n.title.startsWith('Orientations'))).toHaveLength(1);
    // Fatou n'est pas de la DCH.
    expect((await notifications('fatou')).map((n) => n.title)).not.toContain(
      'Nouvel objectif : Livrer l’étude sectorielle',
    );
    // Le DG ne se prévient pas lui-même.
    expect(await notifications('dg')).toEqual([]);
  });
});

describe('une formation à suivre', () => {
  it('se lit dans l’Academy : à commencer, puis atteinte une fois terminée', async () => {
    const courseId = randomUUID();
    const moduleId = randomUUID();
    await raw(
      `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id)
       VALUES ($1,$2,'Excel avancé','bureautique', now(), $3)`,
      [courseId, tenantId, comptes.dg],
    );
    await raw(
      `INSERT INTO academy_modules (id, tenant_id, course_id, position, title) VALUES ($1,$2,$3,0,'Bases')`,
      [moduleId, tenantId, courseId],
    );
    const lecons = [randomUUID(), randomUUID()];
    for (const [i, id] of lecons.entries()) {
      await raw(
        `INSERT INTO academy_lessons (id, tenant_id, course_id, module_id, position, title,
           video_provider, video_uid, video_status, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,'local',$7,'prete',60)`,
        [id, tenantId, courseId, moduleId, i, `Leçon ${i + 1}`, randomUUID()],
      );
    }
    expect((await objectifs.formationsProposables(session('awa'))).map((f) => f.title)).toEqual([
      'Excel avancé',
    ]);

    const o = await objectifs.creer(session('awa'), {
      niveau: 'individuel',
      employeeId: agents.moussa,
      nature: 'formation',
      courseId,
      echeance: '2026-10-31',
    });
    expect(o.titre).toBe('Excel avancé');
    expect(o.formation).toEqual({ courseId, statut: 'a_commencer', lecons: 2, validees: 0 });
    expect(o.atteint).toBe(false);
    expect((await notifications('moussa')).map((n) => n.title)).toContain(
      'Formation à suivre : Excel avancé',
    );

    expect(
      await codeOf(() =>
        objectifs.creer(session('awa'), {
          niveau: 'individuel',
          employeeId: agents.moussa,
          nature: 'formation',
          courseId,
        }),
      ),
    ).toBe('objectifs.formation_deja_fixee');
    expect(
      await codeOf(() => objectifs.evaluer(session('awa'), o.id, { evaluation: 'atteint' })),
    ).toBe('objectifs.formation_auto');

    for (const lecon of lecons) {
      await raw(
        `INSERT INTO academy_lesson_progress (tenant_id, employee_id, lesson_id, watched, watched_seconds, completed_at, updated_at)
         VALUES ($1,$2,$3,'[[0,60]]',60, now(), now())`,
        [tenantId, agents.moussa, lecon],
      );
    }
    const apres = (await objectifs.mesObjectifs(session('moussa'))).individuels.find(
      (x) => x.id === o.id,
    )!;
    expect(apres.formation?.statut).toBe('terminee');
    expect(apres.atteint).toBe(true);
  });
});

describe('évaluer, modifier, supprimer', () => {
  it('le n+1 évalue ; l’agent l’apprend ; l’échéance passée sans évaluation se signale', async () => {
    const enRetard = await objectifs.creer(session('awa'), {
      niveau: 'individuel',
      employeeId: agents.moussa,
      nature: 'libre',
      titre: 'Rendre le rapport trimestriel',
      echeance: '2026-09-15',
    });
    expect(enRetard.enRetard).toBe(true);

    const evalue = await objectifs.evaluer(session('awa'), enRetard.id, {
      evaluation: 'partiel',
      commentaire: 'Rendu, mais incomplet.',
    });
    expect(evalue.evaluation).toBe('partiel');
    expect(evalue.enRetard).toBe(false);
    expect((await notifications('moussa')).map((n) => n.title)).toContain(
      'Objectif évalué : Rendre le rapport trimestriel',
    );

    // Retirer l'évaluation efface aussi le commentaire.
    const retire = await objectifs.evaluer(session('awa'), enRetard.id, { evaluation: null });
    expect(retire.evaluation).toBeNull();
    expect(retire.commentaire).toBeNull();
  });

  it('seul qui a la main modifie ou supprime', async () => {
    const o = (await objectifs.mesObjectifs(session('moussa'))).individuels[0]!;
    expect(
      await codeOf(() => objectifs.modifier(session('mariama'), o.id, { titre: 'Autre' })),
    ).toBe('objectifs.hors_equipe');
    expect(await codeOf(() => objectifs.supprimer(session('moussa'), o.id))).toBe(
      'objectifs.hors_equipe',
    );
    const modifie = await objectifs.modifier(session('awa'), o.id, { echeance: null });
    expect(modifie.echeance).toBeNull();

    const direction = (await objectifs.objectifsAPIX(session('dg'))).directions.find(
      (d) => d.id === unites.dch,
    )!.objectifs[0]!;
    expect(await codeOf(() => objectifs.supprimer(session('mariama'), direction.id))).toBe(
      'objectifs.reserve_dg',
    );
    expect(
      (await objectifs.evaluer(session('dg'), direction.id, { evaluation: 'atteint' })).atteint,
    ).toBe(true);
    await objectifs.supprimer(session('dg'), direction.id);
    expect((await objectifs.mesObjectifs(session('moussa'))).direction?.objectifs).toEqual([]);
  });
});

describe('Suivi & Évaluation', () => {
  it('le n+1 voit ses directs et où en sont leurs objectifs — pas au-delà', async () => {
    const awa = await objectifs.suiviEquipe(session('awa'));
    expect(awa.membres.map((m) => m.givenName)).toEqual(['Moussa']);
    expect(awa.membres[0]!.total).toBe(3);
    expect(awa.membres[0]!.atteints).toBe(1);

    const mariama = await objectifs.suiviEquipe(session('mariama'));
    expect(mariama.membres.map((m) => m.givenName)).toEqual(['Awa']);
    expect(await codeOf(() => objectifs.fiche(session('mariama'), agents.moussa))).toBe(
      'objectifs.hors_equipe',
    );
    expect((await objectifs.fiche(session('awa'), agents.moussa)).objectifs).toHaveLength(3);
  });
});

describe('la fiche d’objectifs', () => {
  const bloc = (type: string, texte: string, props: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    type,
    props,
    content: [{ type: 'text', text: texte, styles: {} }],
    children: [],
  });

  it('le n+1 la rédige par semestre ; l’agent la lit dans « Mes objectifs », prévenu une fois', async () => {
    expect((await objectifs.mesObjectifs(session('moussa'))).fiches).toEqual([]);
    expect((await objectifs.fiche(session('awa'), agents.moussa)).fiches).toEqual([]);

    const contenu = [
      bloc('checkListItem', 'Livrer la note de conjoncture', { checked: false }),
      {
        id: randomUUID(),
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'Pour le ', styles: {} },
          { type: 'echeance', props: { date: '2026-10-31' } },
        ],
        children: [],
      },
    ];
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, { semestre: 2, contenu });
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      semestre: 2,
      contenu: [...contenu, bloc('paragraph', 'Et la synthèse annuelle.')],
    });
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      semestre: 1,
      contenu: [bloc('checkListItem', 'Clore les comptes', { checked: true })],
    });
    // Une fiche ouverte puis vidée ne se montre pas.
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2025,
      semestre: 2,
      contenu: [bloc('checkListItem', '')],
    });

    const { fiches } = await objectifs.mesObjectifs(session('moussa'));
    // Le plus récent d'abord : le 2nd semestre, puis le 1er.
    expect(fiches.map((f) => [f.annee, f.semestre])).toEqual([
      [2026, 2],
      [2026, 1],
    ]);
    expect(fiches[0]!.contenu).toHaveLength(3);
    expect(fiches[0]!.auteur).toBe('Awa Diop');
    expect(fiches[0]!.contenu[1]).toMatchObject({
      content: [{ text: 'Pour le ' }, { type: 'echeance', props: { date: '2026-10-31' } }],
    });
    expect((await objectifs.fiche(session('awa'), agents.moussa)).fiches).toHaveLength(2);
    // Deux enregistrements le même jour : une notification par fiche, pas plus.
    expect(
      (await notifications('moussa')).filter((n) => n.title.startsWith('Objectifs du')),
    ).toEqual([
      { title: 'Objectifs du 2nd semestre de 2026', link: '/moi/objectifs' },
      { title: 'Objectifs du 1er semestre de 2026', link: '/moi/objectifs' },
    ]);
  });

  it('elle ne s’écrit que par le n+1, et ses liens ne mènent qu’à des adresses sûres', async () => {
    expect(
      await codeOf(() =>
        objectifs.enregistrerFiche(session('mariama'), agents.moussa, {
          semestre: 1,
          contenu: [],
        }),
      ),
    ).toBe('objectifs.hors_equipe');
    expect(
      await codeOf(() =>
        objectifs.enregistrerFiche(session('moussa'), agents.moussa, {
          semestre: 1,
          contenu: [],
        }),
      ),
    ).toBe('objectifs.hors_equipe');

    await objectifs.enregistrerFiche(session('mariama'), agents.awa, {
      semestre: 1,
      contenu: [
        {
          id: randomUUID(),
          type: 'paragraph',
          props: {},
          content: [
            {
              type: 'link',
              href: 'javascript:alert(1)',
              content: [{ type: 'text', text: 'piège', styles: {} }],
            },
            { type: 'link', href: 'https://apix.sn', content: [] },
          ],
          children: [],
        },
      ],
    });
    const [fiche] = (await objectifs.fiche(session('mariama'), agents.awa)).fiches;
    expect(fiche!.contenu[0]).toMatchObject({
      content: [
        { type: 'link', href: '', content: [{ text: 'piège' }] },
        { type: 'link', href: 'https://apix.sn' },
      ],
    });
  });
});

describe('le semestre : l’agent s’auto-évalue, le n+1 évalue', () => {
  const caseACocher = (id: string, texte: string, checked = false) => ({
    id,
    type: 'checkListItem',
    props: { checked },
    content: [{ type: 'text', text: texte, styles: {} }],
    children: [],
  });
  const de = <T extends { annee: number; semestre: number }>(
    fiches: T[],
    annee: number,
    semestre: number,
  ) => fiches.find((f) => f.annee === annee && f.semestre === semestre)!;
  const vueAgent = async () =>
    de((await objectifs.mesObjectifs(session('moussa'))).fiches, 2024, 1);
  const vueN1 = async () =>
    de((await objectifs.fiche(session('awa'), agents.moussa)).fiches, 2024, 1);

  it('l’agent dit où il en est, commente, envoie ; le n+1 voit, commente, note et valide', async () => {
    // Ce que le n+1 aurait coché ne compte pas : c'est l'agent qui dit où il en est.
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2024,
      semestre: 1,
      contenu: [
        caseACocher('o1', 'Livrer la note', true),
        caseACocher('o2', 'Former deux stagiaires'),
      ],
    });
    expect((await vueAgent()).statuts).toEqual({});
    expect((await vueAgent()).contenu[0]).toMatchObject({ props: { checked: false } });

    // L'agent choisit, change d'avis ; le n+1 le voit, dans la fiche même —
    // cochée, la case dit « atteint ».
    await objectifs.statuer(session('moussa'), 2024, 1, { id: 'o1', statut: 'partiel' });
    expect(
      await objectifs.statuer(session('moussa'), 2024, 1, { id: 'o1', statut: 'atteint' }),
    ).toEqual({ statuts: { o1: 'atteint' } });
    await objectifs.statuer(session('moussa'), 2024, 1, { id: 'o2', statut: 'partiel' });
    await objectifs.statuer(session('moussa'), 2024, 1, { id: 'o2', statut: null });
    const vue = await vueN1();
    expect(vue.statuts).toEqual({ o1: 'atteint' });
    expect(vue.contenu[0]).toMatchObject({ props: { checked: true } });
    expect(vue.contenu[1]).toMatchObject({ props: { checked: false } });
    expect(
      await codeOf(() =>
        objectifs.statuer(session('moussa'), 2024, 1, { id: 'zz', statut: 'atteint' }),
      ),
    ).toBe('objectifs.objectif_inconnu');

    // Ses commentaires restent à lui tant qu'il ne les envoie pas.
    await objectifs.enregistrerCommentaires(session('moussa'), 2024, 1, {
      commentaires: { o1: 'Note livrée le 12 mars.', o2: '', zz: 'hors fiche' },
    });
    expect((await vueAgent()).evaluation.commentairesAgent).toEqual({
      o1: 'Note livrée le 12 mars.',
      o2: '',
    });
    expect((await vueN1()).evaluation.commentairesAgent).toEqual({});

    // Chaque objectif a son statut et son commentaire, atteint ou non.
    expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2024, 1))).toBe(
      'objectifs.auto_evaluation_incomplete',
    );
    await objectifs.enregistrerCommentaires(session('moussa'), 2024, 1, {
      commentaires: { o1: 'Note livrée le 12 mars.', o2: 'Reporté : recrutement gelé.' },
    });
    expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2024, 1))).toBe(
      'objectifs.auto_evaluation_incomplete',
    );
    await objectifs.statuer(session('moussa'), 2024, 1, { id: 'o2', statut: 'non_atteint' });
    expect(
      await codeOf(() =>
        objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2024, 1, {
          commentaires: {},
          note: 'B',
        }),
      ),
    ).toBe('objectifs.auto_evaluation_attendue');
    await objectifs.envoyerCommentaires(session('moussa'), 2024, 1);

    // Envoyée : le n+1 la lit ; plus rien ne bouge, ni statuts ni objectifs.
    expect(await vueN1()).toMatchObject({
      statuts: { o1: 'atteint', o2: 'non_atteint' },
      evaluation: {
        commentairesAgent: { o1: 'Note livrée le 12 mars.', o2: 'Reporté : recrutement gelé.' },
      },
    });
    expect((await vueN1()).evaluation.envoyesLe).not.toBeNull();
    expect((await notifications('awa')).map((n) => n.title)).toContain(
      'Auto-évaluation de Moussa Ndiaye',
    );
    expect(
      (await objectifs.suiviEquipe(session('awa'))).membres.find((m) => m.givenName === 'Moussa')!
        .aEvaluer,
    ).toBe(1);
    expect(
      await codeOf(() =>
        objectifs.statuer(session('moussa'), 2024, 1, { id: 'o2', statut: 'atteint' }),
      ),
    ).toBe('objectifs.auto_evaluation_envoyee');
    expect(
      await codeOf(() =>
        objectifs.enregistrerFiche(session('awa'), agents.moussa, {
          annee: 2024,
          semestre: 1,
          contenu: [caseACocher('o1', 'Autre chose')],
        }),
      ),
    ).toBe('objectifs.fiche_verrouillee');

    // Le n+1 commente et note au brouillon ; seul le n+1 évalue.
    await objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2024, 1, {
      commentaires: { o1: 'Note claire, livrée à temps.' },
      note: 'B',
    });
    expect((await vueAgent()).evaluation).toMatchObject({ commentairesN1: {}, note: null });
    expect(
      await codeOf(() => objectifs.validerEvaluation(session('mariama'), agents.moussa, 2024, 1)),
    ).toBe('objectifs.hors_equipe');

    await objectifs.validerEvaluation(session('awa'), agents.moussa, 2024, 1);
    expect((await vueAgent()).evaluation).toMatchObject({
      commentairesN1: { o1: 'Note claire, livrée à temps.' },
      note: 'B',
      evaluateur: 'Awa Diop',
    });
    expect((await notifications('moussa')).map((n) => n.title)).toContain(
      'Évaluation de vos objectifs — 1er semestre 2024',
    );
    expect(
      await codeOf(() =>
        objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2024, 1, {
          commentaires: {},
          note: 'D',
        }),
      ),
    ).toBe('objectifs.evaluation_validee');
    expect(
      (await objectifs.suiviEquipe(session('awa'))).membres.find((m) => m.givenName === 'Moussa')!
        .aEvaluer,
    ).toBe(0);

    // Validée, l'évaluation entre au dossier de l'agent : lui la lit, la DCH
    // aussi ; un collègue, non.
    const attendu = [
      { annee: 2024, semestre: 1, manager: 'Awa Diop', note: 'B', valideeLe: expect.any(String) },
    ];
    expect(await objectifs.evaluationsDe(session('moussa'), agents.moussa)).toEqual(attendu);
    const dch = { ...session('fatou'), capacites: ['personnel.consulter'] } as SessionUser;
    expect(await objectifs.evaluationsDe(dch, agents.moussa)).toEqual(attendu);
    expect(await codeOf(() => objectifs.evaluationsDe(session('ousmane'), agents.moussa))).toBe(
      'objectifs.dossier_interdit',
    );
  });

  it('pas de note, pas de validation', async () => {
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2024,
      semestre: 2,
      contenu: [caseACocher('p1', 'Clore les comptes')],
    });
    await objectifs.statuer(session('moussa'), 2024, 2, { id: 'p1', statut: 'atteint' });
    await objectifs.enregistrerCommentaires(session('moussa'), 2024, 2, {
      commentaires: { p1: 'Comptes clos le 15 décembre.' },
    });
    await objectifs.envoyerCommentaires(session('moussa'), 2024, 2);
    expect(
      await codeOf(() => objectifs.validerEvaluation(session('awa'), agents.moussa, 2024, 2)),
    ).toBe('objectifs.evaluation_sans_note');
    // Pas validée : rien au dossier pour ce semestre.
    expect(
      (await objectifs.evaluationsDe(session('moussa'), agents.moussa)).map((e) => e.semestre),
    ).not.toContain(2);
    expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2023, 1))).toBe(
      'objectifs.fiche_introuvable',
    );
  });
});

describe('la session', () => {
  it('dit qui est le directeur général', async () => {
    const estDG = (qui: Nom) =>
      db.withTenant({ tenantId, userId: comptes[qui] }, async (tx) => {
        await tx.execute(sql`SELECT 1`);
        return (await capacitesDe(tx, comptes[qui], 'employee')).estDG;
      });
    expect(await estDG('dg')).toBe(true);
    expect(await estDG('mariama')).toBe(false);
  });
});
