/**
 * Les décisions de disponibilité pour convenances personnelles, sur les
 * modèles de l'APIX (ADR-0100) : ce qu'elles DISENT, à partir de la fiche que
 * la DCH renseigne.
 *
 * La mise en disponibilité : qui la demande, son poste, la date de sa
 * demande, la prise d'effet, la date limite de reprise, les sessions du
 * conseil d'administration qui ont nommé à la direction générale et à la
 * direction générale adjointe. Le renouvellement y ajoute l'affectation, la
 * période fixée d'abord et la durée de la prorogation. Qui décide dirige la
 * direction générale ; qui exécute, la DCH. Une page. Les coquilles des
 * modèles sont corrigées (ADR-0095).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FicheDisponibilite, FicheRenouvellement, SessionUser } from '@teranga/contracts';
import {
  ficheDisponibiliteSchema,
  ficheRenouvellementSchema,
  nomDuDocumentGenere,
  repriseApresProrogation,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import {
  textesDeDecisionPour,
  textesDeLaDecision,
  type TextesDeLaDecision,
} from '../src/modules/documents/decision-disponibilite';
import type { Unite } from '../src/modules/documents/dossier';
import type { Passage } from '../src/modules/documents/feuille';
import { GenerationService } from '../src/modules/documents/generation.service';
import type { Personne } from '../src/modules/documents/redaction';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), agent: randomUUID() };
const unites = {
  sommet: randomUUID(),
  dch: randomUUID(),
  dea: randomUUID(),
  comptabilite: randomUUID(),
};
const employes = { dg: randomUUID(), dch: randomUUID() };

const session = (userId: string, s: Partial<SessionUser>) =>
  ({ userId, tenantId, role: 'employee', capacites: [], ...s }) as SessionUser;
const dch = session(ids.dch, { dirigeLaDCH: true });
const agent = session(ids.agent, {});

let ownerPool: Pool;
let db: TenantDb;
let service: GenerationService;

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

/** Une fiche complète de mise en disponibilité, à varier d'un test à l'autre. */
const fiche = (f: Partial<FicheDisponibilite> = {}): FicheDisponibilite => ({
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  demandeLe: '2025-08-29',
  effetLe: '2026-01-02',
  repriseLe: '2026-07-02',
  pvDirectionGeneraleLe: '2024-05-07',
  pvDirectionGeneraleAdjointeLe: '2024-12-13',
  ...f,
});

/** Une fiche complète de renouvellement. */
const ficheDuRenouvellement = (f: Partial<FicheRenouvellement> = {}): FicheRenouvellement => ({
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  affectation: unites.dea,
  demandeLe: '2026-06-25',
  initialementDu: '2026-01-02',
  initialementAu: '2026-07-01',
  duree: 6,
  repriseLe: '2027-01-02',
  pvDirectionGeneraleLe: '2024-05-07',
  pvDirectionGeneraleAdjointeLe: '2024-12-13',
  ...f,
});

const DG: Personne = { nom: 'Cheikh MBAYE', genre: 'male' };
const DCH: Personne = { nom: 'Mariama CISSÉ', genre: 'female' };
const DEA: Unite = { nom: 'Direction de l’Environnement des Affaires', type: 'direction' };
const AUJOURDHUI = new Date('2026-10-18T10:00:00');

type Direction = {
  directionGenerale?: Personne | null;
  directionGeneraleAdjointe?: Personne | null;
  dch?: Personne | null;
};

const decision = (f: Partial<FicheDisponibilite> = {}, d: Direction = {}) =>
  textesDeLaDecision(
    { doc: 'decision_disponibilite', fiche: fiche(f), directionGenerale: DG, dch: DCH, ...d },
    AUJOURDHUI,
  );
const renouvellement = (
  f: Partial<FicheRenouvellement> = {},
  d: Direction & { unite?: Unite } = {},
) =>
  textesDeLaDecision(
    {
      doc: 'decision_renouvellement_disponibilite',
      fiche: ficheDuRenouvellement(f),
      unite: DEA,
      directionGenerale: DG,
      dch: DCH,
      ...d,
    },
    AUJOURDHUI,
  );

