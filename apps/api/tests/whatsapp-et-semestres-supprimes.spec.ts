/**
 * La migration 0113, sur une base jetable migrée jusqu'à 0112 : ce qui
 * restait de WhatsApp (ADR-0074) et des semestres (ADR-0075) s'en va, les
 * numéros WhatsApp quittent aussi le journal d'audit, et rien d'autre ne
 * bouge.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

const env = loadEnv();
const DEPOT = join(__dirname, '..', 'src', 'db', 'sql');
const MIGRATION = '0113_whatsapp_et_semestres_supprimes.sql';
const nomBase = `teranga_0113_${randomUUID().slice(0, 8)}`;
const url = (() => {
  const u = new URL(env.DATABASE_URL);
  u.pathname = `/${nomBase}`;
  return u.toString();
})();

const tenantId = randomUUID();
const agent = { user: randomUUID(), person: randomUUID(), employee: randomUUID() };
const reglage = randomUUID();
const fiche = randomUUID();
const NUMEROS = ['whatsapp_numero_chiffre', 'whatsapp_numero_masque', 'whatsapp_verifie_le'];

let base: Client;
let dossier: string;
const q = (sql: string, p: unknown[] = []) => base.query(sql, p as never[]);

async function proprietaire(sql: string) {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

/** Les lignes du journal sur les réglages de notifications de l'agent. */
async function journalDesReglages() {
  const { rows } = await q(
    `SELECT action, old_data, new_data FROM audit_log
      WHERE table_name = 'notification_reglages' AND row_id = $1
      ORDER BY occurred_at, action`,
    [reglage],
  );
  return rows as {
    action: string;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
  }[];
}

let journalAvant = 0;

beforeAll(async () => {
  await proprietaire(`CREATE DATABASE ${nomBase}`);
  dossier = mkdtempSync(join(tmpdir(), 'migrations-0113-'));
  for (const f of readdirSync(DEPOT).filter((f) => f.endsWith('.sql') && f < MIGRATION)) {
    copyFileSync(join(DEPOT, f), join(dossier, f));
  }
  await runMigrations(url, { dossier });
  base = new Client({ connectionString: url });
  await base.connect();

  await q(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Migration 0113',$2)`, [
    tenantId,
    `m0113-${tenantId.slice(0, 8)}`,
  ]);
  await q(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Aminata','Diallo')`,
    [agent.user, `m0113-${agent.user}@test.local`],
  );
  await q(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
     VALUES ($1,$2,$3,'Aminata','Diallo')`,
    [agent.person, tenantId, agent.user],
  );
  await q(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
     VALUES ($1,$2,$3,'M-AG','2019-01-01','active')`,
    [agent.employee, tenantId, agent.person],
  );

  // WhatsApp, tel que 0110 l'a laissé : un numéro vérifié, changé une fois
  // (le journal en garde les deux), une case cochée, une vérification, un
  // message annulé.
  await q(
    `INSERT INTO notification_reglages (id, tenant_id, user_id, whatsapp_numero_chiffre,
                                        whatsapp_numero_masque, whatsapp_verifie_le,
                                        heures_calmes, pause_conges)
     VALUES ($1,$2,$3,'chiffre-1','+221 77 ••• •• 01',now(),false,true)`,
    [reglage, tenantId, agent.user],
  );
  await q(
    `UPDATE notification_reglages
        SET whatsapp_numero_chiffre = 'chiffre-2', whatsapp_numero_masque = '+221 77 ••• •• 02'
      WHERE id = $1`,
    [reglage],
  );
  await q(
    `INSERT INTO notification_preferences (id, tenant_id, user_id, sujet, plateforme, courriel,
                                           whatsapp)
     VALUES ($1,$2,$3,'conges',true,false,true)`,
    [randomUUID(), tenantId, agent.user],
  );
  await q(
    `INSERT INTO whatsapp_verifications (id, tenant_id, user_id, numero_chiffre, numero_masque,
                                         code_hash, expire_le)
     VALUES ($1,$2,$3,'chiffre-3','+221 77 ••• •• 03','h',now())`,
    [randomUUID(), tenantId, agent.user],
  );
  await q(
    `INSERT INTO outbound_whatsapp (id, tenant_id, kind, subject_id, user_id, status)
     VALUES ($1,$2,'notification',$3,$4,'cancelled')`,
    [randomUUID(), tenantId, randomUUID(), agent.user],
  );

  // Les semestres : une fiche de l'année, sa copie d'avant 0111, les jours des
  // deux semestres à côté du jour de l'évaluation, une date d'avant 0104.
  await q(
    `INSERT INTO objectifs_fiches (id, tenant_id, employee_id, annee, contenu, evaluation_note)
     VALUES ($1,$2,$3,2025,'[{"id":"o1","type":"checkListItem"}]','B')`,
    [fiche, tenantId, agent.employee],
  );
  await q(
    `INSERT INTO objectifs_fiches_semestres (id, tenant_id, employee_id, annee, semestre)
     VALUES ($1,$2,$3,2025,2)`,
    [randomUUID(), tenantId, agent.employee],
  );
  await q(
    `INSERT INTO objective_review_schedule (id, tenant_id, s1_month, s1_day, s2_month, s2_day,
                                            review_month, review_day)
     VALUES ($1,$2,6,30,12,20,11,30)`,
    [randomUUID(), tenantId],
  );
  await q(
    `INSERT INTO objective_review_dates (id, tenant_id, year, semester, review_date)
     VALUES ($1,$2,2025,1,'2025-06-30')`,
    [randomUUID(), tenantId],
  );

  journalAvant = (await journalDesReglages()).length;
  copyFileSync(join(DEPOT, MIGRATION), join(dossier, MIGRATION));
  // Une base en service : la suppression se déclare destructive, elle se consent.
  await runMigrations(url, { dossier, destructivesPermises: [MIGRATION] });
});

