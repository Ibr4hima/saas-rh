/**
 * APIX Academy, de bout en bout contre la base.
 *
 * Le verrou du visionnage est éprouvé seul dans `academy-visionnage.spec.ts` ;
 * ici on vérifie qu'il est BRANCHÉ : que la réserve est bien celle de l'agent,
 * qu'une seule lecture tient à la fois, que l'ordre des leçons est tenu par le
 * serveur et pas seulement par l'écran, que les douze minutes sont relues
 * dans le fichier — et qu'un brouillon n'existe pour aucun agent.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademyService } from '../src/modules/academy/academy.service';
import { StockageVideoLocal } from '../src/modules/academy/stockage-local';

const env = loadEnv();
const tenantId = randomUUID();
const rhUserId = randomUUID();
const agentUserId = randomUUID();
const rh = { userId: rhUserId, tenantId, role: 'hr' } as SessionUser;
const agent = { userId: agentUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let stockage: StockageVideoLocal;
let academy: AcademyService;
let repertoire: string;
let horloge = Date.UTC(2026, 8, 25, 9, 0, 0);

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

/** Une boîte MP4 : taille, type, contenu. */
function boite(type: string, contenu: Buffer): Buffer {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(8 + contenu.length, 0);
  entete.write(type, 4, 'latin1');
  return Buffer.concat([entete, contenu]);
}

/** Un MP4 minimal, qui ne porte que sa durée — c'est tout ce que le serveur lit. */
function mp4(dureeSecondes: number): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(dureeSecondes * 1000), 16);
  return Buffer.concat([
    boite('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1')),
    boite('moov', boite('mvhd', mvhd)),
    boite('mdat', Buffer.alloc(256)),
  ]);
}

async function deposerVideo(lessonId: string, dureeSecondes: number) {
  const fichier = mp4(dureeSecondes);
  await academy.preparerVideo(rh, lessonId, { filename: 'lecon.mp4', size: fichier.length });
  return academy.recevoirVideo(rh, lessonId, Readable.from([fichier]));
}

/** Une formation publiée : un module, deux leçons de deux minutes. */
async function formationPubliee() {
  const { id: courseId } = await academy.creerFormation(rh, {
    title: 'Excel pour l’analyse',
    summary: 'Tableaux croisés et graphiques.',
    category: 'bureautique',
  });
  const { id: moduleId } = await academy.creerModule(rh, courseId, 'Les bases');
  const { id: l1 } = await academy.creerLecon(rh, moduleId, 'Saisir et mettre en forme');
  const { id: l2 } = await academy.creerLecon(rh, moduleId, 'Les formules');
  await deposerVideo(l1, 120);
  await deposerVideo(l2, 120);
  await academy.publier(rh, courseId, true);
  return { courseId, moduleId, l1, l2 };
}

/** Regarde honnêtement une leçon de bout en bout, battement après battement. */
async function regarder(lessonId: string, duree: number) {
  const lecture = await academy.demarrer(agent, lessonId);
  let dernier = null;
  for (let x = 0; x < duree; x += 10) {
    horloge += 10_000;
    dernier = await academy.battement(agent, lessonId, {
      sessionId: lecture.sessionId!,
      de: x,
      a: Math.min(x + 10, duree),
    });
  }
  return dernier!;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  repertoire = mkdtempSync(join(tmpdir(), 'academy-'));
  stockage = new StockageVideoLocal(repertoire);
  academy = new AcademyService(db, stockage);
  academy.horloge = () => new Date(horloge);

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Academy',$2)`, [
    tenantId,
    `academy-${tenantId.slice(0, 8)}`,
  ]);
  for (const [id, nom] of [
    [rhUserId, 'rh'],
    [agentUserId, 'agent'],
  ]) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x','Test',$3)`,
      [id, `academy-${nom}-${id}@test.local`, nom],
    );
  }
  // L'agent a un DOSSIER relié à son compte ; la RH de ce test n'en a pas —
  // elle regarde donc en aperçu.
  const personId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
     VALUES ($1,$2,$3,'Awa','Diop')`,
    [personId, tenantId, agentUserId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'ACA-001','2024-01-01')`,
    [randomUUID(), tenantId, personId],
  );
});