/** Le texte de passages, l'espace insécable rendue ordinaire. */
const enClair = (passages: Passage[]) =>
  passages
    .map((p) => p.texte)
    .join('')
    .replace(/ /g, ' ');
const visas = (t: TextesDeLaDecision) => t.visas.map(enClair);
const article = (t: TextesDeLaDecision, i: number) => enClair(t.articles[i]!.passages);
const enGras = (t: TextesDeLaDecision, i: number) =>
  t.articles[i]!.passages.filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '));
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `dsp-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Disponibilité')`,
      [userId, `dsp-${cle}-${userId}@test.local`, cle],
    );
  }
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1, $2, 'direction', 'Direction Générale')`,
    [unites.sommet, tenantId],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1, $2, 'direction', 'Direction du Capital Humain', $3, true)`,
    [unites.dch, tenantId, unites.sommet],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
     VALUES ($1, $2, 'direction', 'Direction de l’Environnement des Affaires', $3),
            ($4, $2, 'service', 'Service Comptabilité', $3)`,
    [unites.dea, tenantId, unites.sommet, unites.comptabilite],
  );
  for (const [cle, prenom, nom, genre, userId] of [
    ['dg', 'Cheikh', 'Mbaye', 'male', null],
    ['dch', 'Mariama', 'Cissé', 'female', ids.dch],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [personId, tenantId, userId, prenom, nom, genre],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
       VALUES ($1, $2, $3, $4, '2015-01-01')`,
      [employes[cle], tenantId, personId, `DSP-${cle}`],
    );
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    unites.sommet,
    employes.dg,
  ]);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    unites.dch,
    employes.dch,
  ]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1 AND parent_id IS NOT NULL', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la fiche', () => {
  it('la mise en disponibilité : tout est obligatoire, la reprise suit la prise d’effet', () => {
    expect(ficheDisponibiliteSchema.safeParse(fiche()).success).toBe(true);
    const { demandeLe: _demandeLe, ...sansDemande } = fiche();
    expect(ficheDisponibiliteSchema.safeParse(sansDemande).success).toBe(false);
    expect(ficheDisponibiliteSchema.safeParse(fiche({ poste: ' ' })).success).toBe(false);
    expect(ficheDisponibiliteSchema.safeParse(fiche({ repriseLe: '2026-01-02' })).success).toBe(
      false,
    );
    expect(ficheDisponibiliteSchema.safeParse({ ...fiche(), duree: 6 }).success).toBe(false);
  });

  it('le renouvellement : l’affectation, une période dans l’ordre, la reprise après elle', () => {
    expect(ficheRenouvellementSchema.safeParse(ficheDuRenouvellement()).success).toBe(true);
    for (const f of [
      { affectation: 'dea' },
      { initialementAu: '2026-01-01' },
      { repriseLe: '2026-07-01' },
      { duree: 0 },
      { duree: 25 },
    ]) {
      expect(ficheRenouvellementSchema.safeParse(ficheDuRenouvellement(f)).success).toBe(false);
    }
    expect(
      ficheRenouvellementSchema.safeParse({ ...ficheDuRenouvellement(), effetLe: '2026-01-02' })
        .success,
    ).toBe(false);
  });

  it('les noms prennent leurs capitales, le poste sa première lettre', () => {
    const f = ficheDisponibiliteSchema.parse(
      fiche({ prenom: 'mouhamadou lamine', nom: 'dos santos', poste: 'chargé d’information' }),
    );
    expect([f.prenom, f.nom, f.poste]).toEqual([
      'Mouhamadou Lamine',
      'Dos Santos',
      'Chargé d’information',
    ]);
  });

  it('la reprise après une prorogation : le lendemain de sa fin', () => {
    expect(repriseApresProrogation('2026-07-01', 6)).toBe('2027-01-02');
    expect(repriseApresProrogation('2026-06-30', 6)).toBe('2027-01-01');
    // Le 31 août, prorogé de six mois, n'a pas de 31 février : fin le 28.
    expect(repriseApresProrogation('2026-08-30', 6)).toBe('2027-03-01');
    expect(repriseApresProrogation('2026-12-31', 1)).toBe('2027-02-01');
  });

  it('les sessions du conseil d’administration en place sont proposées (ADR-0123)', async () => {
    const enPlace = {
      pvDirectionGeneraleLe: '2024-05-07',
      pvDirectionGeneraleAdjointeLe: '2024-12-13',
    };
    expect(service.preremplissage(dch, 'decision_disponibilite')).toEqual(enPlace);
    expect(service.preremplissage(dch, 'decision_renouvellement_disponibilite')).toEqual(enPlace);
    // Un document sans agent qui ne sait rien d'avance : une fiche vide.
    expect(service.preremplissage(dch, 'contrat_stage')).toEqual({});
    // Les droits sont ceux de la génération.
    expect(await codeOf(async () => service.preremplissage(agent, 'decision_disponibilite'))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(async () => service.preremplissage(dch, 'attestation_travail'))).toBe(
      'documents.avec_agent',
    );
  });
});

