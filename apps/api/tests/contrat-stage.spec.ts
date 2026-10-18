/**
 * Le contrat de stage d'adaptation, sur le modèle officiel de l'APIX
 * (ADR-0094) : ce qu'il DIT, à partir de la fiche que la DCH renseigne.
 *
 * La personne n'est pas encore dans l'application : sa civilité, son nom, sa
 * naissance, sa CNI, sa filiation, son adresse, puis le stage, sa formation,
 * son poste, sa durée, son début, sa catégorie et son allocation. Tout est
 * obligatoire (ADR-0096). La fin se calcule : la veille du même quantième,
 * autant de mois plus tard. Les prénoms et les noms prennent leurs capitales
 * initiales ; la CNI s'imprime en groupes, comme sur la carte.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FicheStagiaire, SessionUser } from '@teranga/contracts';
import {
  cniGroupee,
  ficheStagiaireSchema,
  finDuStage,
  majusculesInitiales,
  nomDuDocumentGenere,
  premiereMajuscule,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { blocsDuContratDeStage, type BlocDuContrat } from '../src/modules/documents/contrat-stage';
import { GenerationService } from '../src/modules/documents/generation.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), agent: randomUUID() };
const dchEmployeeId = randomUUID();

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

/** Une fiche complète, à varier d'un test à l'autre. */
const fiche = (f: Partial<FicheStagiaire> = {}): FicheStagiaire => ({
  civilite: 'madame',
  prenom: 'Aïda',
  nom: 'Ba',
  naissanceLe: '2002-03-12',
  naissanceA: 'Pikine - Dakar',
  cni: '2751200201234',
  perePrenom: 'Mamadou',
  merePrenom: 'Fatou',
  mereNom: 'Diop',
  adresse: 'Parcelles Assainies, Unité 15 - Dakar',
  formation: 'Licence en Science de l’Information Documentaire',
  poste: 'Assistante Archiviste',
  duree: 3,
  debut: '2025-08-19',
  categorie: 'c6',
  allocation: 89474,
  ...f,
});

/** Le texte d'un bloc, l'espace insécable rendue ordinaire. */
const enClair = (b: BlocDuContrat) =>
  ('passages' in b ? b.passages.map((p) => p.texte).join('') : '').replace(/ /g, ' ');
const tousLesTextes = (blocs: BlocDuContrat[]) => blocs.map(enClair);
const blocQuiCommencePar = (blocs: BlocDuContrat[], debut: string) =>
  tousLesTextes(blocs).find((t) => t.startsWith(debut));

