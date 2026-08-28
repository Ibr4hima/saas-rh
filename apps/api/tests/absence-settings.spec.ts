/**
 * Paramétrage des congés : fériés fixes et mobiles, quotas et cadences
 * (migration 0019).
 *
 * Deux invariants seulement, mais tous deux silencieux si on les casse :
 *
 * 1. Les six fériés à date civile ne se déplacent pas. Un 1er mai déplacé d'un
 *    jour ne lève aucune erreur — il rend simplement un jour chômé ouvré, et
 *    tous les décomptes de l'année basculent d'un cran sans que personne ne
 *    voie rien. Le produit doit refuser, pas faire confiance à l'écran : la
 *    même API sert le formulaire ET quiconque appelle la route à la main.
 * 2. Un quota ne se verse dans un solde d'année QUE s'il est annuel. « 3 par
 *    mois » lu comme « 3 par an » donnerait un droit onze fois trop petit,
 *    et le calcul de solde ne se plaint jamais : il soustrait, c'est tout.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import {
  createAbsenceTypeSchema,
  SENEGAL_FIXED_HOLIDAYS,
  SENEGAL_MOBILE_HOLIDAYS,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AbsencesService } from '../src/modules/time/absences.service';
import { holidayDedupeKey } from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;
const ANNEE = 2031;

let ownerPool: Pool;
let db: TenantDb;
let absences: AbsencesService;
let employeeId: string;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
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

/** Repart d'un paramétrage vierge : chaque test pose ce dont il a besoin. */
async function tableRase(): Promise<void> {
  await raw('DELETE FROM absence_approvals WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM absence_requests WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM absence_balances WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM absence_types WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM holidays WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM holiday_seeds WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM notifications WHERE tenant_id = $1', [tenantId]);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  absences = new AbsencesService(db);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
             VALUES ($1, $2, 'x', 'Admin', 'Paramétrage')`,
    [adminUserId, `params-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Paramétrage', $2)`, [
    tenantId,
    `params-${tenantId.slice(0, 8)}`,
  ]);

  const personId = randomUUID();
  employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name)
             VALUES ($1, $2, 'Aïssatou', 'Ndoye')`,
    [personId, tenantId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
             VALUES ($1, $2, $3, 'PAR-001', '2020-01-06')`,
    [employeeId, tenantId, personId],
  );
});

afterAll(async () => {
  await tableRase();
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = $1', [adminUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

beforeEach(tableRase);

// ---------------------------------------------------------------------------

describe('le socle de l’année', () => {
  it('se pose à la première consultation : six dates civiles et huit fêtes à dater', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    expect(liste).toHaveLength(SENEGAL_FIXED_HOLIDAYS.length + SENEGAL_MOBILE_HOLIDAYS.length);

    const datees = liste.filter((h) => h.day != null);
    expect(datees).toHaveLength(SENEGAL_FIXED_HOLIDAYS.length);
    expect(datees.every((h) => h.fixed)).toBe(true);
    expect(datees.map((h) => h.day)).toContain(`${ANNEE}-05-01`);

    const aDater = liste.filter((h) => h.day == null);
    expect(aDater.map((h) => h.label).sort()).toEqual([...SENEGAL_MOBILE_HOLIDAYS].sort());
    expect(aDater.every((h) => h.year === ANNEE)).toBe(true);
  });

  it('ne se repose pas à la deuxième consultation', async () => {
    await absences.listHolidays(admin, ANNEE);
    const liste = await absences.listHolidays(admin, ANNEE);
    expect(liste).toHaveLength(SENEGAL_FIXED_HOLIDAYS.length + SENEGAL_MOBILE_HOLIDAYS.length);
  });

  it('range les fêtes non datées après les autres', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    const premierVide = liste.findIndex((h) => h.day == null);
    expect(premierVide).toBeGreaterThan(0);
    expect(liste.slice(premierVide).every((h) => h.day == null)).toBe(true);
  });

  it('ne double pas un férié déjà saisi avant lui', async () => {
    // Un import, ou une Tabaski entrée à la main avant d'ouvrir l'écran.
    await absences.createHoliday(admin, {
      year: ANNEE,
      day: `${ANNEE}-08-26`,
      label: 'Tabaski',
    });
    await absences.createHoliday(admin, { year: ANNEE, day: null, label: 'noël' });

    const liste = await absences.listHolidays(admin, ANNEE);
    const compte = (l: string) =>
      liste.filter((h) => h.label.toLowerCase() === l.toLowerCase()).length;
    expect(compte('Tabaski')).toBe(1);
    expect(compte('Noël')).toBe(1);
    // La ligne existante n'est pas retouchée : le Noël saisi reste non daté.
    expect(liste.find((h) => h.label.toLowerCase() === 'noël')?.day).toBeNull();
  });

  it('ne rattache pas une année à une autre', async () => {
    await absences.listHolidays(admin, ANNEE);
    const suivante = await absences.listHolidays(admin, ANNEE + 1);
    expect(suivante.every((h) => h.year === ANNEE + 1)).toBe(true);
    expect(suivante.filter((h) => h.day == null)).toHaveLength(SENEGAL_MOBILE_HOLIDAYS.length);
  });
});