describe('l’en-tête et les visas', () => {
  it('le numéro, Dakar le jour même, l’analyse, qui décide au genre de son dossier', () => {
    const t = decision();
    expect(t.reference).toBe('/APIX/DG/DCH');
    expect(t.lieuEtDate).toBe('Dakar, le 18 octobre 2026');
    expect(t.analyse).toBe(
      'Décision accordant une mise en disponibilité pour convenances personnelles',
    );
    expect(t.timbre).toBe('Le Directeur Général');
    expect(
      decision({}, { directionGenerale: { nom: 'Aminata DIOP', genre: 'female' } }).timbre,
    ).toBe('La Directrice Générale');
    expect(decision({}, { directionGenerale: null }).timbre).toBe('Le Directeur Général');
    expect(renouvellement().analyse).toBe(
      'Décision accordant le renouvellement d’une mise en disponibilité pour convenances ' +
        'personnelles',
    );
  });

  it('les neuf visas, coquilles corrigées', () => {
    expect(visas(decision())).toEqual([
      'Vu la Constitution ;',
      'Vu la loi n° 97-17 du 1er décembre 1997 portant Code du travail ;',
      'Vu la loi 2007-13 du 19 février 2007 autorisant la création d’une société anonyme à ' +
        'participation publique majoritaire, dénommée « APIX-SA » ;',
      'Vu la loi 2007-33 du 31 décembre 2007, modifiant la loi 2007-13 autorisant la création ' +
        'd’une société anonyme à participation publique majoritaire, dénommée « APIX-SA » ;',
      'Vu le décret 2007-1591 portant application de la loi n° 2007-13 du 19 février 2007 ' +
        'autorisant la création d’une société anonyme à participation publique majoritaire ' +
        'dénommée « APIX-SA », modifiée en certaines de ses dispositions par la loi 2007-33 du ' +
        '31 décembre 2007 ;',
      'Vu le procès-verbal de la session du 7 mai 2024 du Conseil d’Administration de la société ' +
        'anonyme APIX-SA qui a nommé le Directeur Général d’APIX-SA ;',
      'Vu le procès-verbal de la session du 13 décembre 2024 du Conseil d’Administration de la ' +
        'société anonyme APIX-SA qui a nommé le Directeur Général Adjoint d’APIX-SA ;',
      'Vu la demande de Madame Awa DIOP par lettre en date du 29 août 2025 ;',
      'Vu les nécessités de service ;',
    ]);
    expect(
      decision()
        .visas[2]!.filter((p) => p.gras)
        .map((p) => p.texte),
    ).toEqual(['« APIX-SA »']);
  });

  it('le renouvellement porte les mêmes visas ; la direction générale à son genre', () => {
    expect(visas(renouvellement({ demandeLe: '2025-08-29' }))).toEqual(visas(decision()));
    expect(
      visas(decision({}, { directionGenerale: { nom: 'Aminata DIOP', genre: 'female' } }))[5],
    ).toBe(
      'Vu le procès-verbal de la session du 7 mai 2024 du Conseil d’Administration de la société ' +
        'anonyme APIX-SA qui a nommé la Directrice Générale d’APIX-SA ;',
    );
  });

  it('la direction générale adjointe à son genre ; vacante, le texte du modèle (ADR-0126)', () => {
    const adjointe = { nom: 'Ndèye FALL', genre: 'female' };
    expect(visas(decision({}, { directionGeneraleAdjointe: adjointe }))[6]).toBe(
      'Vu le procès-verbal de la session du 13 décembre 2024 du Conseil d’Administration de la ' +
        'société anonyme APIX-SA qui a nommé la Directrice Générale Adjointe d’APIX-SA ;',
    );
    expect(visas(renouvellement({}, { directionGeneraleAdjointe: adjointe }))[6]).toMatch(
      /qui a nommé la Directrice Générale Adjointe d’APIX-SA ;$/,
    );
    expect(visas(decision({}, { directionGeneraleAdjointe: null }))[6]).toMatch(
      /qui a nommé le Directeur Général Adjoint d’APIX-SA ;$/,
    );
  });
});