beforeEach(async () => {
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_viewers WHERE tenant_id = $1`, [tenantId]);
});

afterAll(async () => {
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_viewers WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1)`, [[rhUserId, agentUserId]]);
  rmSync(repertoire, { recursive: true, force: true });
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la construction du catalogue', () => {
  it('ne publie qu’une formation complète, et dit ce qui manque', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'PowerPoint',
      summary: null,
      category: 'bureautique',
    });
    expect(await codeOf(() => academy.publier(rh, id, true))).toBe(
      'academy.publication_incomplete',
    );

    const { id: moduleId } = await academy.creerModule(rh, id, 'Premiers pas');
    const { id: lecon } = await academy.creerLecon(rh, moduleId, 'Le masque');
    const vue = await academy.gestionDetail(rh, id);
    expect(vue.obstacles.map((o) => o.texte)).toEqual([
      'La leçon « Le masque » n’a pas encore de vidéo.',
    ]);

    await deposerVideo(lecon, 95.5);
    expect((await academy.gestionDetail(rh, id)).obstacles).toEqual([]);
    await academy.publier(rh, id, true);
    expect((await academy.gestionListe(rh))[0]?.published).toBe(true);
  });

  it('relit la durée DANS le fichier, et refuse au-delà de douze minutes', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'Macroéconomie',
      summary: null,
      category: 'economie',
    });
    const { id: moduleId } = await academy.creerModule(rh, id, 'Agrégats');
    const { id: lecon } = await academy.creerLecon(rh, moduleId, 'Le PIB');

    expect(await codeOf(() => deposerVideo(lecon, 13 * 60))).toBe('academy.video_too_long');
    const [l] = (await academy.gestionDetail(rh, id)).modules[0]!.lessons;
    expect(l!.videoStatus).toBe('erreur');
    expect(l!.videoError).toContain('13 min 00 s');

    // Douze minutes pile, à l'encodage près : accepté.
    expect((await deposerVideo(lecon, 720.04)).durationSeconds).toBeCloseTo(720.04);
  });

  it('refuse ce qui n’est pas une vidéo MP4', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'Conformité',
      summary: null,
      category: 'conformite',
    });
    const { id: moduleId } = await academy.creerModule(rh, id, 'Module');
    const { id: lecon } = await academy.creerLecon(rh, moduleId, 'Leçon');
    await academy.preparerVideo(rh, lecon, { filename: 'x.mp4', size: 10 });
    expect(
      await codeOf(() =>
        academy.recevoirVideo(rh, lecon, Readable.from([Buffer.from('pas une vidéo')])),
      ),
    ).toBe('academy.video_unreadable');
  });

  it('n’accepte pas de fichier qu’on n’a pas annoncé', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'Management',
      summary: null,
      category: 'management',
    });
    const { id: moduleId } = await academy.creerModule(rh, id, 'Module');
    const { id: lecon } = await academy.creerLecon(rh, moduleId, 'Leçon');
    expect(await codeOf(() => academy.recevoirVideo(rh, lecon, Readable.from([mp4(60)])))).toBe(
      'academy.upload_not_prepared',
    );
  });

  it('ne supprime rien d’une formation publiée, et efface la vidéo avec la leçon', async () => {
    const { courseId, l1 } = await formationPubliee();
    expect(await codeOf(() => academy.supprimerLecon(rh, l1))).toBe('academy.course_published');
    expect(await codeOf(() => academy.supprimerFormation(rh, courseId))).toBe(
      'academy.course_published',
    );

    const { rows } = await raw(`SELECT video_uid FROM academy_lessons WHERE id = $1`, [l1]);
    const videoUid = (rows[0] as { video_uid: string }).video_uid;
    const fichier = stockage.chemin(tenantId, videoUid);
    expect(existsSync(fichier)).toBe(true);

    await academy.publier(rh, courseId, false);
    await academy.supprimerFormation(rh, courseId);
    expect(existsSync(fichier)).toBe(false);
  });

  it('range les modules et les leçons, et les échange sur demande', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'Ordre',
      summary: null,
      category: 'metier',
    });
    const { id: a } = await academy.creerModule(rh, id, 'A');
    const { id: b } = await academy.creerModule(rh, id, 'B');
    await academy.deplacerModule(rh, b, 'haut');
    // En haut déjà : rien ne bouge, rien ne casse.
    await academy.deplacerModule(rh, b, 'haut');
    const vue = await academy.gestionDetail(rh, id);
    expect(vue.modules.map((m) => m.id)).toEqual([b, a]);
  });
});

