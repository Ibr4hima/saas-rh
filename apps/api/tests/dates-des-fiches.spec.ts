/**
 * Les dates des fiches et des saisies (ADR-0133, ADR-0134) : la CNI à jour
 * dans chaque fiche qui la porte, une date de naissance à quinze ans
 * révolus, les demandes et les nominations pas après aujourd'hui, l'entrée
 * et le contrat avant, chaque fin après son début. Les dates se fixent par
 * rapport à aujourd'hui : l'essai vaut tous les jours.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ansPlusTot,
  aujourdhuiIso,
  cniDelivreeAuPlusTot,
  datesEnfreintes,
  ficheCdiSchema,
  ficheDeclarationMouvementSchema,
  ficheDisponibiliteSchema,
  ficheDomiciliationSchema,
  ficheRenouvellementSchema,
  ficheStagiaireSchema,
  plusJours,
} from '@teranga/contracts';

const AUJOURDHUI = aujourdhuiIso();
const HIER = plusJours(AUJOURDHUI, -1);
const DEMAIN = plusJours(AUJOURDHUI, 1);

/** Les règles enfreintes d'une fiche, champ par champ ; vide : la fiche passe. */
function regles(resultat: {
  success: boolean;
  error?: { issues: { code: string; path: PropertyKey[]; message: string }[] };
}): Record<string, string> {
  return Object.fromEntries(
    (resultat.error?.issues ?? []).map((i) => [i.path.map(String).join('.'), i.message]),
  );
}

const contrat = (f: Record<string, unknown> = {}) =>
  regles(
    ficheCdiSchema.safeParse({
      civilite: 'madame',
      prenom: 'Awa',
      nom: 'Ndiaye',
      naissanceLe: '2000-01-24',
      naissanceA: 'Dakar',
      cni: '2751200201234',
      cniDelivreeLe: ansPlusTot(AUJOURDHUI, 2),
      cniDelivreeA: 'Dakar',
      nationalite: 'SN',
      adresse: 'Dakar',
      poste: 'Contrôleur interne',
      affectation: randomUUID(),
      debut: '2026-04-01',
      categorie: '7A',
      salaireDeBase: 350000,
      sursalaire: 0,
      primeDeTransport: 0,
      treiziemeMois: true,
      ...f,
    }),
  );

const stage = (f: Record<string, unknown> = {}) =>
  regles(
    ficheStagiaireSchema.safeParse({
      civilite: 'madame',
      prenom: 'Aïda',
      nom: 'Ba',
      naissanceLe: '2002-03-12',
      naissanceA: 'Dakar',
      cni: '2751200201234',
      cniDelivreeLe: ansPlusTot(AUJOURDHUI, 3),
      perePrenom: 'Mamadou',
      merePrenom: 'Fatou',
      mereNom: 'Diop',
      adresse: 'Dakar',
      formation: 'Licence',
      poste: 'Assistante archiviste',
      duree: 3,
      debut: '2025-08-19',
      categorie: 'C6',
      allocation: 89474,
      ...f,
    }),
  );

const decision = {
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  demandeLe: plusJours(AUJOURDHUI, -30),
  pvDirectionGeneraleLe: '2024-05-07',
  pvDirectionGeneraleAdjointeLe: '2024-12-13',
};
const disponibilite = (f: Record<string, unknown> = {}) =>
  regles(
    ficheDisponibiliteSchema.safeParse({
      ...decision,
      effetLe: plusJours(AUJOURDHUI, -10),
      repriseLe: plusJours(AUJOURDHUI, 170),
      ...f,
    }),
  );
const renouvellement = (f: Record<string, unknown> = {}) =>
  regles(
    ficheRenouvellementSchema.safeParse({
      ...decision,
      affectation: randomUUID(),
      initialementDu: ansPlusTot(AUJOURDHUI, 1),
      initialementAu: plusJours(AUJOURDHUI, 20),
      duree: 6,
      repriseLe: plusJours(AUJOURDHUI, 200),
      ...f,
    }),
  );

const domiciliation = (f: Record<string, unknown> = {}) =>
  regles(
    ficheDomiciliationSchema.safeParse({
      civilite: 'madame',
      prenom: 'Awa',
      nom: 'Diop',
      poste: 'Chargée d’études',
      debut: '2018-03-01',
      contrat: 'cdi',
      demandeLe: HIER,
      banque: 'cbao',
      destinataire: 'directeur_general',
      rib: 'SN0120100103612345678954',
      salaire: 650000,
      ...f,
    }),
  );