describe('une date civile', () => {
  async function noel(): Promise<{ id: string; label: string }> {
    const liste = await absences.listHolidays(admin, ANNEE);
    const row = liste.find((h) => h.label === 'Noël');
    if (!row) throw new Error('Noël absent du socle');
    return row;
  }

  it('ne se déplace pas', async () => {
    const row = await noel();
    expect(
      await codeOf(() =>
        absences.updateHoliday(admin, row.id, { day: `${ANNEE}-12-26`, label: row.label }),
      ),
    ).toBe('absence.holiday_fixed');
  });

  it('se renomme sans bouger', async () => {
    const row = await noel();
    await absences.updateHoliday(admin, row.id, {
      day: `${ANNEE}-12-25`,
      label: 'Noël (Nativité)',
    });
    const liste = await absences.listHolidays(admin, ANNEE);
    expect(liste.find((h) => h.id === row.id)?.label).toBe('Noël (Nativité)');
  });

  it('se retire — rien n’est chômé pour toujours', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    const assomption = liste.find((h) => h.label === 'Assomption');
    await absences.deleteHoliday(admin, assomption!.id);
    expect((await absences.listHolidays(admin, ANNEE)).some((h) => h.label === 'Assomption')).toBe(
      false,
    );
  });

  it('retirée, ne revient pas au prochain affichage', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    const assomption = liste.find((h) => h.label === 'Assomption');
    await absences.deleteHoliday(admin, assomption!.id);
    // C'est tout l'objet de holiday_seeds : sans marque, une année incomplète
    // se ferait resemer et la ligne supprimée reviendrait.
    await absences.listHolidays(admin, ANNEE);
    await absences.listHolidays(admin, ANNEE);
    expect((await absences.listHolidays(admin, ANNEE)).some((h) => h.label === 'Assomption')).toBe(
      false,
    );
  });

  it('vidée de toute son année, ne se resème pas non plus', async () => {
    for (const h of await absences.listHolidays(admin, ANNEE)) {
      await absences.deleteHoliday(admin, h.id);
    }
    expect(await absences.listHolidays(admin, ANNEE)).toHaveLength(0);
  });
});

