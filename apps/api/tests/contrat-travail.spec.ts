/**
 * Les contrats de travail à durée déterminée et indéterminée, sur le modèle
 * de l'APIX (ADR-0098) : ce qu'ils DISENT, à partir de la fiche que la DCH
 * renseigne.
 *
 * La personne n'est pas encore dans l'application : sa civilité, son nom, sa
 * naissance, sa CNI et sa délivrance, sa nationalité, son adresse, puis son
 * poste, son unité d'affectation, le début, la durée d'un contrat à durée
 * déterminée, la catégorie, le salaire brut en trois parts et le treizième
 * mois. Qui représente l'APIX dirige la direction générale. Les coquilles du
 * modèle sont corrigées (ADR-0095).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FicheCdd, SessionUser } from '@teranga/contracts';
import {
  ficheCddSchema,
  ficheCdiSchema,
  majusculesDesLieux,
  nomDuDocumentGenere,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import {
  blocsDeContratDeTravailPour,
  blocsDuContratDeTravail,
  type BlocDuContratDeTravail,
  type ContratDeTravailData,
} from '../src/modules/documents/contrat-travail';
import { GenerationService } from '../src/modules/documents/generation.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), agent: randomUUID() };
const unites = {
  sommet: randomUUID(),
  dch: randomUUID(),
  audit: randomUUID(),
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

/** Une fiche complète de contrat à durée déterminée, à varier d'un test à l'autre. */
const fiche = (f: Partial<FicheCdd> = {}): FicheCdd => ({
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Ndiaye',
  naissanceLe: '2000-01-24',
  naissanceA: 'Dakar',
  cni: '2751200201234',
  cniDelivreeLe: '2018-01-17',
  cniDelivreeA: 'Dakar',
  nationalite: 'SN',
  adresse: 'Patte d’Oie Cité Impôt et Domaines - Dakar',
  poste: 'Contrôleur Interne',
  affectation: unites.audit,
  debut: '2026-04-01',
  duree: 12,
  categorie: '7a',
  salaireDeBase: 350000,
  sursalaire: 136000,
  primeDeTransport: 26000,
  treiziemeMois: true,
  ...f,
});

/** Le texte d'un bloc, l'espace insécable rendue ordinaire. */
const enClair = (b: BlocDuContratDeTravail) =>
  ('passages' in b ? b.passages.map((p) => p.texte).join('') : '').replace(/ /g, ' ');
const tousLesTextes = (blocs: BlocDuContratDeTravail[]) => blocs.map(enClair);
const quiCommencePar = (blocs: BlocDuContratDeTravail[], debut: string) =>
  tousLesTextes(blocs).find((t) => t.startsWith(debut));

