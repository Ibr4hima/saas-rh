/**
 * La domiciliation bancaire, sur le modèle de l'APIX (ADR-0102) : ce qu'elle
 * DIT, à partir de la fiche que la DCH renseigne.
 *
 * La personne, sa fonction, son contrat et le jour où il a commencé, le jour
 * de sa demande, sa banque et le genre de qui la dirige, son RIB, son salaire
 * mensuel net. Qui écrit dirige la DCH. La banque se nomme selon l'usage :
 * « de la CBAO », « d'Ecobank », « de La Banque Agricole ». Une page. Les
 * coquilles du modèle sont corrigées (ADR-0095).
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FicheDomiciliation, SessionUser } from '@teranga/contracts';
import {
  BANQUES,
  ficheDomiciliationSchema,
  nomDuDocumentGenere,
  ribGroupe,
} from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import {
  textesDeDomiciliationPour,
  textesDeLaDomiciliation,
  type TextesDeLaDomiciliation,
} from '../src/modules/documents/domiciliation';
import type { Passage } from '../src/modules/documents/feuille';
import { GenerationService } from '../src/modules/documents/generation.service';
import type { Personne } from '../src/modules/documents/redaction';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), agent: randomUUID() };
const unites = { sommet: randomUUID(), dch: randomUUID() };
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

/** Une fiche complète, à varier d'un test à l'autre. */
const fiche = (f: Partial<FicheDomiciliation> = {}): FicheDomiciliation => ({
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  debut: '2018-03-01',
  contrat: 'cdi',
  demandeLe: '2026-10-15',
  banque: 'cbao',
  destinataire: 'directeur_general',
  rib: 'SN0120100103612345678954',
  salaire: 650000,
  ...f,
});

const DCH: Personne = { nom: 'Mariama CISSÉ', genre: 'female' };

const lettre = (f: Partial<FicheDomiciliation> = {}, d: Personne | null = DCH) =>
  textesDeLaDomiciliation({ fiche: fiche(f), dch: d }, new Date('2026-10-18T10:00:00'));

/** Le texte de passages, l'espace insécable rendue ordinaire. */
const enClair = (passages: Passage[]) =>
  passages
    .map((p) => p.texte)
    .join('')
    .replace(/ /g, ' ');
const paragraphe = (t: TextesDeLaDomiciliation, i: number) => enClair(t.paragraphes[i]!);
const enGras = (t: TextesDeLaDomiciliation, i: number) =>
  t.paragraphes[i]!.filter((p) => p.gras).map((p) => p.texte.replace(/ /g, ' '));
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `dom-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Domiciliation')`,
      [userId, `dom-${cle}-${userId}@test.local`, cle],
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
  for (const [cle, prenom, nom, genre, userId] of [
    ['dg', 'Cheikh', 'Mbaye', 'male', null],
    ['dch', 'Moussa', 'Fall', 'male', ids.dch],
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
      [employes[cle], tenantId, personId, `DOM-${cle}`],
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
  it('tout est obligatoire ; une banque de la liste, un destinataire, un contrat', () => {
    expect(ficheDomiciliationSchema.safeParse(fiche()).success).toBe(true);
    const { demandeLe: _demandeLe, ...sansDemande } = fiche();
    expect(ficheDomiciliationSchema.safeParse(sansDemande).success).toBe(false);
    for (const f of [{ banque: 'bicis' }, { destinataire: 'dg' }, { contrat: 'stage' }]) {
      expect(ficheDomiciliationSchema.safeParse({ ...fiche(), ...f }).success).toBe(false);
    }
    expect(ficheDomiciliationSchema.safeParse(fiche({ salaire: 0 })).success).toBe(false);
  });

  it('le RIB : vingt-quatre caractères, « SN » puis des chiffres', () => {
    for (const rib of [
      'SN012010010361234567895',
      'SN01201001036123456789541',
      'BJ0120100103612345678954',
      'SN012010010361234567895A',
      'SN012 01001 036123456789 54',
    ]) {
      expect(ficheDomiciliationSchema.safeParse(fiche({ rib })).success).toBe(false);
    }
    expect(ribGroupe('SN0120100103612345678954')).toBe('SN012 01001 036123456789 54');
    // Commencé, il se groupe déjà, comme le champ le montre.
    expect(ribGroupe('SN0120100')).toBe('SN012 0100');
    expect(ribGroupe('SN')).toBe('SN');
  });

  it('les noms prennent leurs capitales, la fonction sa première lettre', () => {
    const f = ficheDomiciliationSchema.parse(
      fiche({ prenom: 'mouhamadou lamine', nom: 'dos santos', poste: 'assistante de direction' }),
    );
    expect([f.prenom, f.nom, f.poste]).toEqual([
      'Mouhamadou Lamine',
      'Dos Santos',
      'Assistante de direction',
    ]);
  });
});