describe('ce que voit un agent', () => {
  it('un brouillon n’existe pas pour lui ; la RH le relit en aperçu', async () => {
    const { id } = await academy.creerFormation(rh, {
      title: 'Brouillon',
      summary: null,
      category: 'metier',
    });
    expect(await academy.catalogue(agent)).toEqual([]);
    expect(await codeOf(() => academy.detail(agent, id))).toBe('academy.course_not_found');
    expect((await academy.detail(rh, id)).mode).toBe('apercu');
  });

  it('une leçon sans vidéo prête n’apparaît pas dans une formation publiée', async () => {
    const { courseId, moduleId } = await formationPubliee();
    await academy.creerLecon(rh, moduleId, 'En préparation');
    const detail = await academy.detail(agent, courseId);
    expect(detail.lessonCount).toBe(2);
    expect(detail.modules[0]!.lessons.map((l) => l.title)).not.toContain('En préparation');
  });

  it('suit la formation dans l’ordre : la leçon 2 est fermée tant que la 1 n’est pas vue', async () => {
    const { courseId, l1, l2 } = await formationPubliee();
    const detail = await academy.detail(agent, courseId);
    expect(detail.mode).toBe('suivi');
    expect(detail.modules[0]!.lessons.map((l) => l.etat)).toEqual(['a_suivre', 'verrouillee']);

    // Le serveur tient l'ordre lui-même : l'adresse de la vidéo 2 ne se
    // délivre pas, même à qui la demande directement.
    expect(await codeOf(() => academy.demarrer(agent, l2))).toBe('academy.lesson_locked');

    const fin = await regarder(l1, 120);
    expect(fin.validee).toBe(true);
    expect((await academy.detail(agent, courseId)).modules[0]!.lessons.map((l) => l.etat)).toEqual([
      'validee',
      'a_suivre',
    ]);
    expect((await academy.demarrer(agent, l2)).mode).toBe('suivi');
  });

  it('annonce la validation une fois, au battement qui franchit le seuil', async () => {
    const { l1 } = await formationPubliee();
    const lecture = await academy.demarrer(agent, l1);
    const vus: boolean[] = [];
    for (let x = 0; x < 120; x += 10) {
      horloge += 10_000;
      const r = await academy.battement(agent, l1, {
        sessionId: lecture.sessionId!,
        de: x,
        a: x + 10,
      });
      vus.push(r.vientDeValider);
    }
    // 108 s sur 120 : le seuil tombe au onzième battement, et une seule fois.
    expect(vus.filter(Boolean)).toHaveLength(1);
    expect(vus[10]).toBe(true);
  });
});