describe('un férié sans date', () => {
  it('s’inscrit sans qu’on sache encore quand il tombe', async () => {
    const { id } = await absences.createHoliday(admin, {
      year: ANNEE,
      day: null,
      label: 'Journée de la femme',
    });
    const row = (await absences.listHolidays(admin, ANNEE)).find((h) => h.id === id);
    expect(row?.day).toBeNull();
    expect(row?.year).toBe(ANNEE);
    expect(row?.fixed).toBe(false);
  });

  it('ne chôme rien tant qu’il n’est pas daté', async () => {
    await absences.listHolidays(admin, ANNEE); // sème les huit fêtes non datées
    // Une semaine pleine de lundi à vendredi : cinq jours ouvrés, et aucune
    // des fêtes en attente ne doit en retirer.
    const apercu = await absences.preview(admin, `${ANNEE}-06-02`, `${ANNEE}-06-06`);
    expect(apercu.workingDays).toBe(5);
    expect(apercu.holidaysSkipped).toHaveLength(0);
  });

  it('se date ensuite, et devient un jour chômé', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    const korite = liste.find((h) => h.label === 'Korité');
    await absences.updateHoliday(admin, korite!.id, { day: `${ANNEE}-06-03`, label: 'Korité' });

    const apres = (await absences.listHolidays(admin, ANNEE)).find((h) => h.id === korite!.id);
    expect(apres?.day).toBe(`${ANNEE}-06-03`);
    const apercu = await absences.preview(admin, `${ANNEE}-06-02`, `${ANNEE}-06-06`);
    expect(apercu.workingDays).toBe(4);
  });

  it('se retire comme les autres', async () => {
    const liste = await absences.listHolidays(admin, ANNEE);
    const tabaski = liste.find((h) => h.label === 'Tabaski');
    await absences.deleteHoliday(admin, tabaski!.id);
    expect((await absences.listHolidays(admin, ANNEE)).some((h) => h.label === 'Tabaski')).toBe(
      false,
    );
  });

  it('ne s’inscrit pas deux fois sur la même année', async () => {
    await absences.createHoliday(admin, { year: ANNEE, day: null, label: 'Journée de la femme' });
    expect(
      await codeOf(() =>
        absences.createHoliday(admin, { year: ANNEE, day: null, label: 'journée de la femme' }),
      ),
    ).toBe('absence.holiday_label_exists');
  });

  it('refuse une date qui tombe hors de son année', async () => {
    expect(
      await codeOf(() =>
        absences.createHoliday(admin, {
          year: ANNEE,
          day: `${ANNEE + 1}-03-11`,
          label: 'Korité',
        }),
      ),
    ).toBe('absence.holiday_year_mismatch');
  });
});

