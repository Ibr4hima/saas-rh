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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser, StatutSuivi } from '@teranga/contracts';
import {
  fixerObjectifsSchema,
  jourDeLAnneeSchema,
  objectifsDeLaFiche,
  periodeDeLEcheance,
  reglesDesEcheances,
  statutDeFormation,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademySuiviService } from '../src/modules/academy/academy-suivi.service';
import { capacitesDe } from '../src/modules/acces/dch';
import { ObjectifsService } from '../src/modules/objectifs/objectifs.service';
import { reconcilierLeCircuit } from '../src/modules/time/visas';

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

/** Le message que l'écran affiche. */
async function titreOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.title;
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

/** La boîte : ce qui a été remplacé par plus récent n'y est plus. */
async function notifications(qui: Nom): Promise<{ title: string; link: string | null }[]> {
  const { rows } = await raw(
    `SELECT title, link FROM notifications
      WHERE recipient_user_id = $1 AND remplacee_le IS NULL ORDER BY created_at`,
    [comptes[qui]],
  );
  return rows as { title: string; link: string | null }[];
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  objectifs = new ObjectifsService(db, new AcademySuiviService());
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
        expect.stringMatching(/ a fixé les orientations 2026 de l’APIX$/),
        expect.stringMatching(/ a fixé les objectifs 2026 de votre direction$/),
        'Awa Diop vous a fixé un objectif : Livrer l’étude sectorielle',
      ]),
    );
    expect(moussa.every((n) => n.link === '/moi/objectifs')).toBe(true);
    // Les orientations réservées aux directeurs ne sont pas annoncées à Moussa :
    // une seule notification d'orientations par jour, et c'est celle « à tous ».
    expect(moussa.filter((n) => n.title.includes('orientations'))).toHaveLength(1);
    // Fatou n'est pas de la DCH.
    expect((await notifications('fatou')).map((n) => n.title)).not.toContain(
      'Awa Diop vous a fixé un objectif : Livrer l’étude sectorielle',
    );
    // Le DG ne se prévient pas lui-même.
    expect(await notifications('dg')).toEqual([]);
  });

  it('les orientations de l’année suivante, fixées le même jour, s’annoncent à part', async () => {
    await objectifs.creer(session('dg'), {
      niveau: 'apix',
      diffusion: 'tous',
      nature: 'libre',
      titre: 'Préparer le plan stratégique suivant',
      annee: 2027,
    });
    const titres = (await notifications('moussa')).map((n) => n.title);
    expect(titres).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ a fixé les orientations 2026 de l’APIX$/),
        expect.stringMatching(/ a fixé les orientations 2027 de l’APIX$/),
      ]),
    );
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
      'Awa Diop vous a fixé une formation : Excel avancé',
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
      'Awa Diop a évalué votre objectif « Rendre le rapport trimestriel »',
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

  it('le n+1 la rédige par semestre ; l’agent la lit dans « Mes objectifs », prévenu à chaque enregistrement', async () => {
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
    const clore = [bloc('checkListItem', 'Clore les comptes', { checked: true })];
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      semestre: 1,
      contenu: clore,
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
    // Chaque enregistrement qui change une fiche prévient l'agent, et le
    // dernier avis d'une fiche prend la place des précédents.
    const fichesNotifiees = async () =>
      (await notifications('moussa')).filter((n) => n.title.includes('vos objectifs du'));
    expect(await fichesNotifiees()).toEqual([
      { title: 'Awa Diop a mis à jour vos objectifs du 2nd semestre 2026', link: '/moi/objectifs' },
      { title: 'Awa Diop a fixé vos objectifs du 1er semestre 2026', link: '/moi/objectifs' },
    ]);
    const { rows: avis } = await raw(
      `SELECT count(*)::int AS n FROM notifications
        WHERE recipient_user_id = $1 AND dedupe_key LIKE 'objectifs:fiche:%'`,
      [comptes.moussa],
    );
    expect(avis[0]).toEqual({ n: 3 });

    // La fiche renvoyée telle quelle : rien ne s'écrit, personne n'est prévenu.
    const majLe = (await objectifs.fiche(session('awa'), agents.moussa)).fiches.find(
      (f) => f.annee === 2026 && f.semestre === 1,
    )!.majLe;
    const meme = await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2026,
      semestre: 1,
      contenu: clore,
    });
    expect(meme.majLe).toBe(majLe);
    expect(await fichesNotifiees()).toEqual([
      { title: 'Awa Diop a mis à jour vos objectifs du 2nd semestre 2026', link: '/moi/objectifs' },
      { title: 'Awa Diop a fixé vos objectifs du 1er semestre 2026', link: '/moi/objectifs' },
    ]);

    // Changée : « mis à jour » prend la place de « fixé ».
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2026,
      semestre: 1,
      contenu: [...clore, bloc('checkListItem', 'Publier le rapport annuel')],
    });
    expect(await fichesNotifiees()).toEqual([
      { title: 'Awa Diop a mis à jour vos objectifs du 2nd semestre 2026', link: '/moi/objectifs' },
      { title: 'Awa Diop a mis à jour vos objectifs du 1er semestre 2026', link: '/moi/objectifs' },
    ]);
  });

  it('le n+1 fixe à l’avance les objectifs de l’année suivante', async () => {
    const suivante = (await objectifs.fiche(session('awa'), agents.moussa)).annee + 1;
    try {
      await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
        annee: suivante,
        semestre: 1,
        contenu: [bloc('checkListItem', 'Préparer le budget de l’année')],
      });
      expect(
        (await objectifs.fiche(session('awa'), agents.moussa)).fiches.map((f) => [
          f.annee,
          f.semestre,
        ]),
      ).toContainEqual([suivante, 1]);
      expect((await notifications('moussa')).map((n) => n.title)).toContain(
        `Awa Diop a fixé vos objectifs du 1er semestre ${suivante}`,
      );
    } finally {
      await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = $2`, [
        agents.moussa,
        suivante,
      ]);
    }
  });

  it('une séance d’écriture laisse une trace au journal, pas une par enregistrement', async () => {
    const ecrire = (texte: string) =>
      objectifs.enregistrerFiche(session('awa'), agents.moussa, {
        annee: 2024,
        semestre: 1,
        contenu: [bloc('paragraph', texte)],
      });
    for (let i = 1; i <= 15; i += 1) await ecrire(`Brouillon ${i}`);
    const traces = async () =>
      (
        await raw(
          `SELECT a.action, a.old_data->'contenu'->0->'content'->0->>'text' AS avant
             FROM audit_log a JOIN objectifs_fiches f ON f.id = a.row_id
            WHERE a.table_name = 'objectifs_fiches' AND f.employee_id = $1 AND f.annee = 2024
            ORDER BY a.occurred_at, a.action`,
          [agents.moussa],
        )
      ).rows;
    expect(await traces()).toEqual([{ action: 'INSERT', avant: null }]);
    // Dix minutes sans écrire : la séance suivante laisse sa trace, et son
    // « avant » est l'état où la précédente s'est arrêtée.
    await raw(
      `UPDATE audit_log SET occurred_at = occurred_at - interval '11 minutes'
        WHERE table_name = 'objectifs_fiches'`,
    );
    await ecrire('Version relue');
    expect(await traces()).toEqual([
      { action: 'INSERT', avant: null },
      { action: 'UPDATE', avant: 'Brouillon 15' },
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
    // L'avis mène à l'évaluation, sur l'année de la fiche.
    expect(await notifications('awa')).toContainEqual({
      title: 'Moussa Ndiaye a envoyé son auto-évaluation du 1er semestre 2024',
      link: `/moi/equipe/suivi/${agents.moussa}?vue=evaluation&annee=2024`,
    });
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
      'Awa Diop a évalué vos objectifs du 1er semestre 2024',
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

    // Validée, l'évaluation entre au dossier de l'agent : lui la lit, le
    // directeur du Capital Humain aussi ; ni qui consulte les dossiers, ni
    // l'administrateur, ni un collègue.
    const attendu = [
      { annee: 2024, semestre: 1, manager: 'Awa Diop', note: 'B', valideeLe: expect.any(String) },
    ];
    expect(await objectifs.evaluationsDe(session('moussa'), agents.moussa)).toEqual(attendu);
    const dch = { ...session('fatou'), dirigeLaDCH: true } as SessionUser;
    expect(await objectifs.evaluationsDe(dch, agents.moussa)).toEqual(attendu);
    for (const qui of [
      session('ousmane'),
      { ...session('fatou'), capacites: ['personnel.consulter'] } as SessionUser,
      { ...session('fatou'), role: 'admin' } as SessionUser,
    ]) {
      expect(await codeOf(() => objectifs.evaluationsDe(qui, agents.moussa))).toBe(
        'objectifs.dossier_interdit',
      );
    }
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

  it('un objectif réécrit par le n+1 perd le statut donné à l’ancien texte', async () => {
    const ecrire = (texte: string) =>
      objectifs.enregistrerFiche(session('awa'), agents.moussa, {
        annee: 2025,
        semestre: 1,
        contenu: [caseACocher('r1', texte), caseACocher('r2', 'Former deux stagiaires')],
      });
    const agent = async () => de((await objectifs.mesObjectifs(session('moussa'))).fiches, 2025, 1);
    const empreinte = async (id: string) =>
      objectifsDeLaFiche((await agent()).contenu).find((o) => o.id === id)!.empreinte;

    await ecrire('Livrer la note');
    const lue = await empreinte('r1');
    await objectifs.statuer(session('moussa'), 2025, 1, {
      id: 'r1',
      statut: 'atteint',
      empreinte: lue,
    });
    await objectifs.statuer(session('moussa'), 2025, 1, { id: 'r2', statut: 'partiel' });
    await objectifs.enregistrerCommentaires(session('moussa'), 2025, 1, {
      commentaires: { r1: 'Livrée.', r2: 'Un sur deux.' },
    });

    // Le n+1 réécrit l'objectif : le statut ne répond plus au texte.
    await ecrire('Livrer la note et le rapport annuel');
    expect(await agent()).toMatchObject({ statuts: { r2: 'partiel' }, statutsCaducs: ['r1'] });
    expect((await agent()).contenu[0]).toMatchObject({ props: { checked: false } });
    expect(
      de((await objectifs.fiche(session('awa'), agents.moussa)).fiches, 2025, 1).statuts,
    ).toEqual({ r2: 'partiel' });
    expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2025, 1))).toBe(
      'objectifs.auto_evaluation_incomplete',
    );
    // Un écran resté sur l'ancien texte ne passe pas.
    expect(
      await codeOf(() =>
        objectifs.statuer(session('moussa'), 2025, 1, {
          id: 'r1',
          statut: 'atteint',
          empreinte: lue,
        }),
      ),
    ).toBe('objectifs.objectif_modifie');

    // Le texte d'origine revient : le statut aussi.
    await ecrire('Livrer la note');
    expect((await agent()).statuts).toEqual({ r1: 'atteint', r2: 'partiel' });

    await ecrire('Livrer la note et le rapport annuel');
    await objectifs.statuer(session('moussa'), 2025, 1, {
      id: 'r1',
      statut: 'partiel',
      empreinte: await empreinte('r1'),
    });
    expect(await agent()).toMatchObject({
      statuts: { r1: 'partiel', r2: 'partiel' },
      statutsCaducs: [],
    });
    await objectifs.envoyerCommentaires(session('moussa'), 2025, 1);
    await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2025`, [
      agents.moussa,
    ]);
  });

  it('envoyée, la fiche garde l’état de ses formations ce jour-là', async () => {
    const courseId = randomUUID();
    const moduleId = randomUUID();
    await raw(
      `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id)
       VALUES ($1,$2,'Word pour tous','bureautique', now(), $3)`,
      [courseId, tenantId, comptes.dg],
    );
    await raw(
      `INSERT INTO academy_modules (id, tenant_id, course_id, position, title) VALUES ($1,$2,$3,0,'Bases')`,
      [moduleId, tenantId, courseId],
    );
    const lecon = async (position: number) => {
      const id = randomUUID();
      await raw(
        `INSERT INTO academy_lessons (id, tenant_id, course_id, module_id, position, title,
           video_provider, video_uid, video_status, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,'local',$7,'prete',60)`,
        [id, tenantId, courseId, moduleId, position, `Leçon ${position + 1}`, randomUUID()],
      );
      return id;
    };
    for (const id of [await lecon(0), await lecon(1)]) {
      await raw(
        `INSERT INTO academy_lesson_progress (tenant_id, employee_id, lesson_id, watched, watched_seconds, completed_at, updated_at)
         VALUES ($1,$2,$3,'[[0,60]]',60, now(), now())`,
        [tenantId, agents.moussa, id],
      );
    }
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2025,
      semestre: 2,
      contenu: [
        caseACocher('w1', 'Suivre la formation Word'),
        {
          id: 'f1',
          type: 'formation',
          props: { courseId, titre: 'Word pour tous' },
          children: [],
        },
      ],
    });
    const fiche = async () => de((await objectifs.mesObjectifs(session('moussa'))).fiches, 2025, 2);
    expect((await fiche()).formations).toBeNull();
    // La formation est un objectif : terminée, elle est atteinte. Son statut
    // vient de l'Academy, l'agent ne le choisit pas.
    expect((await fiche()).statuts).toEqual({ f1: 'atteint' });
    expect(
      await codeOf(() =>
        objectifs.statuer(session('moussa'), 2025, 2, { id: 'f1', statut: 'non_atteint' }),
      ),
    ).toBe('objectifs.statut_de_formation');
    expect(
      (await objectifs.statuer(session('moussa'), 2025, 2, { id: 'w1', statut: 'partiel' }))
        .statuts,
    ).toEqual({ w1: 'partiel', f1: 'atteint' });
    await objectifs.statuer(session('moussa'), 2025, 2, { id: 'w1', statut: 'atteint' });
    await objectifs.enregistrerCommentaires(session('moussa'), 2025, 2, {
      commentaires: { w1: 'Terminée.' },
    });
    await objectifs.envoyerCommentaires(session('moussa'), 2025, 2);
    const figee = { courseId, statut: 'terminee', lecons: 2, validees: 2 };
    expect((await fiche()).formations).toEqual([figee]);

    // Une leçon ajoutée depuis rouvre le parcours au présent, pas dans la fiche envoyée.
    await lecon(2);
    const moi = await objectifs.mesObjectifs(session('moussa'));
    expect(moi.formations.find((f) => f.courseId === courseId)).toMatchObject({ lecons: 3 });
    expect(de(moi.fiches, 2025, 2).formations).toEqual([figee]);
    expect(
      de((await objectifs.fiche(session('awa'), agents.moussa)).fiches, 2025, 2).formations,
    ).toEqual([figee]);
    // Son statut aussi : la formation, rouverte depuis, reste atteinte dans la fiche.
    expect(de(moi.fiches, 2025, 2).statuts).toEqual({ w1: 'atteint', f1: 'atteint' });
    expect(
      de((await objectifs.fiche(session('awa'), agents.moussa)).fiches, 2025, 2).statuts.f1,
    ).toBe('atteint');
    await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2025`, [
      agents.moussa,
    ]);
  });

  it('une fiche qui ne donne qu’une formation à suivre s’envoie, et s’évalue', async () => {
    const courseId = randomUUID();
    await raw(
      `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id)
       VALUES ($1,$2,'Excel avancé','bureautique', now(), $3)`,
      [courseId, tenantId, comptes.dg],
    );
    try {
      await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
        annee: 2021,
        semestre: 2,
        contenu: [
          { id: 'f2', type: 'formation', props: { courseId, titre: 'Excel avancé' }, children: [] },
        ],
      });
      const vue = async (qui: Nom) =>
        de(
          qui === 'moussa'
            ? (await objectifs.mesObjectifs(session('moussa'))).fiches
            : (await objectifs.fiche(session(qui), agents.moussa)).fiches,
          2021,
          2,
        );
      // Pas commencée : non atteinte. Le commentaire de l'agent est libre.
      expect((await vue('moussa')).statuts).toEqual({ f2: 'non_atteint' });
      expect(
        (await notifications('moussa')).filter((n) =>
          n.title.includes('vos objectifs du 2nd semestre 2021'),
        ),
      ).toHaveLength(1);
      await objectifs.envoyerCommentaires(session('moussa'), 2021, 2);
      expect((await vue('awa')).statuts).toEqual({ f2: 'non_atteint' });
      // Le n+1 la commente comme un autre objectif.
      await objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2021, 2, {
        commentaires: { f2: 'À suivre avant juin.' },
        note: 'C',
      });
      await objectifs.validerEvaluation(session('awa'), agents.moussa, 2021, 2);
      expect((await vue('moussa')).evaluation).toMatchObject({
        commentairesN1: { f2: 'À suivre avant juin.' },
        note: 'C',
      });
    } finally {
      await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2021`, [
        agents.moussa,
      ]);
      await raw(`DELETE FROM academy_courses WHERE id = $1`, [courseId]);
    }
  });

  it('une fiche sans case à cocher n’a rien à évaluer : ni annonce, ni envoi', async () => {
    const texte = (type: string, t: string) => ({
      id: randomUUID(),
      type,
      props: {},
      content: [{ type: 'text', text: t, styles: {} }],
      children: [],
    });
    const redigee = [
      texte('heading', 'Objectifs du semestre'),
      texte('bulletListItem', 'Livrer la note de conjoncture'),
      {
        id: randomUUID(),
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          rows: [{ cells: [[{ type: 'text', text: 'Former deux stagiaires', styles: {} }]] }],
        },
        children: [],
      },
    ];
    const annonces = async () =>
      (await notifications('moussa')).filter((n) =>
        n.title.includes('vos objectifs du 1er semestre 2021'),
      );
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2021,
      semestre: 1,
      contenu: redigee,
    });
    // L'agent la lit, mais rien ne lui est annoncé, et elle ne part pas vide.
    expect(de((await objectifs.mesObjectifs(session('moussa'))).fiches, 2021, 1)).toBeDefined();
    expect(await annonces()).toEqual([]);
    expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2021, 1))).toBe(
      'objectifs.sans_objectif',
    );
    expect(
      de((await objectifs.mesObjectifs(session('moussa'))).fiches, 2021, 1).evaluation.envoyesLe,
    ).toBeNull();

    // Une case à cocher : c'est un objectif, l'agent en est prévenu.
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee: 2021,
      semestre: 1,
      contenu: [...redigee, caseACocher('o1', 'Livrer la note de conjoncture')],
    });
    expect(await annonces()).toHaveLength(1);
    await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2021`, [
      agents.moussa,
    ]);
  });
});

describe('un agent parti avant son évaluation', () => {
  it('reste chez son n+1 le temps qu’il l’évalue, sans objectifs à fixer', async () => {
    // Le 2nd semestre 2024 de Moussa est envoyé, pas encore évalué.
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [agents.moussa]);
    try {
      const membre = async () =>
        (await objectifs.suiviEquipe(session('awa'))).membres.find(
          (m) => m.employeeId === agents.moussa,
        );
      expect(await membre()).toMatchObject({ parti: true, aEvaluer: 1 });
      expect(
        await codeOf(() =>
          objectifs.enregistrerFiche(session('awa'), agents.moussa, {
            annee: 2025,
            semestre: 1,
            contenu: [],
          }),
        ),
      ).toBe('objectifs.hors_equipe');
      await objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2024, 2, {
        commentaires: {},
        note: 'C',
      });
      await objectifs.validerEvaluation(session('awa'), agents.moussa, 2024, 2);
      // Évalué : il quitte l'équipe.
      expect(await membre()).toBeUndefined();
      expect(await codeOf(() => objectifs.fiche(session('awa'), agents.moussa))).toBe(
        'objectifs.hors_equipe',
      );
    } finally {
      await raw(`UPDATE employees SET status = 'active' WHERE id = $1`, [agents.moussa]);
    }
  });
});

describe('le n+1 change pendant l’évaluation', () => {
  const caseACocher = (id: string, texte: string) => ({
    id,
    type: 'checkListItem',
    props: { checked: false },
    content: [{ type: 'text', text: texte, styles: {} }],
    children: [],
  });
  /** Une fiche que l'agent a remplie, prête à partir. */
  const remplie = async (annee: number, semestre: 1 | 2) => {
    await objectifs.enregistrerFiche(session('awa'), agents.moussa, {
      annee,
      semestre,
      contenu: [caseACocher('o1', 'Livrer la note')],
    });
    await objectifs.statuer(session('moussa'), annee, semestre, { id: 'o1', statut: 'atteint' });
    await objectifs.enregistrerCommentaires(session('moussa'), annee, semestre, {
      commentaires: { o1: 'Livrée.' },
    });
  };
  const nouveauN1 = async (qui: Nom | null) => {
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
      agents.moussa,
      qui ? agents[qui] : null,
    ]);
    await db.withTenant({ tenantId, userId: comptes.dg }, (tx) =>
      reconcilierLeCircuit(tx, tenantId),
    );
  };
  const appels = async () => {
    const { rows } = await raw(
      `SELECT u.given_name AS qui FROM notifications n JOIN users u ON u.id = n.recipient_user_id
        WHERE n.dedupe_key LIKE $1 ORDER BY 1`,
      [`objectifs:${agents.moussa}:2022:1:appel:%`],
    );
    return rows.map((r) => r.qui as string);
  };
  const vueDe = async (qui: Nom) =>
    (await objectifs.fiche(session(qui), agents.moussa)).fiches.find(
      (f) => f.annee === 2022 && f.semestre === 1,
    )!;

  it('l’appel suit le nouveau n+1, qui évalue sur une page blanche', async () => {
    try {
      await remplie(2022, 1);
      await objectifs.envoyerCommentaires(session('moussa'), 2022, 1);
      expect(await appels()).toEqual(['Awa']);
      // Awa commence son évaluation, puis Moussa passe sous Ousmane.
      await objectifs.enregistrerEvaluation(session('awa'), agents.moussa, 2022, 1, {
        commentaires: { o1: 'Propos d’Awa.' },
        note: 'C',
      });
      await nouveauN1('ousmane');
      expect(await appels()).toEqual(['Ousmane']);
      expect((await notifications('ousmane')).map((n) => n.title)).toContain(
        'Moussa Ndiaye a envoyé son auto-évaluation du 1er semestre 2022',
      );
      // Le brouillon d'Awa n'est pas le sien : il ne le lit pas, ne le valide pas.
      expect((await vueDe('ousmane')).evaluation).toMatchObject({
        commentairesAgent: { o1: 'Livrée.' },
        commentairesN1: {},
        note: null,
      });
      expect(
        await codeOf(() => objectifs.validerEvaluation(session('ousmane'), agents.moussa, 2022, 1)),
      ).toBe('objectifs.evaluation_sans_note');
      await objectifs.enregistrerEvaluation(session('ousmane'), agents.moussa, 2022, 1, {
        commentaires: { o1: 'Propos d’Ousmane.' },
        note: 'B',
      });
      await objectifs.validerEvaluation(session('ousmane'), agents.moussa, 2022, 1);
      expect(await appels()).toEqual([]);
      const lue = (await objectifs.mesObjectifs(session('moussa'))).fiches.find(
        (f) => f.annee === 2022 && f.semestre === 1,
      )!;
      expect(lue.evaluation).toMatchObject({
        commentairesN1: { o1: 'Propos d’Ousmane.' },
        note: 'B',
        evaluateur: 'Ousmane Fall',
      });
    } finally {
      await nouveauN1('awa');
    }
  });

  it('une auto-évaluation rouverte ne laisse pas d’appel derrière elle', async () => {
    const appelsDe = async () =>
      (
        await raw(`SELECT count(*)::int AS n FROM notifications WHERE dedupe_key LIKE $1`, [
          `objectifs:${agents.moussa}:2020:1:appel:%`,
        ])
      ).rows[0].n as number;
    try {
      await remplie(2020, 1);
      await objectifs.envoyerCommentaires(session('moussa'), 2020, 1);
      expect(await appelsDe()).toBe(1);
      // Rouverte (cf. 0081) : au passage suivant du circuit, l'appel s'en va.
      await raw(
        `UPDATE objectifs_fiches SET commentaires_envoyes_le = NULL
          WHERE employee_id = $1 AND annee = 2020`,
        [agents.moussa],
      );
      await nouveauN1('awa');
      expect(await appelsDe()).toBe(0);
    } finally {
      await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2020`, [
        agents.moussa,
      ]);
    }
  });

  it('sans n+1, l’auto-évaluation ne part pas dans le vide', async () => {
    try {
      await remplie(2022, 2);
      await nouveauN1(null);
      expect(await codeOf(() => objectifs.envoyerCommentaires(session('moussa'), 2022, 2))).toBe(
        'objectifs.sans_n1',
      );
    } finally {
      await nouveauN1('awa');
    }
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

describe('statut d’une formation à suivre', () => {
  const suivi = (validees: number, statut: StatutSuivi = 'en_cours', lecons = 10) => ({
    courseId: 'c',
    statut,
    lecons,
    validees,
  });

  it('non atteinte sous la moitié, partielle jusqu’au certificat, atteinte certifiée', () => {
    expect(statutDeFormation(undefined)).toBe('non_atteint');
    expect(statutDeFormation(suivi(0, 'a_commencer'))).toBe('non_atteint');
    expect(statutDeFormation(suivi(4))).toBe('non_atteint');
    expect(statutDeFormation(suivi(5))).toBe('partiel');
    expect(statutDeFormation(suivi(9))).toBe('partiel');
    // Toutes les leçons vues, l'évaluation pas encore réussie : partielle.
    expect(statutDeFormation(suivi(10, 'evaluation_a_passer'))).toBe('partiel');
    expect(statutDeFormation(suivi(10, 'non_reussie'))).toBe('partiel');
    // Certifiée ; ou terminée, quand elle n'a pas d'évaluation : atteinte.
    expect(statutDeFormation(suivi(10, 'certifiee'))).toBe('atteint');
    expect(statutDeFormation(suivi(10, 'terminee'))).toBe('atteint');
    // Certifiée, elle le reste si une leçon s'ajoute depuis.
    expect(statutDeFormation(suivi(8, 'certifiee'))).toBe('atteint');
    // Sans leçon, rien n'a été vu.
    expect(statutDeFormation(suivi(0, 'en_cours', 0))).toBe('non_atteint');
  });
});

describe('les dates d’évaluation', () => {
  const dch = () => ({ ...session('mariama'), dirigeLaDCH: true }) as SessionUser;
  // Qui a l'habilitation « pilotage » sans diriger la DCH : lit, ne change rien.
  const pilote = () => ({ ...session('awa'), capacites: ['pilotage'] }) as SessionUser;
  const le = (jour: string) => () => new Date(`${jour}T09:00:00Z`);
  const fixer = (semestre1: string, semestre2: string, qui = dch()) =>
    objectifs.fixerDatesEvaluation(qui, { semestre1, semestre2 });
  const code = (semestre1: string, semestre2: string, qui = dch()) =>
    codeOf(() => fixer(semestre1, semestre2, qui));
  const journal = async () =>
    (
      await raw(
        `SELECT action FROM audit_log
          WHERE tenant_id = $1 AND table_name = 'objective_review_schedule'
          ORDER BY occurred_at`,
        [tenantId],
      )
    ).rows.map((r) => r.action as string);

  afterAll(() => {
    objectifs.horloge = () => maintenant;
  });

  it('par défaut, le 30 juin et le 31 décembre, posés sur l’année en cours', async () => {
    objectifs.horloge = le('2026-09-28');
    expect(await objectifs.datesEvaluation(dch())).toEqual({
      annee: 2026,
      dates: [
        { semestre: 1, jour: '06-30', date: '2026-06-30' },
        { semestre: 2, jour: '12-31', date: '2026-12-31' },
      ],
      modifiables: true,
    });
    expect((await objectifs.datesEvaluation(pilote())).modifiables).toBe(false);
  });

  it('qui dirige la DCH fixe le jour et le mois, pour cette année et les suivantes', async () => {
    objectifs.horloge = le('2026-09-28');
    // Le 15 juillet est passé cette année : il vaut quand même, et vaudra en 2027.
    expect((await fixer('07-15', '12-15')).dates).toEqual([
      { semestre: 1, jour: '07-15', date: '2026-07-15' },
      { semestre: 2, jour: '12-15', date: '2026-12-15' },
    ]);
    expect((await objectifs.datesEvaluation(pilote())).dates.map((d) => d.jour)).toEqual([
      '07-15',
      '12-15',
    ]);
    // Les mêmes jours encore : rien ne change, pas même le journal.
    await fixer('07-15', '12-15');
    expect(await journal()).toEqual(['INSERT']);
    // D'autres : la même ligne, mise à jour. Une seule par organisation.
    await fixer('07-15', '12-20');
    expect(await journal()).toEqual(['INSERT', 'UPDATE']);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM objective_review_schedule WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('personne d’autre ne les fixe', async () => {
    for (const qui of [
      pilote(),
      session('dg'),
      { ...session('fatou'), role: 'admin' } as SessionUser,
    ]) {
      expect(await code('06-30', '12-31', qui)).toBe('objectifs.dates_reservees');
    }
  });

  it('le 1er semestre s’évalue avant le 2nd', async () => {
    expect(await code('12-31', '12-31')).toBe('objectifs.dates_dans_l_ordre');
    expect(await code('09-01', '06-30')).toBe('objectifs.dates_dans_l_ordre');
  });

  it('un jour qui revient chaque année : ni 29 février, ni 31 avril', async () => {
    const valable = (v: string) => jourDeLAnneeSchema.safeParse(v).success;
    expect(['06-30', '12-31', '02-28', '01-01'].every(valable)).toBe(true);
    for (const v of ['02-29', '04-31', '13-01', '00-10', '06-00', '6-30', '2026-06-30']) {
      expect(valable(v), v).toBe(false);
    }
    // La base le refuse aussi, comme deux dates à l'envers.
    await expect(
      raw(`UPDATE objective_review_schedule SET s1_month = 2, s1_day = 29 WHERE tenant_id = $1`, [
        tenantId,
      ]),
    ).rejects.toThrow(/objective_review_schedule_s1/);
    await expect(
      raw(
        `UPDATE objective_review_schedule SET s1_month = 12, s1_day = 31, s2_month = 6, s2_day = 30
          WHERE tenant_id = $1`,
        [tenantId],
      ),
    ).rejects.toThrow(/objective_review_schedule_order/);
  });

  it('les deux dates de l’année passées, la page montre l’année suivante', async () => {
    // Le 2nd semestre s'évalue le 20 décembre : le lendemain, place à 2027.
    objectifs.horloge = le('2026-12-21');
    expect(await objectifs.datesEvaluation(dch())).toEqual({
      annee: 2027,
      dates: [
        { semestre: 1, jour: '07-15', date: '2027-07-15' },
        { semestre: 2, jour: '12-20', date: '2027-12-20' },
      ],
      modifiables: true,
    });
    // Le jour même, c'est encore l'année en cours.
    objectifs.horloge = le('2026-12-20');
    expect((await objectifs.datesEvaluation(dch())).annee).toBe(2026);
  });
});

describe('les objectifs à échéance', () => {
  // Ousmane fixe les objectifs de Fatou ; la DCH, les jours d'évaluation.
  const dch = () => ({ ...session('mariama'), dirigeLaDCH: true }) as SessionUser;
  const le = (jour: string) => () => new Date(`${jour}T09:00:00Z`);
  const fixer = (...liste: [string, string][]) =>
    objectifs.fixerObjectifs(session('ousmane'), agents.fatou, {
      objectifs: liste.map(([texte, echeance]) => ({ texte, echeance })),
    });
  const jours = (semestre1: string, semestre2: string) =>
    objectifs.fixerDatesEvaluation(dch(), { semestre1, semestre2 });
  const ficheDe = async (annee: number, semestre: 1 | 2) =>
    (await objectifs.fiche(session('ousmane'), agents.fatou)).fiches.find(
      (f) => f.annee === annee && f.semestre === semestre,
    );
  /** Les objectifs d'une fiche, dans l'ordre où ils se lisent : « échéance texte ». */
  const lignes = async (annee: number, semestre: 1 | 2) => {
    const f = await ficheDe(annee, semestre);
    return f ? objectifsDeLaFiche(f.contenu).map((o) => `${o.echeance} ${o.texte}`) : [];
  };
  const objectif = async (annee: number, semestre: 1 | 2, texte: string) =>
    objectifsDeLaFiche((await ficheDe(annee, semestre))!.contenu).find((o) => o.texte === texte)!;
  /** La fiche relue par le n+1, une échéance changée. */
  const avecEcheance = async (annee: number, semestre: 1 | 2, texte: string, echeance: string) => {
    const f = (await ficheDe(annee, semestre))!;
    const { id } = await objectif(annee, semestre, texte);
    return f.contenu.map((b) =>
      b.id === id ? { ...b, props: { ...(b.props as object), echeance } } : b,
    );
  };
  const enregistrer = (annee: number, semestre: 1 | 2, contenu: Record<string, unknown>[]) =>
    objectifs.enregistrerFiche(session('ousmane'), agents.fatou, { annee, semestre, contenu });
  const avis = async () =>
    (await notifications('fatou'))
      .map((n) => n.title)
      .filter((t) => t.includes('vos objectifs du'))
      .sort();

  beforeEach(async () => {
    await raw(`DELETE FROM objectifs_fiches WHERE employee_id = $1`, [agents.fatou]);
    await raw(`DELETE FROM notifications WHERE recipient_user_id = $1`, [comptes.fatou]);
    await raw(`DELETE FROM objective_review_schedule WHERE tenant_id = $1`, [tenantId]);
    objectifs.horloge = le('2026-02-01');
  });

  afterAll(() => {
    objectifs.horloge = () => maintenant;
  });

  it('la règle se lit avec les jours que la DCH a fixés', () => {
    expect(reglesDesEcheances(['06-30', '12-31'])).toEqual([
      'Une échéance entre le 1er janvier et le 30 juin compte pour l’évaluation du 30 juin (S1) ;',
      'une échéance entre le 1er juillet et le 31 décembre compte pour celle du 31 décembre (S2).',
    ]);
    expect(reglesDesEcheances(['07-15', '12-15'])).toEqual([
      'Une échéance entre le 1er janvier et le 15 juillet compte pour l’évaluation du 15 juillet (S1) ;',
      'une échéance entre le 16 juillet et le 15 décembre compte pour celle du 15 décembre (S2) ;',
      'une échéance entre le 16 décembre et le 31 décembre compte pour l’évaluation du 15 juillet de l’année suivante (S1).',
    ]);
    // Le jour de l'évaluation compte encore pour elle.
    expect(periodeDeLEcheance('2026-06-30', ['06-30', '12-31'])).toEqual({
      annee: 2026,
      semestre: 1,
    });
    expect(periodeDeLEcheance('2026-07-01', ['06-30', '12-31'])).toEqual({
      annee: 2026,
      semestre: 2,
    });
    expect(periodeDeLEcheance('2026-12-31', ['06-30', '12-15'])).toEqual({
      annee: 2027,
      semestre: 1,
    });
  });

  it('le n+1 ne choisit pas le semestre : chaque objectif compte pour l’évaluation de son échéance', async () => {
    expect(
      await fixer(
        ['Rapport A', '2026-03-20'],
        ['Rapport B', '2026-07-30'],
        ['Bilan', '2026-06-30'],
      ),
    ).toEqual({
      periodes: [
        { annee: 2026, semestre: 1 },
        { annee: 2026, semestre: 2 },
      ],
    });
    expect(await lignes(2026, 1)).toEqual(['2026-03-20 Rapport A', '2026-06-30 Bilan']);
    expect(await lignes(2026, 2)).toEqual(['2026-07-30 Rapport B']);
    expect(await avis()).toEqual([
      'Ousmane Fall a fixé vos objectifs du 1er semestre 2026',
      'Ousmane Fall a fixé vos objectifs du 2nd semestre 2026',
    ]);
    // L'agent les lit de même, avec les jours d'évaluation qui les rangent.
    const mes = await objectifs.mesObjectifs(session('fatou'));
    expect(mes.joursEvaluation).toEqual(['06-30', '12-31']);
    const s1 = mes.fiches.find((f) => f.annee === 2026 && f.semestre === 1)!;
    expect(objectifsDeLaFiche(s1.contenu).map((o) => o.texte)).toEqual(['Rapport A', 'Bilan']);
  });

  it('rangés par échéance : un objectif fixé après passe devant s’il arrive plus tôt', async () => {
    await fixer(['Note de conjoncture', '2026-03-20'], ['Bilan', '2026-06-30']);
    await fixer(['Revue des comptes', '2026-02-10']);
    // À échéance égale, l'ordre où ils ont été fixés.
    await fixer(['Rapport C', '2026-03-20']);
    expect(await lignes(2026, 1)).toEqual([
      '2026-02-10 Revue des comptes',
      '2026-03-20 Note de conjoncture',
      '2026-03-20 Rapport C',
      '2026-06-30 Bilan',
    ]);
    expect(await avis()).toEqual(['Ousmane Fall a mis à jour vos objectifs du 1er semestre 2026']);
  });

  it('une échéance se fixe d’aujourd’hui à la dernière évaluation de l’année suivante', async () => {
    expect(await titreOf(() => fixer(['Hier', '2026-01-31']))).toBe(
      'L’échéance du 31 janvier 2026 est déjà passée',
    );
    expect(await codeOf(() => fixer(['Hier', '2026-01-31']))).toBe('objectifs.echeance_passee');
    expect(await titreOf(() => fixer(['Trop loin', '2028-01-01']))).toBe(
      'Une échéance se fixe au plus tard le 31 décembre 2027',
    );
    expect(await codeOf(() => fixer(['Trop loin', '2028-01-01']))).toBe(
      'objectifs.echeance_trop_lointaine',
    );
    // Un seul qui ne va pas, et rien n'est fixé.
    expect(await codeOf(() => fixer(['Valable', '2026-05-01'], ['Hier', '2026-01-31']))).toBe(
      'objectifs.echeance_passee',
    );
    expect(await ficheDe(2026, 1)).toBeUndefined();
    // Aujourd'hui même, et le dernier jour possible.
    await fixer(['Aujourd’hui', '2026-02-01'], ['Au plus tard', '2027-12-31']);
    expect(await lignes(2026, 1)).toEqual(['2026-02-01 Aujourd’hui']);
    expect(await lignes(2027, 2)).toEqual(['2027-12-31 Au plus tard']);
    // L'échéance est obligatoire, et c'est une date qui existe ; le texte, une ligne.
    const valable = (o: unknown) => fixerObjectifsSchema.safeParse({ objectifs: [o] }).success;
    expect(valable({ texte: 'Écrire', echeance: '2026-03-01' })).toBe(true);
    for (const o of [
      { texte: 'Écrire' },
      { texte: 'Écrire', echeance: '2026-02-30' },
      { texte: '  ', echeance: '2026-03-01' },
      { texte: 'x'.repeat(501), echeance: '2026-03-01' },
    ]) {
      expect(valable(o), JSON.stringify(o).slice(0, 60)).toBe(false);
    }
    expect(fixerObjectifsSchema.safeParse({ objectifs: [] }).success).toBe(false);
  });

  it('une échéance après la dernière évaluation de l’année compte pour le 1er semestre de la suivante', async () => {
    await jours('06-30', '12-15');
    expect(await fixer(['Clôture', '2026-12-20'])).toEqual({
      periodes: [{ annee: 2027, semestre: 1 }],
    });
    expect(await lignes(2027, 1)).toEqual(['2026-12-20 Clôture']);
    expect(await avis()).toEqual(['Ousmane Fall a fixé vos objectifs du 1er semestre 2027']);
  });

  it('le n+1 change une échéance : l’objectif part dans la fiche de sa nouvelle évaluation, avec ce qui s’en est dit', async () => {
    await fixer(['Rapport A', '2026-03-20'], ['Bilan', '2026-06-30'], ['Rapport B', '2026-07-30']);
    const a = await objectif(2026, 1, 'Rapport A');
    await objectifs.statuer(session('fatou'), 2026, 1, {
      id: a.id,
      statut: 'partiel',
      empreinte: a.empreinte,
    });
    await objectifs.enregistrerCommentaires(session('fatou'), 2026, 1, {
      commentaires: { [a.id]: 'Plan rédigé.' },
    });

    expect(
      await enregistrer(2026, 1, await avecEcheance(2026, 1, 'Rapport A', '2026-09-15')),
    ).toMatchObject({
      periodes: [
        { annee: 2026, semestre: 1 },
        { annee: 2026, semestre: 2 },
      ],
    });
    expect(await lignes(2026, 1)).toEqual(['2026-06-30 Bilan']);
    expect(await lignes(2026, 2)).toEqual(['2026-07-30 Rapport B', '2026-09-15 Rapport A']);
    // Le même objectif : son statut et le commentaire de l'agent l'ont suivi.
    const mes = (await objectifs.mesObjectifs(session('fatou'))).fiches;
    const s1 = mes.find((f) => f.annee === 2026 && f.semestre === 1)!;
    const s2 = mes.find((f) => f.annee === 2026 && f.semestre === 2)!;
    expect(s2.statuts[a.id]).toBe('partiel');
    expect(s2.evaluation.commentairesAgent[a.id]).toBe('Plan rédigé.');
    expect(s1.statuts[a.id]).toBeUndefined();
    expect(s1.evaluation.commentairesAgent[a.id]).toBeUndefined();
    expect(await avis()).toEqual([
      'Ousmane Fall a mis à jour vos objectifs du 1er semestre 2026',
      'Ousmane Fall a mis à jour vos objectifs du 2nd semestre 2026',
    ]);

    // Une échéance avancée, dans la même évaluation : il reste, à sa place.
    await enregistrer(2026, 2, await avecEcheance(2026, 2, 'Rapport A', '2026-07-01'));
    expect(await lignes(2026, 2)).toEqual(['2026-07-01 Rapport A', '2026-07-30 Rapport B']);
    // Une échéance passée ne se donne pas, pas plus qu'à un objectif neuf.
    expect(
      await codeOf(async () =>
        enregistrer(2026, 2, await avecEcheance(2026, 2, 'Rapport A', '2026-01-15')),
      ),
    ).toBe('objectifs.echeance_passee');
    // Retiré de la fiche, il emporte son statut et son commentaire.
    const sansA = (await ficheDe(2026, 2))!.contenu.filter((b) => b.id !== a.id);
    await enregistrer(2026, 2, sansA);
    const { rows } = await raw(
      `SELECT statuts, commentaires_agent FROM objectifs_fiches
        WHERE employee_id = $1 AND annee = 2026 AND semestre = 2`,
      [agents.fatou],
    );
    expect(rows[0]).toEqual({ statuts: {}, commentaires_agent: {} });
  });

  it('une case fixée avant les échéances prend la date d’évaluation de sa fiche, et la suit', async () => {
    const ancienne = {
      id: 'ancienne',
      type: 'checkListItem',
      props: { checked: false },
      content: [{ type: 'text', text: 'Ancienne', styles: {} }],
      children: [],
    };
    await enregistrer(2026, 2, [ancienne, { ...ancienne, id: 'vide', content: [] }]);
    expect(await lignes(2026, 2)).toEqual(['2026-12-31 Ancienne']);
    // Relue puis renvoyée telle quelle : rien ne s'écrit, elle n'a toujours
    // pas d'échéance à elle ; la coche, que la lecture pose selon le statut
    // de l'agent, ne se garde pas. La case vide ne s'est pas enregistrée.
    const lue = (await ficheDe(2026, 2))!;
    expect(await enregistrer(2026, 2, lue.contenu)).toEqual({ majLe: lue.majLe, periodes: [] });
    const contenu = async () =>
      (
        await raw(
          `SELECT contenu FROM objectifs_fiches WHERE employee_id = $1 AND annee = 2026 AND semestre = 2`,
          [agents.fatou],
        )
      ).rows[0].contenu as { id: string; props: unknown }[];
    expect((await contenu()).map((b) => [b.id, b.props])).toEqual([['ancienne', {}]]);
    // La DCH déplace l'évaluation du 2nd semestre : la case la suit.
    await jours('06-30', '12-15');
    expect(await lignes(2026, 2)).toEqual(['2026-12-15 Ancienne']);
    // Une date qui n'existe pas ne vaut pas échéance : la case garde la sienne.
    await enregistrer(
      2026,
      2,
      lue.contenu.map((b) => ({ ...b, props: { ...(b.props as object), echeance: '2026-02-30' } })),
    );
    expect((await contenu()).map((b) => b.props)).toEqual([{}]);
  });

  it('une évaluation passée garde ses objectifs : leur échéance ne change plus', async () => {
    await fixer(['Revue des comptes', '2026-02-10'], ['Rapport B', '2026-08-30']);
    objectifs.horloge = le('2026-07-10');
    expect(
      await titreOf(async () =>
        enregistrer(2026, 1, await avecEcheance(2026, 1, 'Revue des comptes', '2026-08-01')),
      ),
    ).toBe(
      'L’évaluation du 30 juin 2026 est passée : les échéances de ses objectifs ne changent plus',
    );
    // Le texte, lui, se corrige.
    const revue = await objectif(2026, 1, 'Revue des comptes');
    await enregistrer(
      2026,
      1,
      (await ficheDe(2026, 1))!.contenu.map((b) =>
        b.id === revue.id
          ? { ...b, content: [{ type: 'text', text: 'Revue des comptes annuels', styles: {} }] }
          : b,
      ),
    );
    expect(await lignes(2026, 1)).toEqual(['2026-02-10 Revue des comptes annuels']);
    // Aucun objectif ne s'y ajoute plus : son échéance serait passée.
    expect(await codeOf(() => fixer(['Trop tard', '2026-06-30']))).toBe(
      'objectifs.echeance_passee',
    );
    // Le 2nd semestre, à venir, change les siennes.
    await enregistrer(2026, 2, await avecEcheance(2026, 2, 'Rapport B', '2026-09-30'));
    expect(await lignes(2026, 2)).toEqual(['2026-09-30 Rapport B']);
  });

  it('une fiche dont l’auto-évaluation est envoyée ne reçoit plus d’objectif', async () => {
    await fixer(['Revue des comptes', '2026-02-10'], ['Rapport B', '2026-08-30']);
    const revue = await objectif(2026, 1, 'Revue des comptes');
    await objectifs.statuer(session('fatou'), 2026, 1, { id: revue.id, statut: 'atteint' });
    await objectifs.enregistrerCommentaires(session('fatou'), 2026, 1, {
      commentaires: { [revue.id]: 'Faite.' },
    });
    await objectifs.envoyerCommentaires(session('fatou'), 2026, 1);

    expect(await titreOf(() => fixer(['Encore un', '2026-05-01']))).toBe(
      'L’agent a envoyé son auto-évaluation du 1er semestre 2026 : choisissez une échéance après le 30 juin 2026',
    );
    expect(await codeOf(() => fixer(['Encore un', '2026-05-01']))).toBe(
      'objectifs.fiche_verrouillee',
    );
    // Ni par une échéance avancée.
    expect(
      await codeOf(async () =>
        enregistrer(2026, 2, await avecEcheance(2026, 2, 'Rapport B', '2026-05-01')),
      ),
    ).toBe('objectifs.fiche_verrouillee');
    expect(await lignes(2026, 2)).toEqual(['2026-08-30 Rapport B']);
    // Après sa date d'évaluation, l'échéance va au semestre suivant.
    await fixer(['Encore un', '2026-07-01']);
    expect(await lignes(2026, 2)).toEqual(['2026-07-01 Encore un', '2026-08-30 Rapport B']);
  });

  it('la DCH déplace une date : les objectifs à venir la suivent, le passé et les fiches envoyées restent', async () => {
    await fixer(['Juillet', '2026-07-10'], ['Fin d’année', '2026-12-20'], ['Mars', '2026-03-05']);
    const juillet = await objectif(2026, 2, 'Juillet');
    await objectifs.statuer(session('fatou'), 2026, 2, { id: juillet.id, statut: 'atteint' });
    await objectifs.enregistrerCommentaires(session('fatou'), 2026, 2, {
      commentaires: { [juillet.id]: 'Fait en avance.' },
    });
    // Une fiche d'avant, dont l'échéance est passée.
    await raw(
      `INSERT INTO objectifs_fiches (id, tenant_id, employee_id, annee, semestre, contenu)
       VALUES ($1, $2, $3, 2025, 2, $4::jsonb)`,
      [
        randomUUID(),
        tenantId,
        agents.fatou,
        JSON.stringify([
          {
            id: 'passe',
            type: 'checkListItem',
            props: { echeance: '2025-12-20' },
            content: [{ type: 'text', text: 'Passé', styles: {} }],
            children: [],
          },
        ]),
      ],
    );
    const avant = await avis();

    await jours('07-15', '12-15');
    // Le 10 juillet compte désormais pour l'évaluation du 15 juillet, avec
    // son statut et son commentaire ; le 20 décembre, pour le 1er semestre 2027.
    expect(await lignes(2026, 1)).toEqual(['2026-03-05 Mars', '2026-07-10 Juillet']);
    expect(await lignes(2026, 2)).toEqual([]);
    expect(await lignes(2027, 1)).toEqual(['2026-12-20 Fin d’année']);
    const s1 = (await objectifs.mesObjectifs(session('fatou'))).fiches.find(
      (f) => f.annee === 2026 && f.semestre === 1,
    )!;
    expect(s1.statuts[juillet.id]).toBe('atteint');
    expect(s1.evaluation.commentairesAgent[juillet.id]).toBe('Fait en avance.');
    // Ce qui est passé reste où il est ; et personne n'est prévenu.
    expect(await lignes(2025, 2)).toEqual(['2025-12-20 Passé']);
    expect(await avis()).toEqual(avant);

    // Le 1er semestre envoyé ne perd rien quand sa date revient au 30 juin.
    const mars = await objectif(2026, 1, 'Mars');
    for (const o of [mars, juillet]) {
      await objectifs.statuer(session('fatou'), 2026, 1, { id: o.id, statut: 'atteint' });
    }
    await objectifs.enregistrerCommentaires(session('fatou'), 2026, 1, {
      commentaires: { [mars.id]: 'Fait.', [juillet.id]: 'Fait en avance.' },
    });
    await objectifs.envoyerCommentaires(session('fatou'), 2026, 1);
    await jours('06-30', '12-31');
    expect(await lignes(2026, 1)).toEqual(['2026-03-05 Mars', '2026-07-10 Juillet']);
    expect(await lignes(2026, 2)).toEqual(['2026-12-20 Fin d’année']);
    expect(await lignes(2027, 1)).toEqual([]);
  });

  it('seul le n+1 fixe les objectifs de son direct', async () => {
    for (const qui of ['mariama', 'fatou', 'awa'] as const) {
      expect(
        await codeOf(() =>
          objectifs.fixerObjectifs(session(qui), agents.fatou, {
            objectifs: [{ texte: 'Écrire', echeance: '2026-03-01' }],
          }),
        ),
      ).toBe('objectifs.hors_equipe');
    }
  });
});