afterAll(async () => {
  await base?.end();
  if (dossier) rmSync(dossier, { recursive: true, force: true });
  await proprietaire(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
});

describe('0113 : ce qui restait de WhatsApp et des semestres', () => {
  it('les tables, les colonnes et la fonction ne sont plus là', async () => {
    const { rows: tables } = await q(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('outbound_whatsapp', 'whatsapp_verifications',
                             'objectifs_fiches_semestres', 'objective_review_dates')`,
    );
    expect(tables).toEqual([]);
    const { rows: colonnes } = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (column_name LIKE '%whatsapp%' OR column_name IN ('heures_calmes', 'semestre')
               OR (table_name = 'objective_review_schedule' AND column_name ~ '^s[12]_'))`,
    );
    expect(colonnes).toEqual([]);
    const { rows: fonctions } = await q(
      `SELECT proname FROM pg_proc WHERE proname = 'outbound_whatsapp_tenants'`,
    );
    expect(fonctions).toEqual([]);
  });

  it('les numéros WhatsApp quittent le journal ; les gestes et le reste y demeurent', async () => {
    const journal = await journalDesReglages();
    expect(journal).toHaveLength(journalAvant);
    expect(journal.map((l) => l.action)).toEqual(['INSERT', 'UPDATE']);
    for (const l of journal) {
      for (const donnees of [l.old_data, l.new_data]) {
        if (!donnees) continue;
        for (const cle of NUMEROS) expect(donnees).not.toHaveProperty(cle);
        expect(donnees).toHaveProperty('pause_conges', true);
      }
    }
  });

  it('les réglages, la fiche et le jour de l’évaluation ne bougent pas', async () => {
    const { rows: reglages } = await q(
      `SELECT pause_conges FROM notification_reglages WHERE id = $1`,
      [reglage],
    );
    expect(reglages).toEqual([{ pause_conges: true }]);
    const { rows: sujets } = await q(
      `SELECT sujet, plateforme, courriel FROM notification_preferences WHERE user_id = $1`,
      [agent.user],
    );
    expect(sujets).toEqual([{ sujet: 'conges', plateforme: true, courriel: false }]);
    const { rows: fiches } = await q(
      `SELECT annee, contenu, evaluation_note FROM objectifs_fiches WHERE id = $1`,
      [fiche],
    );
    expect(fiches).toEqual([
      { annee: 2025, contenu: [{ id: 'o1', type: 'checkListItem' }], evaluation_note: 'B' },
    ]);
    const { rows: jour } = await q(
      `SELECT review_month, review_day FROM objective_review_schedule WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(jour).toEqual([{ review_month: 11, review_day: 30 }]);
    // Une fiche par année, toujours.
    await expect(
      q(
        `INSERT INTO objectifs_fiches (id, tenant_id, employee_id, annee)
         VALUES ($1,$2,$3,2025)`,
        [randomUUID(), tenantId, agent.employee],
      ),
    ).rejects.toThrow(/objectifs_fiches_une_par_annee/);
  });
});