describe('une fête mobile se recale', () => {
  async function poser(day: string, label: string): Promise<string> {
    const { id } = await absences.createHoliday(admin, { year: ANNEE, day, label });
    return id;
  }

  it('change de date et d’intitulé', async () => {
    const id = await poser(`${ANNEE}-03-11`, 'Korite');
    await absences.updateHoliday(admin, id, { day: `${ANNEE}-03-12`, label: 'Korité' });
    const ferie = (await absences.listHolidays(admin, ANNEE)).find((h) => h.id === id);
    expect(ferie?.day).toBe(`${ANNEE}-03-12`);
    expect(ferie?.label).toBe('Korité');
  });

  it('emporte le rappel déjà parti pour l’ancienne date', async () => {
    const id = await poser(`${ANNEE}-03-11`, 'Korité');
    await raw(
      `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, body, dedupe_key)
       VALUES ($1, $2, $3, 'holiday_reminder', 'Korité', 'Jour chômé mercredi', $4)`,
      [randomUUID(), tenantId, adminUserId, holidayDedupeKey(`${ANNEE}-03-11`)],
    );

    await absences.updateHoliday(admin, id, { day: `${ANNEE}-03-12`, label: 'Korité' });

    const { rows } = await raw(
      'SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1',
      [tenantId],
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('laisse le rappel tranquille quand seul l’intitulé change', async () => {
    const id = await poser(`${ANNEE}-03-11`, 'Korite');
    await raw(
      `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, body, dedupe_key)
       VALUES ($1, $2, $3, 'holiday_reminder', 'Korite', 'Jour chômé mercredi', $4)`,
      [randomUUID(), tenantId, adminUserId, holidayDedupeKey(`${ANNEE}-03-11`)],
    );

    await absences.updateHoliday(admin, id, { day: `${ANNEE}-03-11`, label: 'Korité' });

    const { rows } = await raw(
      'SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1',
      [tenantId],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it('refuse une date déjà occupée', async () => {
    await poser(`${ANNEE}-03-11`, 'Korité');
    expect(
      await codeOf(() =>
        absences.createHoliday(admin, { year: ANNEE, day: `${ANNEE}-03-11`, label: 'Tabaski' }),
      ),
    ).toBe('absence.holiday_exists');
  });
});

describe('quota et cadence', () => {
  it('un quota sans cadence est refusé à la saisie', () => {
    expect(
      createAbsenceTypeSchema.safeParse({
        name: 'Récupération',
        frequency: 'monthly',
        allowanceDays: null,
      }).success,
    ).toBe(false);
  });

  it('une cadence « par événement » se passe de quota', () => {
    expect(
      createAbsenceTypeSchema.safeParse({
        name: 'Maternité',
        frequency: 'none',
        allowanceDays: null,
      }).success,
    ).toBe(true);
  });

  it('se modifient sur un type existant', async () => {
    const { id } = await absences.createType(admin, {
      name: 'Congé annuel',
      deductsBalance: true,
      allowanceDays: 24,
      frequency: 'annual',
      requiresDocument: false,
    });
    await absences.updateType(admin, id, {
      name: 'Congé annuel',
      deductsBalance: true,
      allowanceDays: 30,
      frequency: 'annual',
      requiresDocument: false,
    });
    const type = (await absences.listTypes(admin)).find((t) => t.id === id);
    expect(type?.allowanceDays).toBe(30);
    expect(type?.frequency).toBe('annual');
  });

  it('seul un quota ANNUEL alimente le solde de l’année', async () => {
    await absences.createType(admin, {
      name: 'Congé annuel',
      deductsBalance: true,
      allowanceDays: 30,
      frequency: 'annual',
      requiresDocument: false,
    });
    await absences.createType(admin, {
      name: 'Récupération',
      deductsBalance: true,
      allowanceDays: 3,
      frequency: 'monthly',
      requiresDocument: false,
    });

    const soldes = await absences.balances(admin, employeeId, ANNEE);
    expect(soldes.find((s) => s.absenceTypeName === 'Congé annuel')?.entitledDays).toBe(30);
    // 3 par mois ne fait pas 3 sur l'année : sans droit saisi, le solde reste nul.
    expect(soldes.find((s) => s.absenceTypeName === 'Récupération')?.entitledDays).toBe(0);
  });
});

describe('retirer un type d’absence', () => {
  async function deuxTypes(): Promise<{ retirable: string; autre: string }> {
    const { id: retirable } = await absences.createType(admin, {
      name: 'Mission',
      deductsBalance: false,
      allowanceDays: null,
      frequency: 'none',
      requiresDocument: true,
    });
    const { id: autre } = await absences.createType(admin, {
      name: 'Congé annuel',
      deductsBalance: true,
      allowanceDays: 30,
      frequency: 'annual',
      requiresDocument: false,
    });
    return { retirable, autre };
  }

  async function poserDemande(typeId: string, status: string): Promise<void> {
    await raw(
      `INSERT INTO absence_requests
         (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, 2, $7)`,
      [randomUUID(), tenantId, employeeId, typeId, `${ANNEE}-06-01`, `${ANNEE}-06-02`, status],
    );
  }

  it('le fait disparaître des listes sans toucher à l’historique', async () => {
    const { retirable } = await deuxTypes();
    await poserDemande(retirable, 'approved');

    await absences.deleteType(admin, retirable);

    expect((await absences.listTypes(admin)).some((t) => t.id === retirable)).toBe(false);
    const { rows } = await raw(
      'SELECT count(*)::int AS n FROM absence_requests WHERE absence_type_id = $1',
      [retirable],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it('est refusé tant qu’une demande attend un visa', async () => {
    const { retirable } = await deuxTypes();
    await poserDemande(retirable, 'pending');
    expect(await codeOf(() => absences.deleteType(admin, retirable))).toBe('absence.type_in_use');
  });

  it('est refusé sur le dernier type restant', async () => {
    const { id } = await absences.createType(admin, {
      name: 'Congé annuel',
      deductsBalance: true,
      allowanceDays: 30,
      frequency: 'annual',
      requiresDocument: false,
    });
    // Sans ce garde, la liste vide ferait resurgir les cinq types par défaut.
    expect(await codeOf(() => absences.deleteType(admin, id))).toBe('absence.type_last');
  });

  it('ne se retire pas deux fois', async () => {
    const { retirable } = await deuxTypes();
    await absences.deleteType(admin, retirable);
    expect(await codeOf(() => absences.deleteType(admin, retirable))).toBe(
      'absence.type_not_found',
    );
  });

  it('compte ce que le type a déjà servi', async () => {
    const { retirable } = await deuxTypes();
    await poserDemande(retirable, 'approved');
    await poserDemande(retirable, 'rejected');
    const type = (await absences.listTypes(admin)).find((t) => t.id === retirable);
    expect(type?.usageCount).toBe(2);
  });
});