const contrat = (f: Partial<FicheCdd> = {}, d: Partial<Omit<ContratDeTravailData, 'fiche'>> = {}) =>
  blocsDuContratDeTravail(
    {
      doc: 'contrat_cdd',
      fiche: fiche(f),
      unite: { nom: 'Audit Interne', type: 'department' },
      signataire: { nom: 'Bakary Séga BATHILY', genre: 'male' },
      ...d,
    },
    new Date('2026-03-30T10:00:00'),
  );

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `ctr-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Contrat')`,
      [userId, `ctr-${cle}-${userId}@test.local`, cle],
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
     VALUES ($1, $2, 'department', 'Audit Interne', $3), ($4, $2, 'service', 'Service Comptabilité', $3)`,
    [unites.audit, tenantId, unites.sommet, unites.comptabilite],
  );
  for (const [cle, prenom, nom, genre, userId] of [
    ['dg', 'Bakary Séga', 'Bathily', 'male', null],
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
      [employes[cle], tenantId, personId, `CTR-${cle}`],
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
  it('le contrat à durée déterminée exige sa durée, l’autre la refuse', () => {
    const { duree: _duree, ...sansDuree } = fiche();
    expect(ficheCddSchema.safeParse(fiche()).success).toBe(true);
    expect(ficheCddSchema.safeParse(sansDuree).success).toBe(false);
    expect(ficheCddSchema.safeParse(fiche({ duree: 25 })).success).toBe(false);
    expect(ficheCdiSchema.safeParse(sansDuree).success).toBe(true);
    expect(ficheCdiSchema.safeParse(fiche()).success).toBe(false);
  });

  it('un pays de la liste ; une CNI de treize chiffres ; un sursalaire peut être nul, pas la base', () => {
    expect(ficheCddSchema.safeParse(fiche({ nationalite: 'XX' })).success).toBe(false);
    expect(ficheCddSchema.safeParse(fiche({ cni: '27512002012' })).success).toBe(false);
    expect(ficheCddSchema.safeParse(fiche({ sursalaire: 0, primeDeTransport: 0 })).success).toBe(
      true,
    );
    expect(ficheCddSchema.safeParse(fiche({ salaireDeBase: 0 })).success).toBe(false);
  });

  it('les noms, les lieux et l’adresse prennent leurs capitales, le poste à sa première lettre', () => {
    const f = ficheCddSchema.parse(
      fiche({
        prenom: 'mouhamadou lamine',
        nom: 'dos santos',
        naissanceA: 'saint-louis',
        cniDelivreeA: 'thiès',
        adresse: 'sicap liberté 6, villa 12',
        poste: 'assistant de direction',
      }),
    );
    expect([f.prenom, f.nom, f.naissanceA, f.cniDelivreeA, f.adresse, f.poste]).toEqual([
      'Mouhamadou Lamine',
      'Dos Santos',
      'Saint-Louis',
      'Thiès',
      'Sicap Liberté 6, Villa 12',
      'Assistant de direction',
    ]);
  });
});

describe('les lieux et les adresses', () => {
  it('une capitale à chaque mot, sauf aux petits mots qui suivent le premier', () => {
    expect(majusculesDesLieux('patte d’oie cité impôt et domaines - dakar')).toBe(
      'Patte d’Oie Cité Impôt et Domaines - Dakar',
    );
    expect(majusculesDesLieux('saint-louis du sénégal')).toBe('Saint-Louis du Sénégal');
    expect(majusculesDesLieux('rue de la république')).toBe('Rue de la République');
    expect(majusculesDesLieux('de gaulle')).toBe('De Gaulle');
    // Rien ne se remet en minuscules : ce qui est saisi en capitales le reste.
    expect(majusculesDesLieux('Patte D’Oie')).toBe('Patte D’Oie');
  });

  it('à la frappe, un mot qui peut encore devenir un petit mot attend la lettre suivante', () => {
    let champ = '';
    for (const lettre of 'cité impôt et domaines, sur la route a') {
      champ = majusculesDesLieux(champ + lettre, { enCours: true });
    }
    expect(champ).toBe('Cité Impôt et Domaines, sur la Route a');
    // En quittant le champ, la règle entière.
    expect(majusculesDesLieux(champ)).toBe('Cité Impôt et Domaines, sur la Route A');
  });
});

describe('les parties', () => {
  it('l’APIX, représentée par qui dirige la direction générale, au genre de son dossier', () => {
    expect(quiCommencePar(contrat(), 'La Société Anonyme')).toBe(
      'La Société Anonyme APIX-SA, au capital de 4.950.000.000 FCFA, dont le siège social est au ' +
        '52-54, rue Mohamed V, Immeuble Alwar, numéro NINEA 28409592G3, code Sécurité Sociale ' +
        '19 2000 5620,',
    );
    expect(tousLesTextes(contrat())).toContain(
      'Agissant par l’intermédiaire de son représentant légal Monsieur Bakary Séga BATHILY, ' +
        'Directeur Général,',
    );
    expect(
      quiCommencePar(
        contrat({}, { signataire: { nom: 'Aminata DIOP', genre: 'female' } }),
        'Agissant',
      ),
    ).toBe(
      'Agissant par l’intermédiaire de sa représentante légale Madame Aminata DIOP, Directrice Générale,',
    );
    expect(quiCommencePar(contrat({}, { signataire: null }), 'Agissant')).toMatch(
      /^Agissant par l’intermédiaire de son représentant légal …+, Directeur Général,$/,
    );
  });

  it('la personne, telle que la DCH la renseigne : la CNI groupée, la nationalité par son gentilé', () => {
    const textes = tousLesTextes(contrat());
    for (const ligne of [
      'Madame Awa NDIAYE, née le 24 janvier 2000 à Dakar,',
      'CNI n° 2 751 2002 01234, délivrée le 17 janvier 2018 à Dakar,',
      'Nationalité Sénégalaise,',
      'Demeurant à Patte d’Oie Cité Impôt et Domaines - Dakar,',
      'L’Employée,',
      'd’autre part',
      'IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT, RÉGI PAR :',
    ]) {
      expect(textes).toContain(ligne);
    }
  });

  it('au masculin pour un Monsieur ; « Nationalité » accorde son gentilé au féminin', () => {
    const textes = tousLesTextes(
      contrat({ civilite: 'monsieur', prenom: 'Moussa', nom: 'Keita', nationalite: 'ML' }),
    );
    expect(textes).toContain('Monsieur Moussa KEITA, né le 24 janvier 2000 à Dakar,');
    expect(textes).toContain('Nationalité Malienne,');
    expect(textes).toContain('L’Employé,');
  });

  it('les textes applicables, coquilles corrigées', () => {
    const textes = tousLesTextes(contrat());
    expect(textes).toContain(
      'Les dispositions de la Loi n° 97-17 du 1er décembre 1997 instituant un Code du travail au ' +
        'Sénégal et par les règlements d’application de cette loi ;',
    );
    expect(textes).toContain(
      'Les parties contractantes s’engagent à se conformer aux clauses et dispositions de la ' +
        'Convention Collective Nationale Interprofessionnelle du Sénégal du 30 décembre 2019, ainsi ' +
        'qu’aux textes régissant APIX-SA.',
    );
  });
});

describe('les articles', () => {
  it('l’engagement : le poste, élidé devant une voyelle, et l’unité d’affectation', () => {
    expect(quiCommencePar(contrat(), 'La société')).toBe(
      'La société APIX-SA engage à son service Madame Awa NDIAYE, en qualité de Contrôleur Interne ' +
        'à l’Audit Interne.',
    );
    const engagement = (poste: string, nom: string, type: string) =>
      quiCommencePar(contrat({ poste }, { unite: { nom, type } }), 'La société');
    expect(engagement('Économiste', 'Direction du Capital Humain', 'direction')).toMatch(
      /en qualité d’Économiste à la Direction du Capital Humain\.$/,
    );
    expect(engagement('Comptable', 'Service Comptabilité', 'service')).toMatch(
      /en qualité de Comptable au Service Comptabilité\.$/,
    );
    expect(engagement('Chargé d’études', 'Département Études', 'department')).toMatch(
      /en qualité de Chargé d’études au Département Études\.$/,
    );
  });

  it('la durée : déterminée, avec sa fin ; indéterminée, sans fin', () => {
    const cdd = tousLesTextes(contrat());
    expect(cdd).toContain(
      'Le présent contrat est conclu pour une durée déterminée de douze (12) mois (CDD).',
    );
    expect(cdd).toContain(
      'Il prend effet à compter du 1er avril 2026 et se termine le 31 mars 2027.',
    );
    const cdi = tousLesTextes(contrat({ duree: undefined }, { doc: 'contrat_cdi' }));
    expect(cdi).toContain('Le présent contrat est conclu pour une durée indéterminée (CDI).');
    expect(cdi).toContain('Il prend effet à compter du 1er avril 2026.');
  });

  it('l’objet et les obligations, accordés à la personne, coquilles corrigées', () => {
    const auFeminin = tousLesTextes(contrat());
    expect(auFeminin).toContain(
      'Madame Awa NDIAYE est appelée à exercer la fonction définie à l’article 1 du présent contrat.',
    );
    expect(auFeminin).toContain(
      'Elle déclare formellement n’être liée à aucun employeur et qu’elle est libre de tout engagement.',
    );
    expect(auFeminin).toContain(
      'L’exercice de toute autre activité professionnelle, soit pour son compte, soit pour le compte ' +
        'd’un tiers, reste soumis à approbation de la direction d’APIX-SA.',
    );
    const auMasculin = tousLesTextes(contrat({ civilite: 'monsieur' }));
    expect(auMasculin).toContain(
      'Il déclare formellement n’être lié à aucun employeur et qu’il est libre de tout engagement.',
    );
    expect(auMasculin.some((t) => t.startsWith('Monsieur Awa NDIAYE est appelé à exercer'))).toBe(
      true,
    );
  });

  it('le salaire brut, somme de ses trois parts, en lettres puis en chiffres et en gras', () => {
    const blocs = contrat();
    const remuneration = blocs.find((b) => enClair(b).startsWith('À titre de rémunération'));
    expect(remuneration && enClair(remuneration)).toBe(
      'À titre de rémunération, Madame Awa NDIAYE perçoit à la fin de chaque mois un salaire brut ' +
        'de cinq cent douze mille (512 000) francs CFA décomposé ainsi qu’il suit :',
    );
    expect(
      remuneration && 'passages' in remuneration
        ? remuneration.passages.filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '))
        : [],
    ).toEqual(['cinq cent douze mille (512 000) francs CFA']);
    expect(blocs.filter((b) => b.type === 'montant')).toEqual([
      { type: 'montant', libelle: 'Salaire de base :', montant: 350000, avant: 18 },
      { type: 'montant', libelle: 'Sursalaire :', montant: 136000, avant: 0 },
      { type: 'montant', libelle: 'Prime de transport :', montant: 26000, avant: 0 },
    ]);
  });

  it('le treizième mois, s’il est accordé ; la catégorie en capitales', () => {
    const avec = tousLesTextes(contrat());
    expect(avec).toContain('Un treizième mois est octroyé à Madame Awa NDIAYE en fin d’année.');
    expect(avec).toContain(
      'Le poste de Contrôleur Interne est classé à la catégorie 7A de la Convention Collective du ' +
        'Commerce.',
    );
    const sans = tousLesTextes(contrat({ treiziemeMois: false, poste: 'Analyste' }));
    expect(sans.some((t) => t.includes('treizième mois'))).toBe(false);
    expect(sans).toContain(
      'Le poste d’Analyste est classé à la catégorie 7A de la Convention Collective du Commerce.',
    );
  });

  it('le lieu, les clauses et la résiliation, coquilles corrigées', () => {
    const textes = tousLesTextes(contrat());
    expect(textes).toContain('Le lieu de travail est le siège social de la société APIX-SA.');
    expect(textes.some((t) => t.endsWith('à hauteur de 90 %.'))).toBe(true);
    expect(textes.some((t) => t.endsWith('auprès de laquelle l’Employée est immatriculée.'))).toBe(
      true,
    );
    expect(textes).toContain(
      'Pour la résiliation du présent contrat, les parties se réfèrent aux dispositions de ' +
        'l’article 48 du Code du travail.',
    );
    expect(
      tousLesTextes(contrat({ civilite: 'monsieur' })).some((t) =>
        t.endsWith('auprès de laquelle l’Employé est immatriculé.'),
      ),
    ).toBe(true);
  });

  it('neuf articles sur quatre pages ; fait à Dakar le jour même ; les signatures', () => {
    const blocs = contrat();
    expect(
      blocs.filter((b) => b.type === 'article').map((b) => b.type === 'article' && b.numero),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(blocs.filter((b) => b.type === 'saut')).toHaveLength(2);
    const fait = blocs.find((b) => enClair(b).startsWith('Fait en quatre'));
    expect(fait && enClair(fait)).toBe('Fait en quatre exemplaires à Dakar, le 30 mars 2026.');
    expect(fait).toMatchObject({ align: 'right' });
    expect(tousLesTextes(blocs)).toContain(
      '(Signature précédée de la mention manuscrite « Lu et approuvé »)',
    );
    expect(blocs.at(-1)).toEqual({
      type: 'signatures',
      gauche: ['L’Employée', 'Madame Awa NDIAYE'],
      droite: ['L’Employeur', 'Le Directeur Général'],
    });
  });
});

describe('la génération', () => {
  it('qui dirige la DCH, sans agent : quatre pages en Times New Roman, nommées d’après la personne', async () => {
    const { filename, pdf } = await service.pdfSansAgent(dch, 'contrat_cdd', fiche());
    expect(filename).toBe('contrat-cdd-NDIAYE-Awa.pdf');
    expect(filename).toBe(nomDuDocumentGenere('contrat_cdd', 'NDIAYE-Awa'));
    const brut = pdf.toString('latin1');
    expect((brut.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(4);
    // Tinos dans le dépôt ; Times New Roman là où l'exploitant l'a déposée.
    expect(/\/BaseFont \/[A-Z]{6}\+(Tinos|TimesNewRoman)/.test(brut)).toBe(true);
    const { duree: _duree, ...cdi } = fiche();
    const indetermine = await service.pdfSansAgent(dch, 'contrat_cdi', cdi);
    expect(indetermine.filename).toBe('contrat-cdi-NDIAYE-Awa.pdf');
  });

  it('le représentant et l’unité viennent de l’organigramme', async () => {
    const blocs = await db.withTenant({ tenantId, userId: ids.dch }, (tx) =>
      blocsDeContratDeTravailPour(tx, 'contrat_cdd', fiche({ affectation: unites.comptabilite })),
    );
    expect(tousLesTextes(blocs)).toContain(
      'Agissant par l’intermédiaire de son représentant légal Monsieur Bakary Séga BATHILY, ' +
        'Directeur Général,',
    );
    expect(quiCommencePar(blocs, 'La société')).toMatch(/au Service Comptabilité\.$/);
  });

  it('une unité inconnue, une fiche incomplète, personne d’autre que qui dirige la DCH', async () => {
    expect(
      await codeOf(() =>
        service.pdfSansAgent(dch, 'contrat_cdd', fiche({ affectation: randomUUID() })),
      ),
    ).toBe('documents.affectation');
    expect(
      await codeOf(() => service.pdfSansAgent(dch, 'contrat_cdd', fiche({ adresse: '' }))),
    ).toBe('validation_failed');
    expect(await codeOf(() => service.pdfSansAgent(agent, 'contrat_cdd', fiche()))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(() => service.pdf(dch, 'contrat_cdi', employes.dg))).toBe(
      'documents.sans_agent',
    );
  });
});