const declaration = (f: Record<string, unknown> = {}) =>
  regles(
    ficheDeclarationMouvementSchema.safeParse({
      mouvements: ['embauchage'],
      civilite: 'madame',
      prenom: 'Awa',
      nom: 'Diop',
      naissanceLe: '1990-03-12',
      naissanceA: 'Dakar',
      naissancePays: 'SN',
      nationalite: 'SN',
      perePrenom: 'Moussa',
      merePrenom: 'Aïssatou',
      mereNom: 'Sall',
      adresse: 'Dakar',
      cni: '2751199012345',
      cniDelivreeLe: ansPlusTot(AUJOURDHUI, 4),
      cniDelivreeA: 'Dakar',
      cniDelivreePar: 'Directeur Général de la Sûreté Nationale',
      situationDeFamille: 'celibataire',
      conjoints: [],
      enfants: [],
      entreeLe: plusJours(AUJOURDHUI, -20),
      profession: 'Comptable',
      emploi: 'Comptable',
      categorie: '7B',
      contrat: 'cdi',
      contratLe: plusJours(AUJOURDHUI, -25),
      residence: 'Dakar',
      serviceMilitaire: false,
      horaire: 40,
      salaire: 650000,
      dispositions: [],
      ...f,
    }),
  );

describe('la CNI des fiches', () => {
  it('chaque fiche qui la porte demande sa délivrance : il y a moins de dix ans, pas dans l’avenir', () => {
    for (const f of [contrat, stage, declaration]) {
      expect(f()).toEqual({});
      expect(f({ cniDelivreeLe: cniDelivreeAuPlusTot() })).toEqual({});
      expect(f({ cniDelivreeLe: ansPlusTot(AUJOURDHUI, 10) })).toEqual({
        cniDelivreeLe: 'CNI expirée : délivrée il y a plus de dix ans',
      });
      expect(f({ cniDelivreeLe: DEMAIN })).toEqual({ cniDelivreeLe: 'Pas après aujourd’hui' });
      expect(Object.keys(f({ cniDelivreeLe: undefined }))).toEqual(['cniDelivreeLe']);
    }
  });

  it('délivrée le 10 octobre 2019, une CNI vaut jusqu’au 9 octobre 2029 inclus', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2029-10-09T23:59:00Z'));
      expect(stage({ cniDelivreeLe: '2019-10-10' })).toEqual({});
      expect(declaration({ cniDelivreeLe: '2019-10-10' })).toEqual({});
      vi.setSystemTime(new Date('2029-10-10T00:00:00Z'));
      expect(stage({ cniDelivreeLe: '2019-10-10' })).toEqual({
        cniDelivreeLe: 'CNI expirée : délivrée il y a plus de dix ans',
      });
      expect(declaration({ cniDelivreeLe: '2019-10-10' })).toEqual({
        cniDelivreeLe: 'CNI expirée : délivrée il y a plus de dix ans',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('une carte étrangère, à la déclaration de mouvement : délivrée après la naissance, sans la validité de la CNI', () => {
    const etrangere = {
      nationalite: 'ML',
      cni: 'A1234567',
      entreeAuSenegalLe: plusJours(AUJOURDHUI, -30),
    };
    expect(declaration({ ...etrangere, cniDelivreeLe: ansPlusTot(AUJOURDHUI, 12) })).toEqual({});
    expect(declaration({ ...etrangere, cniDelivreeLe: '1990-03-12' })).toEqual({
      cniDelivreeLe: 'Après la naissance',
    });
    expect(declaration({ ...etrangere, cniDelivreeLe: DEMAIN })).toEqual({
      cniDelivreeLe: 'Pas après aujourd’hui',
    });
  });
});

describe('les contrats de travail', () => {
  it('la date de naissance : quinze ans révolus, comme au dossier de l’agent', () => {
    for (const f of [contrat, stage]) {
      expect(f({ naissanceLe: HIER })).toEqual({
        naissanceLe: 'La personne doit avoir au moins 15 ans (date dans le passé)',
      });
    }
  });
});

describe('les décisions de disponibilité', () => {
  it('la demande et les nominations pas après aujourd’hui ; la prise d’effet pas avant la demande, la reprise après', () => {
    expect(disponibilite()).toEqual({});
    expect(disponibilite({ demandeLe: DEMAIN, effetLe: DEMAIN })).toEqual({
      demandeLe: 'Pas après aujourd’hui',
    });
    expect(
      disponibilite({ pvDirectionGeneraleLe: DEMAIN, pvDirectionGeneraleAdjointeLe: DEMAIN }),
    ).toEqual({
      pvDirectionGeneraleLe: 'Pas après aujourd’hui',
      pvDirectionGeneraleAdjointeLe: 'Pas après aujourd’hui',
    });
    expect(disponibilite({ effetLe: plusJours(AUJOURDHUI, -31) })).toEqual({
      effetLe: 'Pas avant la demande',
    });
    expect(disponibilite({ effetLe: decision.demandeLe })).toEqual({});
    expect(disponibilite({ repriseLe: plusJours(AUJOURDHUI, -10) })).toEqual({
      repriseLe: 'La reprise suit la prise d’effet',
    });
  });

  it('le renouvellement : la même chose ; la demande peut venir après la période initiale', () => {
    expect(renouvellement()).toEqual({});
    expect(renouvellement({ demandeLe: DEMAIN })).toEqual({ demandeLe: 'Pas après aujourd’hui' });
    expect(renouvellement({ pvDirectionGeneraleLe: DEMAIN })).toEqual({
      pvDirectionGeneraleLe: 'Pas après aujourd’hui',
    });
    expect(
      renouvellement({
        initialementDu: ansPlusTot(AUJOURDHUI, 2),
        initialementAu: plusJours(AUJOURDHUI, -40),
        demandeLe: HIER,
      }),
    ).toEqual({});
    expect(
      renouvellement({
        initialementAu: plusJours(AUJOURDHUI, -40),
        repriseLe: plusJours(AUJOURDHUI, -40),
      }),
    ).toEqual({ repriseLe: 'La reprise suit la période initiale' });
  });
});

describe('la domiciliation bancaire', () => {
  it('le contrat commencé, la demande ni avant lui ni après aujourd’hui', () => {
    expect(domiciliation()).toEqual({});
    expect(domiciliation({ demandeLe: DEMAIN })).toEqual({ demandeLe: 'Pas après aujourd’hui' });
    expect(domiciliation({ debut: DEMAIN, demandeLe: AUJOURDHUI })).toEqual({
      debut: 'Pas après aujourd’hui',
      demandeLe: 'Pas avant le début du contrat',
    });
    expect(domiciliation({ debut: AUJOURDHUI, demandeLe: AUJOURDHUI })).toEqual({});
  });
});

describe('la déclaration de mouvement du travailleur', () => {
  it('l’entrée et le contrat avant aujourd’hui ; les visas pas après, ni avant le contrat', () => {
    expect(declaration()).toEqual({});
    expect(declaration({ entreeLe: AUJOURDHUI, contratLe: AUJOURDHUI })).toEqual({
      entreeLe: 'Avant aujourd’hui',
      contratLe: 'Avant aujourd’hui',
    });
    expect(
      declaration({
        visa: { numero: '12', le: DEMAIN },
        enregistrement: { numero: '34', le: DEMAIN },
      }),
    ).toEqual({ 'visa.le': 'Pas après aujourd’hui', 'enregistrement.le': 'Pas après aujourd’hui' });
    expect(
      declaration({
        visa: { numero: '12', le: plusJours(AUJOURDHUI, -26) },
        enregistrement: { numero: '34', le: AUJOURDHUI },
      }),
    ).toEqual({ 'visa.le': 'Pas avant la date du contrat' });
  });

  it('ce qui manquait : la naissance, l’entrée au Sénégal, la déclaration d’embauche, la classe de recrutement', () => {
    expect(declaration({ naissanceLe: HIER })).toMatchObject({
      naissanceLe: 'La personne doit avoir au moins 15 ans (date dans le passé)',
    });
    const etrangere = { nationalite: 'ML', cni: 'A1234567' };
    expect(declaration({ ...etrangere, entreeAuSenegalLe: plusJours(AUJOURDHUI, -30) })).toEqual(
      {},
    );
    expect(declaration({ ...etrangere, entreeAuSenegalLe: plusJours(AUJOURDHUI, -5) })).toEqual({
      entreeAuSenegalLe: 'Pas après l’entrée dans l’établissement',
    });
    expect(
      declaration({
        mouvements: ['demission'],
        effetLe: HIER,
        declarationDEmbauche: { numero: '56', le: DEMAIN },
      }),
    ).toEqual({ 'declarationDEmbauche.le': 'Pas après aujourd’hui' });
    const militaire = { serviceMilitaire: true, armee: 'terre', grade: 'troupe' };
    const anneeProchaine = String(Number(AUJOURDHUI.slice(0, 4)) + 1);
    expect(declaration({ ...militaire, classeDeRecrutement: anneeProchaine })).toEqual({
      classeDeRecrutement: 'Pas après cette année',
    });
    expect(declaration({ ...militaire, classeDeRecrutement: '1989' })).toEqual({
      classeDeRecrutement: 'Pas avant l’année de naissance',
    });
  });
});

describe('les dates saisies des attestations', () => {
  it('le dernier jour d’un congé ou d’une disponibilité après le premier ; la reprise pas avant le dernier', () => {
    expect(datesEnfreintes('attestation_conge', { debut: AUJOURDHUI, fin: AUJOURDHUI })).toEqual({
      fin: 'Après le premier jour',
    });
    expect(datesEnfreintes('attestation_conge', { debut: AUJOURDHUI, fin: DEMAIN })).toEqual({});
    const dispo = { debut: '2026-01-02', fin: '2026-07-01' };
    expect(
      datesEnfreintes('attestation_reprise_disponibilite', { ...dispo, reprise: '2026-06-30' }),
    ).toEqual({ reprise: 'Pas avant le dernier jour de la disponibilité' });
    expect(
      datesEnfreintes('attestation_reprise_disponibilite', { ...dispo, reprise: '2026-07-01' }),
    ).toEqual({});
  });
});
