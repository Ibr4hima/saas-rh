/**
 * La déclaration de mouvement du travailleur (ADR-0106) : ce qu'elle DIT, à
 * partir de la fiche que la DCH renseigne.
 *
 * Une embauche, un départ ou des changements ; la personne, son emploi, son
 * statut militaire, les dispositions particulières de son engagement. Les
 * mentions se rayent ou s'encadrent ; ce qui n'est pas renseigné laisse des
 * pointillés ; ce qui ne s'applique pas se dit « Néant » ou « Sans objet ».
 * Les références suivent le Code du travail de 2026. Deux pages.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ficheDeclarationMouvementSchema, nomDuDocumentGenere } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import {
  declarationDe,
  declarationPour,
  type Ligne,
} from '../src/modules/documents/declaration-mouvement';
import type { Passage } from '../src/modules/documents/feuille';
import { GenerationService } from '../src/modules/documents/generation.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();
const session = (s: Partial<SessionUser>) =>
  ({ userId: randomUUID(), tenantId, role: 'employee', capacites: [], ...s }) as SessionUser;
const dch = session({ dirigeLaDCH: true });
const agent = session({});

let db: TenantDb;
let service: GenerationService;

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Une fiche complète, l'embauche d'une Sénégalaise en CDD, à varier d'un test à l'autre. */
const fiche = (f: Record<string, unknown> = {}) => ({
  mouvements: ['embauchage'],
  categorieDEnregistrement: 'B',
  civilite: 'madame',
  prenom: 'Awa Marie',
  nom: 'Diop',
  naissanceLe: '1990-03-12',
  naissanceA: 'Dakar',
  naissancePays: 'SN',
  nationalite: 'SN',
  perePrenom: 'Moussa',
  merePrenom: 'Aïssatou',
  mereNom: 'Sall',
  adresse: 'Cité Keur Gorgui, Dakar',
  cni: '2751199012345',
  cniDelivreeA: 'Dakar',
  cniDelivreePar: 'Directeur Général de la Sûreté Nationale',
  situationDeFamille: 'marie',
  conjoints: ['Ibrahima Ndiaye'],
  enfants: ['Fatou Ndiaye', 'Cheikh Ndiaye'],
  entreeLe: '2026-10-01',
  profession: 'Comptable',
  emploi: 'Cheffe du service Comptabilité',
  categorie: '7B',
  contrat: 'cdd',
  cddDu: '2026-10-01',
  cddAu: '2027-09-30',
  residence: 'Dakar',
  serviceMilitaire: false,
  horaire: 40,
  salaire: 650000,
  dispositions: [],
  ...f,
});

/** Un départ : la démission d'un Sénégalais marié deux fois, en CDI, qui a fait son service. */
const depart = (f: Record<string, unknown> = {}) =>
  fiche({
    mouvements: ['demission'],
    effetLe: '2026-12-31',
    entreeLe: '2018-03-01',
    civilite: 'monsieur',
    prenom: 'Moussa',
    conjoints: ['Aïssatou Ba', 'Khady Sow'],
    contrat: 'cdi',
    cddDu: undefined,
    cddAu: undefined,
    serviceMilitaire: true,
    classeDeRecrutement: '2010',
    armee: 'terre',
    grade: 'sous_officier',
    ...f,
  });

const valide = (f: Record<string, unknown>) =>
  ficheDeclarationMouvementSchema.safeParse(JSON.parse(JSON.stringify(f))).success;
const declaration = (f: Record<string, unknown> = fiche()) =>
  declarationDe(
    ficheDeclarationMouvementSchema.parse(JSON.parse(JSON.stringify(f))),
    new Date('2026-10-18T10:00:00'),
  );

/** Le texte de passages, l'espace insécable rendue ordinaire. */
const enClair = (passages: readonly Passage[]) =>
  passages
    .map((p) => p.texte)
    .join('')
    .replace(/\u00a0/g, ' ');