describe('la lettre', () => {
  it('le numéro, Dakar le jour même, qui écrit au genre de son dossier, l’objet, l’appel', () => {
    const t = lettre();
    expect(t.reference).toBe('/PR/SG/APIX/DG/DCH');
    expect(t.lieuEtDate).toBe('Dakar, le 18 octobre 2026');
    expect(t.timbre).toBe('La Directrice du Capital Humain');
    expect(lettre({}, { nom: 'Moussa FALL', genre: 'male' }).timbre).toBe(
      'Le Directeur du Capital Humain',
    );
    expect(lettre({}, null).timbre).toBe('Le Directeur du Capital Humain');
    expect(t.objet).toBe('Domiciliation bancaire');
    expect(t.appel).toBe('Monsieur le Directeur Général,');
    expect(lettre({ destinataire: 'directrice_generale' }).appel).toBe(
      'Madame la Directrice Générale,',
    );
  });

  it('l’ordre de virement, coquilles corrigées ; le nom, le contrat, le jour, le RIB, la banque et le montant en gras', () => {
    const t = lettre();
    expect(paragraphe(t, 0)).toBe(
      'Nous vous informons que Madame Awa DIOP, qui fait partie de notre personnel depuis le ' +
        '1er mars 2018 et qui occupe actuellement la fonction de Chargée d’études au titre d’un ' +
        'contrat à durée indéterminée, nous a donné, le 15 octobre 2026, l’ordre de virement ' +
        'irrévocable à vos caisses, pour en créditer son compte n° SN012 01001 036123456789 54 ' +
        'tenu sur les livres de la CBAO, toutes sommes pouvant lui être dues par notre Société, ' +
        'à quelque titre que ce soit, notamment son salaire mensuel net qui s’élève actuellement ' +
        'à six cent cinquante mille (650 000) francs CFA, gratifications, indemnités de congés, etc.',
    );
    expect(enGras(t, 0)).toEqual([
      'Madame Awa DIOP',
      'contrat à durée indéterminée',
      '15 octobre 2026',
      'n° SN012 01001 036123456789 54',
      'CBAO',
      '(650 000) francs CFA',
    ]);
  });

  it('au masculin, en contrat à durée déterminée ; la fonction élidée devant une voyelle', () => {
    const t = lettre({
      civilite: 'monsieur',
      prenom: 'Moussa',
      poste: 'Assistant de direction',
      contrat: 'cdd',
    });
    expect(paragraphe(t, 0)).toMatch(
      /^Nous vous informons que Monsieur Moussa DIOP, qui fait partie de notre personnel depuis le 1er mars 2018 et qui occupe actuellement la fonction d’Assistant de direction au titre d’un contrat à durée déterminée,/,
    );
    expect(paragraphe(t, 2)).toMatch(/consentir à l’intéressé une avance/);
    expect(paragraphe(t, 3)).toMatch(
      /sur le compte de l’intéressé à la CBAO, l’intégralité des sommes dont nous pourrons être redevables envers lui à quelque titre que ce soit\.$/,
    );
  });

  it('les engagements, accordés à la personne', () => {
    const t = lettre();
    expect(paragraphe(t, 1)).toBe(
      'Par la présente, nous nous engageons irrévocablement dans la limite de l’échéance ' +
        'ci-dessus indiquée à exécuter ces instructions qui ne pourront être révoquées qu’avec ' +
        'votre accord exprès donné par écrit ou pour les causes ci-dessous indiquées.',
    );
    expect(paragraphe(t, 2)).toBe(
      'De plus, nous nous interdisons de consentir à l’intéressée une avance sur salaire ' +
        'supérieure à 25 %, de manière qu’au moins 75 % de ses revenus mensuels parviennent sur ' +
        'son compte.',
    );
    expect(paragraphe(t, 3)).toBe(
      'Enfin, nous nous engageons à vous aviser immédiatement de tout changement qui ' +
        'surviendrait dans la situation de Madame Awa DIOP, en particulier en cas de licenciement ' +
        'ou de démission. Dans cette éventualité, nous reconnaissons que nous serions tenus de ' +
        'reverser aussitôt sur le compte de l’intéressée à la CBAO, l’intégralité des sommes dont ' +
        'nous pourrons être redevables envers elle à quelque titre que ce soit.',
    );
    expect(enGras(t, 3)).toEqual(['Madame Awa DIOP', 'CBAO']);
  });

  it('la formule de politesse et le destinataire, au genre choisi', () => {
    expect(paragraphe(lettre(), 4)).toBe(
      'Veuillez agréer, Monsieur le Directeur Général, l’assurance de ma considération distinguée.',
    );
    const directrice = lettre({ destinataire: 'directrice_generale' });
    expect(paragraphe(directrice, 4)).toBe(
      'Veuillez agréer, Madame la Directrice Générale, l’assurance de ma considération distinguée.',
    );
    expect(enGras(directrice, 4)).toEqual(['Madame la Directrice Générale']);
    expect(lettre().destinataire).toEqual(['Monsieur le Directeur Général de la CBAO', 'Sénégal']);
    expect(directrice.destinataire[0]).toBe('Madame la Directrice Générale de la CBAO');
  });

  it('chaque banque de la liste se nomme selon l’usage, avec ou sans article', () => {
    const formes = BANQUES.map((b) => {
      const t = lettre({ banque: b.code });
      const livres = /tenu sur les livres (.+?), toutes sommes/.exec(paragraphe(t, 0))?.[1];
      const compte = /sur le compte de l’intéressée (.+?), l’intégralité/.exec(
        paragraphe(t, 3),
      )?.[1];
      return [b.nom, livres, compte, t.destinataire[0]];
    });
    expect(formes).toEqual([
      [
        'Afrika Banque Sénégal',
        'd’Afrika Banque Sénégal',
        'à Afrika Banque Sénégal',
        'Monsieur le Directeur Général d’Afrika Banque Sénégal',
      ],
      [
        'BCI Sénégal',
        'de la BCI Sénégal',
        'à la BCI Sénégal',
        'Monsieur le Directeur Général de la BCI Sénégal',
      ],
      [
        'BGFIBank Sénégal',
        'de BGFIBank Sénégal',
        'à BGFIBank Sénégal',
        'Monsieur le Directeur Général de BGFIBank Sénégal',
      ],
      ['BIMAO', 'de la BIMAO', 'à la BIMAO', 'Monsieur le Directeur Général de la BIMAO'],
      ['BNDE', 'de la BNDE', 'à la BNDE', 'Monsieur le Directeur Général de la BNDE'],
      ['BOA', 'de la BOA', 'à la BOA', 'Monsieur le Directeur Général de la BOA'],
      ['BSIC', 'de la BSIC', 'à la BSIC', 'Monsieur le Directeur Général de la BSIC'],
      [
        'Banque Atlantique',
        'de la Banque Atlantique',
        'à la Banque Atlantique',
        'Monsieur le Directeur Général de la Banque Atlantique',
      ],
      [
        'Banque Islamique du Sénégal',
        'de la Banque Islamique du Sénégal',
        'à la Banque Islamique du Sénégal',
        'Monsieur le Directeur Général de la Banque Islamique du Sénégal',
      ],
      [
        'Banque de l’Habitat du Sénégal',
        'de la Banque de l’Habitat du Sénégal',
        'à la Banque de l’Habitat du Sénégal',
        'Monsieur le Directeur Général de la Banque de l’Habitat du Sénégal',
      ],
      [
        'Bridge Bank',
        'de Bridge Bank',
        'à Bridge Bank',
        'Monsieur le Directeur Général de Bridge Bank',
      ],
      ['CBAO', 'de la CBAO', 'à la CBAO', 'Monsieur le Directeur Général de la CBAO'],
      [
        'Coris Bank',
        'de Coris Bank',
        'à Coris Bank',
        'Monsieur le Directeur Général de Coris Bank',
      ],
      ['Ecobank', 'd’Ecobank', 'à Ecobank', 'Monsieur le Directeur Général d’Ecobank'],
      ['FBNBank', 'de FBNBank', 'à FBNBank', 'Monsieur le Directeur Général de FBNBank'],
      [
        'La Banque Agricole',
        'de La Banque Agricole',
        'à La Banque Agricole',
        'Monsieur le Directeur Général de La Banque Agricole',
      ],
      [
        'La Banque Outarde',
        'de La Banque Outarde',
        'à La Banque Outarde',
        'Monsieur le Directeur Général de La Banque Outarde',
      ],
      ['Orabank', 'd’Orabank', 'à Orabank', 'Monsieur le Directeur Général d’Orabank'],
      ['SUNU Bank', 'de SUNU Bank', 'à SUNU Bank', 'Monsieur le Directeur Général de SUNU Bank'],
      ['UBA', 'd’UBA', 'à UBA', 'Monsieur le Directeur Général d’UBA'],
    ]);
  });

  it('la banque seule en gras, sans son article', () => {
    expect(enGras(lettre({ banque: 'ecobank' }), 0)).toContain('Ecobank');
    expect(enGras(lettre({ banque: 'banque_agricole' }), 3)).toEqual([
      'Madame Awa DIOP',
      'La Banque Agricole',
    ]);
  });
});