describe('les articles', () => {
  it('la mise en disponibilité, à compter du jour dit ; le nom et la date en gras', () => {
    const t = decision();
    expect(t.articles.map((a) => a.titre)).toEqual([
      'Article 1er',
      'Article 2',
      'Article 3',
      'Article 4',
    ]);
    expect(article(t, 0)).toBe(
      'Madame Awa DIOP, Chargée d’études, est mise en position de disponibilité pour convenances ' +
        'personnelles, à compter du 2 janvier 2026.',
    );
    expect(enGras(t, 0)).toEqual(['Madame Awa DIOP', '2 janvier 2026.']);
    expect(
      article(decision({ civilite: 'monsieur', prenom: 'Moussa', poste: 'Comptable' }), 0),
    ).toBe(
      'Monsieur Moussa DIOP, Comptable, est mis en position de disponibilité pour convenances ' +
        'personnelles, à compter du 2 janvier 2026.',
    );
  });

  it('le renouvellement proroge la période initiale, à l’unité d’affectation', () => {
    const t = renouvellement();
    expect(article(t, 0)).toBe(
      'La période de disponibilité de Madame Awa DIOP, Chargée d’études à la Direction de ' +
        'l’Environnement des Affaires, initialement fixée du 2 janvier au 1er juillet 2026, est ' +
        'prorogée pour une durée de six (6) mois.',
    );
    expect(enGras(t, 0)).toEqual(['Madame Awa DIOP', 'six (6) mois']);
    // D'une année à l'autre, chaque date a la sienne ; un service, « au ».
    expect(
      article(
        renouvellement(
          { initialementDu: '2025-07-02', initialementAu: '2026-01-01', duree: 12 },
          { unite: { nom: 'Service Comptabilité', type: 'service' } },
        ),
        0,
      ),
    ).toMatch(
      /Chargée d’études au Service Comptabilité, initialement fixée du 2 juillet 2025 au 1er janvier 2026, est prorogée pour une durée de douze \(12\) mois\.$/,
    );
  });

  it('sans rémunération, selon le Code du travail', () => {
    expect(article(decision(), 1)).toBe(
      'Pendant cette période de disponibilité, conformément aux dispositions de l’article L.68 du ' +
        'Code du travail, Madame Awa DIOP ne percevra aucune rémunération et cessera de bénéficier ' +
        'de ses droits à l’avancement et à la retraite.',
    );
  });

  it('la démission sans reprise, accordée à la personne ; la date en gras', () => {
    expect(article(decision(), 2)).toBe(
      'L’intéressée sera considérée comme démissionnaire de son emploi si elle ne reprend pas ' +
        'service le 2 juillet 2026, à l’expiration de sa période de disponibilité.',
    );
    expect(enGras(decision(), 2)).toEqual(['2 juillet 2026']);
    expect(article(decision({ civilite: 'monsieur' }), 2)).toBe(
      'L’intéressé sera considéré comme démissionnaire de son emploi s’il ne reprend pas service ' +
        'le 2 juillet 2026, à l’expiration de sa période de disponibilité.',
    );
    expect(article(renouvellement(), 2)).toMatch(/reprend pas service le 2 janvier 2027,/);
  });

  it('qui dirige la DCH exécute, au genre de son dossier', () => {
    const execution = (d: Personne | null) => article(decision({}, { dch: d }), 3);
    expect(execution(DCH)).toBe(
      'La Directrice du Capital Humain est chargée de l’exécution de la présente décision qui ' +
        'sera enregistrée et communiquée partout où besoin sera.',
    );
    expect(execution({ nom: 'Ousmane FALL', genre: 'male' })).toMatch(
      /^Le Directeur du Capital Humain est chargé de l’exécution/,
    );
    expect(execution(null)).toMatch(/^Le Directeur du Capital Humain est chargé de l’exécution/);
  });

  it('les ampliations, au dossier de la personne', () => {
    expect(decision().ampliations).toEqual(['- DCH', '- DFC', '- Dossier de l’intéressée']);
    expect(renouvellement({ civilite: 'monsieur' }).ampliations).toEqual([
      '- DCH',
      '- DFC',
      '- Dossier de l’intéressé',
    ]);
  });
});