/** Une ligne : ses cellules, séparées d'une barre. */
const ligne = (l: Ligne) => l.map((c) => enClair(c.passages)).join(' | ');
/** Les mentions encadrées, et les rayées. */
const encadrees = (passages: readonly Passage[]) =>
  passages.filter((p) => p.encadre).map((p) => enClair([p]));
const rayees = (passages: readonly Passage[]) =>
  passages.filter((p) => p.raye).map((p) => enClair([p]));
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));
});

afterAll(async () => {
  await db?.pool.end();
});

describe('la fiche', () => {
  it('complète, elle passe ; les noms et les lieux prennent leurs capitales', () => {
    expect(valide(fiche())).toBe(true);
    const f = ficheDeclarationMouvementSchema.parse(
      fiche({ prenom: 'awa marie', nom: 'dos santos', naissanceA: 'saint-louis du sénégal' }),
    );
    expect([f.prenom, f.nom, f.naissanceA]).toEqual([
      'Awa Marie',
      'Dos Santos',
      'Saint-Louis du Sénégal',
    ]);
    for (const champ of ['nom', 'naissanceLe', 'perePrenom', 'cniDelivreePar', 'residence']) {
      expect(valide(fiche({ [champ]: undefined }))).toBe(false);
    }
  });

  it('une embauche, un départ, ou des changements, jamais mêlés', () => {
    expect(valide(fiche({ mouvements: ['embauchage', 'licenciement'] }))).toBe(false);
    expect(valide(depart({ mouvements: ['demission', 'deces'] }))).toBe(false);
    expect(valide(depart({ mouvements: ['demission', 'mutation'] }))).toBe(false);
    expect(valide(depart({ mouvements: [] }))).toBe(false);
    expect(
      valide(depart({ mouvements: ['changement_de_categorie', 'changement_de_categorie'] })),
    ).toBe(false);
    expect(
      valide(
        depart({
          mouvements: ['changement_de_categorie', 'changement_d_emploi', 'modification_du_contrat'],
        }),
      ),
    ).toBe(true);
  });

  it('la date d’un départ ou d’un changement, qui suit l’entrée ; pas pour une embauche', () => {
    expect(valide(depart({ effetLe: undefined }))).toBe(false);
    expect(valide(depart({ effetLe: '2018-02-28' }))).toBe(false);
    expect(valide(fiche({ effetLe: '2026-10-01' }))).toBe(false);
    // La présente déclaration est celle de l'embauche.
    expect(valide(fiche({ declarationDEmbauche: { numero: '12', le: '2026-10-02' } }))).toBe(false);
    expect(valide(depart({ declarationDEmbauche: { numero: '12', le: '2018-03-05' } }))).toBe(true);
  });

  it('une CNI sénégalaise : treize chiffres ; une personne étrangère : sa carte, son entrée au Sénégal', () => {
    expect(valide(fiche({ cni: '27511990123' }))).toBe(false);
    expect(valide(fiche({ entreeAuSenegalLe: '2020-01-01' }))).toBe(false);
    const etrangere = { nationalite: 'ML', cni: 'ml123456789' };
    expect(valide(fiche(etrangere))).toBe(false);
    expect(valide(fiche({ ...etrangere, entreeAuSenegalLe: '2023-12-20' }))).toBe(true);
    expect(
      ficheDeclarationMouvementSchema.parse(
        fiche({ ...etrangere, entreeAuSenegalLe: '2023-12-20' }),
      ).cni,
    ).toBe('ML123456789');
    // Le visa d'approbation se renseigne pour toute personne, comme sur le modèle.
    const visa = { numero: '2024/015', le: '2024-01-10' };
    expect(valide(fiche({ visa }))).toBe(true);
    expect(valide(fiche({ ...etrangere, entreeAuSenegalLe: '2023-12-20', visa }))).toBe(true);
  });

  it('les épouses d’un homme marié, quatre au plus ; l’époux d’une femme mariée ; personne sinon', () => {
    expect(valide(fiche({ conjoints: [] }))).toBe(false);
    expect(valide(fiche({ conjoints: ['Ibrahima Ndiaye', 'Cheikh Fall'] }))).toBe(false);
    expect(valide(depart({ conjoints: ['A Ba', 'B Ba', 'C Ba', 'D Ba'] }))).toBe(true);
    expect(valide(depart({ conjoints: ['A Ba', 'B Ba', 'C Ba', 'D Ba', 'E Ba'] }))).toBe(false);
    expect(valide(fiche({ situationDeFamille: 'celibataire' }))).toBe(false);
    expect(valide(fiche({ situationDeFamille: 'celibataire', conjoints: [] }))).toBe(true);
  });

  it('le contrat : les dates d’un CDD, l’ouvrage d’un chantier, rien pour un CDI', () => {
    expect(valide(fiche({ cddAu: undefined }))).toBe(false);
    expect(valide(fiche({ cddAu: '2026-09-30' }))).toBe(false);
    expect(valide(fiche({ contrat: 'cdi' }))).toBe(false);
    expect(valide(fiche({ contrat: 'cdi', cddDu: undefined, cddAu: undefined }))).toBe(true);
    const chantier = { contrat: 'chantier', cddDu: undefined, cddAu: undefined };
    expect(valide(fiche(chantier))).toBe(false);
    expect(valide(fiche({ ...chantier, chantier: 'l’autoroute Ila Touba' }))).toBe(true);
  });

  it('le service militaire : la classe, l’armée et le grade, s’il a été fait', () => {
    expect(valide(depart({ grade: undefined }))).toBe(false);
    expect(valide(depart({ classeDeRecrutement: '10' }))).toBe(false);
    expect(valide(fiche({ armee: 'terre' }))).toBe(false);
  });

  it('un horaire du formulaire ; le numéro au fichier central, dix chiffres ; la catégorie d’enregistrement, facultative, de A à F', () => {
    expect(valide(fiche({ categorieDEnregistrement: undefined }))).toBe(true);
    expect(valide(fiche({ categorieDEnregistrement: 'G' }))).toBe(false);
    expect(valide(fiche({ categorieDEnregistrement: 'F' }))).toBe(true);
    expect(valide(fiche({ horaire: 39 }))).toBe(false);
    expect(valide(fiche({ horaire: 48 }))).toBe(true);
    for (const immatriculation of ['190031234', '19003123456', '19003-1234', '190031234A']) {
      expect(valide(fiche({ immatriculation }))).toBe(false);
    }
    expect(valide(fiche({ immatriculation: '1900312345' }))).toBe(true);
  });
});