describe('la génération', () => {
  it('qui dirige la DCH, sans agent : une page, nommée d’après la personne', async () => {
    const { filename, pdf } = await service.pdfSansAgent(dch, 'domiciliation_bancaire', fiche());
    expect(filename).toBe('domiciliation-bancaire-DIOP-Awa.pdf');
    expect(filename).toBe(nomDuDocumentGenere('domiciliation_bancaire', 'DIOP-Awa'));
    expect(pages(pdf)).toBe(1);
    const brut = pdf.toString('latin1');
    expect(/\/BaseFont \/[A-Z]{6}\+(Arimo|Arial)/.test(brut)).toBe(true);
    expect(/\/BaseFont \/[A-Z]{6}\+(ComicRelief|ComicSans)/.test(brut)).toBe(true);
  });

  it('la banque au nom le plus long, une directrice générale : toujours une page', async () => {
    const { pdf } = await service.pdfSansAgent(
      dch,
      'domiciliation_bancaire',
      fiche({
        banque: 'banque_habitat',
        destinataire: 'directrice_generale',
        prenom: 'Mouhamadou Moustapha Lamine',
        nom: 'Dos Santos Ndiaye',
        poste: 'Assistante de direction chargée du suivi des dossiers du conseil d’administration',
      }),
    );
    expect(pages(pdf)).toBe(1);
  });

  it('qui écrit vient de l’organigramme', async () => {
    const t = await db.withTenant({ tenantId, userId: ids.dch }, (tx) =>
      textesDeDomiciliationPour(tx, fiche()),
    );
    expect(t.timbre).toBe('Le Directeur du Capital Humain');
  });

  it('une fiche incomplète, personne d’autre que qui dirige la DCH, pas d’agent', async () => {
    expect(
      await codeOf(() =>
        service.pdfSansAgent(dch, 'domiciliation_bancaire', fiche({ rib: 'SN012' })),
      ),
    ).toBe('validation_failed');
    expect(await codeOf(() => service.pdfSansAgent(agent, 'domiciliation_bancaire', fiche()))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(() => service.pdf(dch, 'domiciliation_bancaire', employes.dg))).toBe(
      'documents.sans_agent',
    );
  });
});