const contrat = (f: Partial<FicheStagiaire> = {}, genre: string | null = 'female') =>
  blocsDuContratDeStage(
    {
      stagiaire: fiche(f),
      signataire: genre === null ? null : { nom: 'Mariama CISSÉ', genre },
    },
    new Date('2025-08-18T10:00:00'),
  );

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `cst-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Contrat')`,
      [userId, `cst-${cle}-${userId}@test.local`, cle],
    );
  }
  const uDCH = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, direction_du_personnel)
     VALUES ($1, $2, 'direction', 'Direction du Capital Humain', true)`,
    [uDCH, tenantId],
  );
  const personId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender)
     VALUES ($1, $2, $3, 'Mariama', 'Cissé', 'female')`,
    [personId, tenantId, ids.dch],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1, $2, $3, 'CST-001', '2019-01-01')`,
    [dchEmployeeId, tenantId, personId],
  );
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDCH, dchEmployeeId]);
});

afterAll(async () => {
  await raw('UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM org_units WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la saisie', () => {
  it('les prénoms et les noms : une capitale à chaque mot, le reste tel que saisi', () => {
    expect(majusculesInitiales('mouhamadou moustapha lamine')).toBe('Mouhamadou Moustapha Lamine');
    expect(majusculesInitiales('dos santos')).toBe('Dos Santos');
    expect(majusculesInitiales('jean-pierre')).toBe('Jean-Pierre');
    expect(majusculesInitiales('n’diaye')).toBe('N’Diaye');
    expect(majusculesInitiales('ndèye')).toBe('Ndèye');
    expect(majusculesInitiales('DIOP')).toBe('DIOP');
    expect(majusculesInitiales('unité 15,villa 12 (dakar)')).toBe('Unité 15,Villa 12 (Dakar)');
  });

  it('la formation et le poste : la première lettre seule en capitale', () => {
    expect(premiereMajuscule('assistante archiviste')).toBe('Assistante archiviste');
    expect(premiereMajuscule('économiste')).toBe('Économiste');
    expect(premiereMajuscule('Juriste')).toBe('Juriste');
    expect(premiereMajuscule('')).toBe('');
  });

  it('la CNI en groupes, comme sur la carte, même en cours de saisie', () => {
    expect(cniGroupee('2751200201234')).toBe('2 751 2002 01234');
    expect(cniGroupee('2751')).toBe('2 751');
    expect(cniGroupee('2')).toBe('2');
    expect(cniGroupee('')).toBe('');
  });

  it('la fiche validée porte les capitales, même saisie sans elles', () => {
    const f = ficheStagiaireSchema.parse({
      ...fiche(),
      civilite: 'monsieur',
      prenom: 'mouhamadou moustapha lamine',
      nom: 'dos santos',
      perePrenom: 'el hadji',
      merePrenom: 'ndèye fatou',
      mereNom: 'sow',
    });
    const textes = tousLesTextes(
      blocsDuContratDeStage(
        { stagiaire: f, signataire: { nom: 'Mariama CISSÉ', genre: 'female' } },
        new Date(),
      ),
    );
    expect(textes).toContain('Prénom et nom : Monsieur Mouhamadou Moustapha Lamine DOS SANTOS');
    expect(textes).toContain('Filiation : Fils d’El Hadji et de Ndèye Fatou Sow');
  });

  it('le lieu et l’adresse prennent une capitale à chaque mot, la formation et le poste à la première lettre', () => {
    const f = ficheStagiaireSchema.parse({
      ...fiche(),
      naissanceA: 'saint-louis',
      adresse: 'parcelles assainies, unité 15 - dakar',
      formation: 'licence en science de l’information documentaire',
      poste: 'assistante archiviste',
    });
    const textes = tousLesTextes(
      blocsDuContratDeStage(
        { stagiaire: f, signataire: { nom: 'Mariama CISSÉ', genre: 'female' } },
        new Date(),
      ),
    );
    expect(textes).toContain('Date et lieu de naissance : 12 mars 2002 à Saint-Louis');
    expect(textes).toContain('Adresse : Parcelles Assainies, Unité 15 - Dakar');
    expect(textes.find((t) => t.startsWith('En vue de'))).toMatch(
      /inscrit en Licence en science de l’information documentaire, une formation en qualité d’Assistante archiviste\.$/,
    );
  });

  it('la filiation s’élide devant une voyelle, pas devant un y consonne', () => {
    const filiation = (f: Partial<FicheStagiaire>) =>
      blocQuiCommencePar(contrat(f), 'Filiation : ');
    expect(filiation({ perePrenom: 'Ousmane', merePrenom: 'Aminata', mereNom: 'Ba' })).toBe(
      'Filiation : Fille d’Ousmane et d’Aminata Ba',
    );
    expect(filiation({ perePrenom: 'Youssou', merePrenom: 'Yvonne', mereNom: 'Diatta' })).toBe(
      'Filiation : Fille de Youssou et d’Yvonne Diatta',
    );
  });
});

describe('la fin du stage', () => {
  it('la veille du même quantième, autant de mois plus tard', () => {
    expect(finDuStage('2025-08-19', 3)).toBe('2025-11-18');
    expect(finDuStage('2026-03-01', 1)).toBe('2026-03-31');
    expect(finDuStage('2026-12-15', 2)).toBe('2027-02-14');
  });

  it('le dernier jour du mois quand ce quantième n’existe pas', () => {
    expect(finDuStage('2026-01-31', 1)).toBe('2026-02-28');
    expect(finDuStage('2028-01-31', 1)).toBe('2028-02-29');
    expect(finDuStage('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('les parties', () => {
  it('l’APIX, représentée par qui dirige la DCH, au genre de son dossier', () => {
    expect(blocQuiCommencePar(contrat(), 'APIX-SA, au capital')).toBe(
      'APIX-SA, au capital de 4.950.000.000 FCFA, sise au 52-54, rue Mohamed V, Immeuble Alwar, ' +
        'BP 430 Dakar – Sénégal, représentée par Madame Mariama CISSÉ, la Directrice du Capital Humain',
    );
    expect(blocQuiCommencePar(contrat({}, null), 'APIX-SA, au capital')).toMatch(
      /représentée par …+, le Directeur du Capital Humain$/,
    );
  });

  it('la personne, telle que la DCH la renseigne', () => {
    const textes = tousLesTextes(contrat());
    for (const ligne of [
      'Prénom et nom : Madame Aïda BA',
      'Sexe : Féminin',
      'Date et lieu de naissance : 12 mars 2002 à Pikine - Dakar',
      'CNI n° 2 751 2002 01234',
      'Filiation : Fille de Mamadou et de Fatou Diop',
      'Adresse : Parcelles Assainies, Unité 15 - Dakar',
      'Ci-après dénommée « le Stagiaire »',
    ]) {
      expect(textes).toContain(ligne);
    }
  });

  it('au masculin pour un Monsieur', () => {
    const textes = tousLesTextes(contrat({ civilite: 'monsieur', prenom: 'Ibrahima', nom: 'Sy' }));
    for (const ligne of [
      'Prénom et nom : Monsieur Ibrahima SY',
      'Sexe : Masculin',
      'Filiation : Fils de Mamadou et de Fatou Diop',
      'Ci-après dénommé « le Stagiaire »',
    ]) {
      expect(textes).toContain(ligne);
    }
  });
});

describe('les articles', () => {
  it('l’engagement : la formation suivie et le poste, élidé devant une voyelle', () => {
    expect(blocQuiCommencePar(contrat(), 'En vue de')).toMatch(
      /au Stagiaire, inscrit en Licence en Science de l’Information Documentaire, une formation en qualité d’Assistante Archiviste\.$/,
    );
    expect(blocQuiCommencePar(contrat({ poste: 'Juriste' }), 'En vue de')).toMatch(
      /une formation en qualité de Juriste\.$/,
    );
  });

  it('la durée en lettres et en chiffres, le début et la fin calculée', () => {
    expect(blocQuiCommencePar(contrat(), 'Le présent contrat')).toBe(
      'Le présent contrat est conclu pour une durée de trois (03) mois. Il prend effet le ' +
        '19 août 2025 et se termine le 18 novembre 2025.',
    );
  });

  it('l’allocation en lettres puis en chiffres, en gras ; la catégorie en capitales', () => {
    const blocs = contrat();
    expect(blocQuiCommencePar(blocs, 'Le Stagiaire bénéficiera')).toBe(
      'Le Stagiaire bénéficiera, en application de l’article 6 du Décret n° 2015-777 fixant les ' +
        'règles applicables au contrat de stage, d’une allocation mensuelle de quatre-vingt-neuf ' +
        'mille quatre cent soixante-quatorze (89 474) FCFA TTC.',
    );
    const allocation = blocs.find((b) => enClair(b).startsWith('Le Stagiaire bénéficiera'));
    expect(
      allocation && 'passages' in allocation
        ? allocation.passages.filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '))
        : [],
    ).toEqual(['quatre-vingt-neuf mille quatre cent soixante-quatorze (89 474) FCFA TTC']);
    expect(tousLesTextes(blocs)).toContain(
      'Cette allocation est indexée, suivant la grille salariale d’APIX-SA, à la catégorie C6.',
    );
  });

  it('les coquilles du modèle corrigées : accents des titres, textes cités, mention manuscrite', () => {
    const blocs = contrat();
    expect(
      blocs.filter((b) => b.type === 'article').map((b) => b.type === 'article' && b.titre),
    ).toEqual([
      'OBJET',
      'TEXTES APPLICABLES',
      'ENGAGEMENTS DU MAÎTRE DE STAGE ET DU STAGIAIRE',
      'DURÉE DU CONTRAT',
      'ALLOCATION DE STAGE',
      'SUSPENSION DU CONTRAT DE STAGE',
      'FIN ET RÉSILIATION DU CONTRAT DE STAGE',
      'RÈGLEMENT DES LITIGES',
    ]);
    const textes = tousLesTextes(blocs);
    for (const ligne of [
      'La Loi n° 97-17 du 1er décembre 1997 instituant le Code du travail',
      'La Loi n° 2007-13 modifiée autorisant la création d’une société anonyme dénommée APIX-SA',
      'La Loi n° 2015-04 du 12 février 2015 complétant et abrogeant certaines dispositions de la ' +
        'loi n° 97-17 du 1er décembre 1997 portant Code du travail',
      'Le Décret n° 2015-777 du 2 juin 2015 fixant les règles applicables au contrat de stage',
      'Le présent article, pour son application, renvoie aux dispositions de l’article 8 du Décret ' +
        'n° 2015-777 du 2 juin 2015 fixant les règles applicables au contrat de stage.',
      '(Signature précédée de la mention manuscrite « Lu et approuvé »)',
    ]) {
      expect(textes).toContain(ligne);
    }
    expect(textes.join(' ')).not.toMatch(/d’applications|article 08|n°\d|1\/12\/1997/);
    expect(textes.filter((t) => t.endsWith(';'))).toEqual([]);
  });

  it('huit articles, sur trois pages', () => {
    const blocs = contrat();
    expect(
      blocs.filter((b) => b.type === 'article').map((b) => b.type === 'article' && b.numero),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(blocs.filter((b) => b.type === 'saut')).toHaveLength(2);
  });

  it('fait à Dakar le jour même ; les signatures des deux parties', () => {
    const blocs = contrat();
    expect(tousLesTextes(blocs)).toContain(
      'Fait en quatre (04) exemplaires à Dakar, le 18 août 2025.',
    );
    expect(blocs.at(-1)).toEqual({
      type: 'signatures',
      gauche: ['Pour le Stagiaire', 'Madame Aïda BA'],
      droite: ['Pour APIX-SA', 'La Directrice du Capital Humain'],
    });
  });
});

describe('la génération', () => {
  it('qui dirige la DCH, sans agent : un PDF de trois pages, nommé d’après la personne', async () => {
    const { filename, pdf } = await service.pdfSansAgent(dch, 'contrat_stage', fiche());
    expect(filename).toBe('contrat-stage-BA-Aida.pdf');
    expect(filename).toBe(nomDuDocumentGenere('contrat_stage', 'BA-Aïda'));
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(3);
  });

  it('personne d’autre', async () => {
    expect(await codeOf(() => service.pdfSansAgent(agent, 'contrat_stage', fiche()))).toBe(
      'auth.forbidden',
    );
  });

  it('une fiche incomplète ou fausse est refusée : tout est obligatoire, une CNI de treize chiffres', async () => {
    for (const f of [
      { cni: '275120020123' },
      { cni: '27512002012345' },
      { cni: '275120020123A' },
      { cni: '2 751 2002 01234' },
      { duree: 0 },
      { allocation: 0 },
      { prenom: '' },
      { adresse: undefined },
      { formation: ' ' },
      { poste: undefined },
      { mereNom: '' },
    ]) {
      expect(await codeOf(() => service.pdfSansAgent(dch, 'contrat_stage', fiche(f)))).toBe(
        'validation_failed',
      );
    }
    expect(await codeOf(() => service.pdfSansAgent(dch, 'contrat_stage', { prenom: 'Aïda' }))).toBe(
      'validation_failed',
    );
  });

  it('un document d’agent ne se génère pas sans agent, ni l’inverse', async () => {
    expect(await codeOf(() => service.pdfSansAgent(dch, 'attestation_travail', fiche()))).toBe(
      'documents.avec_agent',
    );
    expect(await codeOf(() => service.pdf(dch, 'contrat_stage', dchEmployeeId))).toBe(
      'documents.sans_agent',
    );
  });
});