describe('la génération', () => {
  it('qui dirige la DCH, sans agent : une page, nommée d’après la personne', async () => {
    const mise = await service.pdfSansAgent(dch, 'decision_disponibilite', fiche());
    expect(mise.filename).toBe('decision-disponibilite-DIOP-Awa.pdf');
    expect(mise.filename).toBe(nomDuDocumentGenere('decision_disponibilite', 'DIOP-Awa'));
    expect(pages(mise.pdf)).toBe(1);
    // Arial (Arimo dans le dépôt) ; le timbre en Comic Sans MS (Comic Relief).
    const brut = mise.pdf.toString('latin1');
    expect(/\/BaseFont \/[A-Z]{6}\+(Arimo|Arial)/.test(brut)).toBe(true);
    expect(/\/BaseFont \/[A-Z]{6}\+(ComicRelief|ComicSans)/.test(brut)).toBe(true);
    const renouvelee = await service.pdfSansAgent(
      dch,
      'decision_renouvellement_disponibilite',
      ficheDuRenouvellement(),
    );
    expect(renouvelee.filename).toBe('decision-renouvellement-disponibilite-DIOP-Awa.pdf');
    expect(pages(renouvelee.pdf)).toBe(1);
  });

  it('une saisie longue se serre, sans passer à une seconde page', async () => {
    const { pdf } = await service.pdfSansAgent(
      dch,
      'decision_renouvellement_disponibilite',
      ficheDuRenouvellement({
        prenom: 'Mouhamadou Moustapha Lamine',
        nom: 'Dos Santos Ndiaye',
        poste: 'Assistante de direction chargée du suivi des dossiers du conseil d’administration',
      }),
    );
    expect(pages(pdf)).toBe(1);
  });

  it('qui décide, qui exécute et l’unité viennent de l’organigramme', async () => {
    const t = await db.withTenant({ tenantId, userId: ids.dch }, (tx) =>
      textesDeDecisionPour(
        tx,
        'decision_renouvellement_disponibilite',
        ficheDuRenouvellement({ affectation: unites.comptabilite }),
      ),
    );
    expect(t.timbre).toBe('Le Directeur Général');
    expect(article(t, 0)).toMatch(/Chargée d’études au Service Comptabilité,/);
    expect(article(t, 3)).toMatch(/^La Directrice du Capital Humain est chargée/);
  });

  it('une unité inconnue, une fiche incomplète, personne d’autre que qui dirige la DCH', async () => {
    expect(
      await codeOf(() =>
        service.pdfSansAgent(
          dch,
          'decision_renouvellement_disponibilite',
          ficheDuRenouvellement({ affectation: randomUUID() }),
        ),
      ),
    ).toBe('documents.affectation');
    expect(
      await codeOf(() =>
        service.pdfSansAgent(dch, 'decision_disponibilite', fiche({ repriseLe: '2025-12-31' })),
      ),
    ).toBe('validation_failed');
    expect(await codeOf(() => service.pdfSansAgent(agent, 'decision_disponibilite', fiche()))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(() => service.pdf(dch, 'decision_disponibilite', employes.dg))).toBe(
      'documents.sans_agent',
    );
  });
});