describe('les triches, côté serveur', () => {
  it('un passage déclaré d’une traite est rogné à la réserve', async () => {
    const { l1 } = await formationPubliee();
    const lecture = await academy.demarrer(agent, l1);
    horloge += 1_000;
    const r = await academy.battement(agent, l1, { sessionId: lecture.sessionId!, de: 0, a: 90 });
    expect(r.vu * 120).toBeLessThanOrEqual(20 + 1e-6);
    expect(r.validee).toBe(false);
    // Et la réouverture ne reprend pas à 120 s : seulement là où le crédit
    // s'est arrêté.
    expect((await academy.demarrer(agent, l1)).reprise).toBeLessThanOrEqual(21);
  });

  it('un saut en avant est refusé et le lecteur ramené', async () => {
    const { l1 } = await formationPubliee();
    const lecture = await academy.demarrer(agent, l1);
    horloge += 10_000;
    await academy.battement(agent, l1, { sessionId: lecture.sessionId!, de: 0, a: 10 });
    horloge += 10_000;
    const r = await academy.battement(agent, l1, { sessionId: lecture.sessionId!, de: 80, a: 90 });
    expect(r.refus).toBe('saut');
    expect(r.plusLoin).toBe(10);
    // Et la reprise se fait là où l'on a vraiment vu, pas là où l'on a sauté.
    expect((await academy.demarrer(agent, l1)).reprise).toBe(10);
  });

  it('une seule lecture à la fois : l’onglet remplacé l’apprend', async () => {
    const { l1 } = await formationPubliee();
    const premier = await academy.demarrer(agent, l1);
    const second = await academy.demarrer(agent, l1);
    horloge += 10_000;
    expect(
      await codeOf(() =>
        academy.battement(agent, l1, { sessionId: premier.sessionId!, de: 0, a: 10 }),
      ),
    ).toBe('academy.playing_elsewhere');
    const r = await academy.battement(agent, l1, { sessionId: second.sessionId!, de: 0, a: 10 });
    expect(r.refus).toBeNull();
  });

  it('recharger la page ne remplit pas la réserve', async () => {
    const { l1 } = await formationPubliee();
    let total = 0;
    // Dix ouvertures en une seconde, chacune tentant un grand passage.
    for (let k = 0; k < 10; k += 1) {
      const lecture = await academy.demarrer(agent, l1);
      horloge += 100;
      const r = await academy.battement(agent, l1, {
        sessionId: lecture.sessionId!,
        de: 0,
        a: 120,
      });
      total = r.vu * 120;
    }
    expect(total).toBeLessThanOrEqual(20 + 1 + 1e-6);
  });

  it('en aperçu, rien ne s’enregistre', async () => {
    const { l1 } = await formationPubliee();
    const lecture = await academy.demarrer(rh, l1);
    expect(lecture.mode).toBe('apercu');
    expect(lecture.sessionId).toBeNull();
    expect(
      await codeOf(() => academy.battement(rh, l1, { sessionId: randomUUID(), de: 0, a: 10 })),
    ).toBe('academy.preview_only');
  });
});

describe('le support et la vidéo', () => {
  const pdf = Buffer.from('%PDF-1.4\n% support\n');

  it('le support d’une leçon verrouillée ne se télécharge pas', async () => {
    const { l2 } = await formationPubliee();
    await academy.deposerSupport(rh, l2, 'formules.pdf', pdf);
    expect(await codeOf(() => academy.support(agent, l2))).toBe('academy.lesson_locked');
    expect((await academy.support(rh, l2)).filename).toBe('formules.pdf');
  });

  it('l’adresse de lecture est signée et datée', async () => {
    const { l1 } = await formationPubliee();
    const { source } = await academy.demarrer(agent, l1);
    const url = new URL(source.url, 'http://x');
    const [, , , tenant, uid] = url.pathname.split('/');
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    expect(existsSync(academy.media(tenant!, uid!, exp, sig))).toBe(true);
    expect(
      await codeOf(async () => academy.media(tenant!, uid!, exp, `${sig.slice(0, -1)}A`)),
    ).toBe('academy.media_forbidden');
    expect(await codeOf(async () => academy.media(tenant!, uid!, '1000', sig))).toBe(
      'academy.media_forbidden',
    );
  });

  it('remplacer la vidéo efface ce qu’on avait vu de l’ancienne, pas les validations', async () => {
    const { l1, l2 } = await formationPubliee();
    await regarder(l1, 120);
    const lecture = await academy.demarrer(agent, l2);
    horloge += 10_000;
    await academy.battement(agent, l2, { sessionId: lecture.sessionId!, de: 0, a: 10 });

    await deposerVideo(l1, 100);
    await deposerVideo(l2, 100);
    const { rows } = await raw(
      `SELECT lesson_id, completed_at IS NOT NULL AS validee FROM academy_lesson_progress
       WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([{ lesson_id: l1, validee: true }]);
  });
});