describe('la déclaration', () => {
  it('le jour, les références du modèle : le Code du travail de 1997 et l’arrêté de 1963', () => {
    const d = declaration();
    expect(d.date.replace(/\u00a0/g, ' ')).toBe('18 octobre 2026');
    expect(d.references.map((r) => r.replace(/\u00a0/g, ' '))).toEqual([
      'Article L.222, alinéas 2 à 5, du Code du travail (loi n° 97-17 du 1er décembre 1997)',
      'Arrêté ministériel n° 7301 du 17 mai 1963 déterminant les modalités des déclarations ' +
        'de mouvements de travailleurs (JO n° 3610 du 22 juin 1963, p. 835)',
    ]);
  });

  it('l’objet : le mouvement encadré, les autres rayés, la date d’effet', () => {
    const d = declaration();
    expect(d.objet.map(enClair)).toEqual([
      'Embauchage – Licenciement',
      'Expiration normale du contrat',
      'Démission – Mutation',
      'Changement de catégorie professionnelle',
      'Modification du contrat de travail',
      'Changement de situation de famille',
      'Changement de résidence habituelle',
      'Changement d’emploi – Décès',
    ]);
    expect(d.objet.flatMap(encadrees)).toEqual(['Embauchage']);
    expect(d.objet.flatMap(rayees)).toHaveLength(10);
    expect(d.aCompterDu.replace(/\u00a0/g, ' ')).toBe('1er octobre 2026');
    const changements = declaration(
      depart({
        mouvements: ['changement_d_emploi', 'changement_de_categorie'],
        effetLe: '2026-11-01',
      }),
    );
    expect(changements.objet.flatMap(encadrees)).toEqual([
      'Changement de catégorie professionnelle',
      'Changement d’emploi',
    ]);
    expect(changements.aCompterDu.replace(/\u00a0/g, ' ')).toBe('1er novembre 2026');
  });

  it('sans numéro au fichier central, l’immatriculation se demande ; la catégorie d’enregistrement', () => {
    expect(declaration().immatriculation).toBeNull();
    expect(declaration(fiche({ immatriculation: '1900312345' })).immatriculation).toBe(
      '1900312345',
    );
    expect(declaration().categorieDEnregistrement).toBe('B');
    expect(
      declaration(fiche({ categorieDEnregistrement: undefined })).categorieDEnregistrement,
    ).toBeNull();
  });

  it('la travailleuse, accordée : née, fille, son époux, ses enfants', () => {
    const t = declaration().travailleur.map(ligne);
    expect(t).toEqual([
      'Nom : DIOP | Prénom(s) : Awa Marie',
      'Née le : 12 mars 1990 à Dakar | Pays : Sénégal | Nationalité : Sénégalaise',
      'Fille de Moussa et d’Aïssatou Sall',
      'Adresse : Cité Keur Gorgui, Dakar',
      'Carte d’identité n° 2 751 1990 12345 | Délivrée à : Dakar',
      'Par : Directeur Général de la Sûreté Nationale',
      'N° d’immatriculation à la CSS : …………………… | N° d’immatriculation à l’IPRES : ……………………',
      'Situation de famille : Mariée | Nom de l’époux : Ibrahima Ndiaye',
      'Nombre d’enfants à charge : 2',
      'Noms des enfants à charge : Fatou Ndiaye et Cheikh Ndiaye',
      'Date d’entrée dans l’établissement : 1er octobre 2026',
      'N° et date de la déclaration d’embauche effectuée lors de l’engagement : Sans objet',
      'Profession : Comptable | Emploi dans l’établissement : Cheffe du service Comptabilité',
      'Convention collective : Barème salarial d’APIX-SA | Catégorie : 7B',
      'Éventuellement, date du contrat : ……………………',
      'N° et date du visa d’approbation par l’inspecteur du travail et de la sécurité sociale : ' +
        '……………………',
      'N° et date du visa d’enregistrement à la section locale de ………… du service de la ' +
        'main-d’œuvre : ……………………',
      'Raison sociale et adresse précise de l’employeur : APIX-SA, 52-54, rue Mohamed V, Dakar',
      'Activité de l’établissement : Société de services',
    ]);
  });

  it('le travailleur qui part : né, fils, ses épouses, la date de son départ, sa déclaration d’embauche', () => {
    const t = declaration(
      depart({
        perePrenom: 'Ibrahima',
        css: '1234567',
        ipres: '89012345',
        declarationDEmbauche: { numero: '1234', le: '2018-03-05' },
        enfants: ['Awa Ndiaye'],
        contratLe: '2018-02-20',
      }),
    ).travailleur.map(ligne);
    expect(t).toContain(
      'Né le : 12 mars 1990 à Dakar | Pays : Sénégal | Nationalité : Sénégalaise',
    );
    expect(t).toContain('Fils d’Ibrahima et d’Aïssatou Sall');
    expect(t).toContain(
      'N° d’immatriculation à la CSS : 1234567 | N° d’immatriculation à l’IPRES : 89012345',
    );
    expect(t).toContain('Situation de famille : Marié | Nombre d’épouses : 2');
    expect(t).toContain('Noms des épouses : Aïssatou Ba et Khady Sow');
    expect(t).toContain('Nom de l’enfant à charge : Awa Ndiaye');
    expect(t).toContain(
      'Date d’entrée dans l’établissement : 1er mars 2018 | Date de départ de l’établissement : ' +
        '31 décembre 2026',
    );
    expect(t).toContain(
      'N° et date de la déclaration d’embauche effectuée lors de l’engagement : n° 1234 du 5 mars 2018',
    );
    expect(t).toContain('Éventuellement, date du contrat : 20 février 2018');
  });

  it('personne à déclarer : « Néant »', () => {
    const t = declaration(
      depart({ situationDeFamille: 'celibataire', conjoints: [], enfants: [] }),
    ).travailleur.map(ligne);
    expect(t).toContain('Situation de famille : Célibataire | Nombre d’épouses : Néant');
    expect(t).toContain('Noms des épouses : Néant');
    expect(t).toContain('Nombre d’enfants à charge : Néant');
    expect(t).toContain('Noms des enfants à charge : Néant');
  });

  it('la durée du contrat : la valable encadrée, avec ses dates ou son chantier', () => {
    const cdd = declaration().contrat;
    expect(cdd.map(enClair)).toEqual([
      'à durée déterminée du 1er octobre 2026 au 30 septembre 2027',
      'à durée indéterminée',
      'chantier de',
    ]);
    expect(cdd.flatMap(encadrees)).toEqual(['à durée déterminée']);
    expect(cdd.flatMap(rayees)).toEqual(['à durée indéterminée', 'chantier de']);
    const chantier = (ouvrage: string) =>
      declaration(
        fiche({ contrat: 'chantier', cddDu: undefined, cddAu: undefined, chantier: ouvrage }),
      ).contrat;
    expect(chantier('l’autoroute Ila Touba').map(enClair)).toEqual([
      'à durée déterminée',
      'à durée indéterminée',
      'chantier de l’autoroute Ila Touba',
    ]);
    expect(chantier('l’autoroute Ila Touba').flatMap(encadrees)).toEqual(['chantier']);
    expect(enClair(chantier('Ila Touba')[2]!)).toBe('chantier d’Ila Touba');
  });

  it('le précédent employeur, la résidence ; l’entrée au Sénégal d’une personne étrangère', () => {
    expect(declaration().residence.map(ligne)).toEqual([
      'Nom et adresse du précédent employeur : Néant',
      'Lieu de résidence habituel du travailleur : Dakar | Date d’entrée au Sénégal : Sans objet',
    ]);
    const etrangere = declaration(
      fiche({
        nationalite: 'ML',
        naissancePays: 'CI',
        cni: 'ML123456789',
        entreeAuSenegalLe: '2023-12-20',
        precedentEmployeur: 'Sonatel, Dakar',
      }),
    );
    expect(etrangere.residence.map(ligne)).toEqual([
      'Nom et adresse du précédent employeur : Sonatel, Dakar',
      'Lieu de résidence habituel du travailleur : Dakar | Date d’entrée au Sénégal : 20 décembre 2023',
    ]);
    expect(etrangere.travailleur.map(ligne)).toContain(
      'Née le : 12 mars 1990 à Dakar | Pays : Côte d’Ivoire | Nationalité : Malienne',
    );
    expect(etrangere.travailleur.map(ligne)).toContain(
      'Carte d’identité n° ML123456789 | Délivrée à : Dakar',
    );
    expect(
      declaration(fiche({ visa: { numero: '2024/015', le: '2024-01-10' } })).travailleur.map(ligne),
    ).toContain(
      'N° et date du visa d’approbation par l’inspecteur du travail et de la sécurité sociale : ' +
        'n° 2024/015 du 10 janvier 2024',
    );
  });

  it('le statut militaire : sans service, tout est rayé ; avec, la classe, l’armée et le grade', () => {
    const sans = declaration().statutMilitaire;
    expect(sans.map(ligne)).toEqual([
      'Classe de recrutement : Sans objet',
      'L’intéressée a-t-elle effectué son service militaire : oui – non',
      'Armée d’appartenance : terre – air – mer',
      'Grade dans la réserve : officier – sous-officier – troupe',
    ]);
    expect(sans.flatMap((l) => l.flatMap((c) => encadrees(c.passages)))).toEqual(['non']);
    const avec = declaration(depart()).statutMilitaire;
    expect(ligne(avec[0]!)).toBe('Classe de recrutement : 2010');
    expect(ligne(avec[1]!)).toBe('L’intéressé a-t-il effectué son service militaire : oui – non');
    expect(avec.flatMap((l) => l.flatMap((c) => encadrees(c.passages)))).toEqual([
      'oui',
      'terre',
      'sous-officier',
    ]);
  });

  it('la première disposition : la catégorie, l’horaire encadré, le salaire ; les autres, ou des pointillés', () => {
    const d = declaration(fiche({ horaire: 48, dispositions: ['Logement de fonction.'] }));
    expect(enClair(d.salaire)).toBe(
      'Le salaire du travailleur sera fixé pour la catégorie 7B du barème salarial d’APIX-SA, ' +
        'en fonction d’un horaire de travail hebdomadaire de : 40 heures – 42 heures – 44 heures ' +
        '– 48 heures, soit 650 000 FCFA par mois.',
    );
    expect(encadrees(d.salaire)).toEqual(['48 heures']);
    expect(d.dispositions).toEqual(['Logement de fonction.', null, null, null]);
  });
});

describe('la génération', () => {
  it('qui dirige la DCH, sans agent : deux pages, nommées d’après la personne', async () => {
    const { filename, pdf } = await service.pdfSansAgent(dch, 'declaration_mouvement', fiche());
    expect(filename).toBe('declaration-mouvement-DIOP-Awa_Marie.pdf');
    expect(filename).toBe(nomDuDocumentGenere('declaration_mouvement', 'DIOP-Awa Marie'));
    expect(pages(pdf)).toBe(2);
    expect(/\/BaseFont \/[A-Z]{6}\+(Tinos|Times)/.test(pdf.toString('latin1'))).toBe(true);
  });

  it('beaucoup à déclarer : toujours deux pages', async () => {
    const { pdf } = await service.pdfSansAgent(
      dch,
      'declaration_mouvement',
      depart({
        prenom: 'Mouhamadou Moustapha Lamine',
        nom: 'Dos Santos Ndiaye',
        adresse: 'Cité Impôts et Domaines, Villa 125, Patte d’Oie Builders, Dakar',
        conjoints: ['Aïssatou Ba', 'Khady Sow', 'Ndèye Fatou Ndiaye', 'Mame Diarra Bousso Fall'],
        enfants: Array.from({ length: 12 }, (_, i) => `Enfant${i + 1} Dos Santos Ndiaye`),
        emploi: 'Assistante de direction chargée du suivi des dossiers du conseil d’administration',
        dispositions: Array.from({ length: 4 }, () => 'Une disposition particulière '.repeat(8)),
      }),
    );
    expect(pages(pdf)).toBe(2);
  });

  it('une fiche invalide, personne d’autre que qui dirige la DCH, pas d’agent', async () => {
    expect(() => declarationPour(fiche({ mouvements: ['embauchage', 'deces'] }))).toThrow(
      ProblemException,
    );
    expect(
      await codeOf(() => service.pdfSansAgent(dch, 'declaration_mouvement', fiche({ salaire: 0 }))),
    ).toBe('validation_failed');
    expect(await codeOf(() => service.pdfSansAgent(agent, 'declaration_mouvement', fiche()))).toBe(
      'auth.forbidden',
    );
    expect(await codeOf(() => service.pdf(dch, 'declaration_mouvement', randomUUID()))).toBe(
      'documents.sans_agent',
    );
  });
});
