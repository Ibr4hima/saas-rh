/**
 * La vérification des clés d'accès (ADR-0247), sans base : ce qu'une clé
 * doit prouver à sa création et à chaque connexion.
 *
 * Ce qui compte : une clé ne vaut que pour ce site (origine, domaine), pour
 * le défi qui vient d'être donné, la personne vérifiée par son appareil ;
 * la signature est celle de la clé enregistrée ; le compteur ne recule pas ;
 * le CBOR mal formé est refusé, jamais deviné.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CleRefusee,
  cleDepuisCose,
  lireCbor,
  verifierLaConnexion,
  verifierLaCreation,
  type CborMap,
} from '../src/modules/auth/webauthn';
import { Appareil, ORIGINE, RP_ID, autreClePrivee, cbor, type Triche } from './appareil-de-test';

const site = { rpId: RP_ID, origines: [ORIGINE] };
const defi = () => randomBytes(32).toString('base64url');

/** Le refus, et sa raison. */
function raisonDu(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof CleRefusee) return e.message;
    throw e;
  }
  throw new Error('Aucun refus');
}

/** Une clé créée et enregistrée, prête à se présenter. */
function cleEnregistree(appareil: Appareil) {
  const d = defi();
  const cle = verifierLaCreation(appareil.creer(d), { ...site, defi: d });
  return { spki: cle.spki, algorithme: cle.algorithme, compteur: cle.compteur };
}

describe('le CBOR', () => {
  it('lit entiers, octets, textes, listes, tables, vrai, faux, nul', () => {
    const v = lireCbor(
      cbor(
        new Map<unknown, unknown>([
          [1, -7],
          ['a', [Buffer.from([1, 2]), 'é', true, false, null]],
          [-1, 70000],
        ]),
      ),
    ) as CborMap;
    expect(v.get(1)).toBe(-7);
    expect(v.get('a')).toEqual([Buffer.from([1, 2]), 'é', true, false, null]);
    expect(v.get(-1)).toBe(70000);
  });

  it('refuse la longueur indéfinie, les étiquettes, les nombres à virgule', () => {
    expect(raisonDu(() => lireCbor(Buffer.from([0x5f, 0xff])))).toMatch(/indéfinie/);
    expect(raisonDu(() => lireCbor(Buffer.from([0xc0, 0x00])))).toMatch(/étiquette/);
    expect(raisonDu(() => lireCbor(Buffer.from([0xf9, 0x3c, 0x00])))).toMatch(/valeur/);
  });

  it('refuse une clé en double, des octets en trop, un message tronqué', () => {
    expect(raisonDu(() => lireCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])))).toMatch(/double/);
    expect(raisonDu(() => lireCbor(Buffer.from([0x01, 0x02])))).toMatch(/en trop/);
    expect(raisonDu(() => lireCbor(Buffer.from([0x45, 0x01])))).toMatch(/tronqué/);
    // Une liste qui annonce plus d'éléments qu'il n'y a d'octets.
    expect(raisonDu(() => lireCbor(Buffer.from([0x9a, 0xff, 0xff, 0xff, 0xff])))).toMatch(
      /tronqué/,
    );
  });

  it('refuse une imbrication sans fin', () => {
    expect(raisonDu(() => lireCbor(Buffer.from([...Array(20).fill(0x81), 0x00])))).toMatch(
      /imbriqué/,
    );
  });
});

describe('la création d’une clé', () => {
  for (const alg of [-7, -8, -257] as const) {
    it(`accepte une clé ${alg === -7 ? 'ES256' : alg === -8 ? 'EdDSA' : 'RS256'}`, () => {
      const appareil = new Appareil(alg);
      const d = defi();
      const cle = verifierLaCreation(appareil.creer(d), { ...site, defi: d });
      expect(cle.algorithme).toBe(alg);
      expect(cle.identifiant).toBe(appareil.identifiant.toString('base64url'));
      expect(cle.compteur).toBe(10);
      // Les transports inconnus tombent, les doublons aussi.
      expect(cle.transports).toEqual(['internal', 'hybrid']);
    });
  }

  it('refuse une autre origine, un autre domaine, un autre défi', () => {
    const appareil = new Appareil();
    const d = defi();
    const essai = (t: Triche) =>
      raisonDu(() => verifierLaCreation(appareil.creer(d, t), { ...site, defi: d }));
    expect(essai({ origine: 'https://apix.example' })).toMatch(/origine/);
    expect(essai({ rpId: 'apix.example' })).toMatch(/domaine/);
    expect(essai({ defi: defi() })).toMatch(/défi/);
    expect(essai({ type: 'webauthn.get' })).toMatch(/geste/);
    expect(essai({ crossOrigin: true })).toMatch(/cadre/);
  });

  it('exige la personne présente et vérifiée par son appareil', () => {
    const appareil = new Appareil();
    const d = defi();
    const essai = (drapeaux: number) =>
      raisonDu(() => verifierLaCreation(appareil.creer(d, { drapeaux }), { ...site, defi: d }));
    // Présente, une clé jointe, mais pas de biométrie ni de code.
    expect(essai(0x41)).toMatch(/non vérifiée/);
    expect(essai(0x44)).toMatch(/absente/);
    // Sans clé jointe.
    expect(essai(0x05)).toMatch(/octets en trop|aucune clé/);
  });

  it('refuse des octets en trop, et un identifiant qui ne correspond pas', () => {
    const appareil = new Appareil();
    const d = defi();
    expect(
      raisonDu(() => verifierLaCreation(appareil.creer(d, { enTrop: true }), { ...site, defi: d })),
    ).toMatch(/en trop/);
    const r = appareil.creer(d);
    const autre = randomBytes(32).toString('base64url');
    expect(
      raisonDu(() => verifierLaCreation({ ...r, id: autre, rawId: autre }, { ...site, defi: d })),
    ).toMatch(/identifiant différent/);
    expect(raisonDu(() => verifierLaCreation({ ...r, id: autre }, { ...site, defi: d }))).toMatch(
      /incohérent/,
    );
  });

  it('refuse un point hors de la courbe, et un algorithme inconnu', () => {
    const appareil = new Appareil(-7);
    const cose = appareil.cose();
    const y = Buffer.from(cose.get(-3) as Buffer);
    y[31] = y[31]! ^ 0x01;
    cose.set(-3, y);
    expect(raisonDu(() => cleDepuisCose(cose as CborMap))).toMatch(/invalide/);
    const inconnu = new Map<number, unknown>([
      [1, 2],
      [3, -35],
      [-1, 2],
    ]);
    expect(raisonDu(() => cleDepuisCose(inconnu as CborMap))).toMatch(/non pris en charge/);
  });
});

describe('la connexion par clé', () => {
  for (const alg of [-7, -8, -257] as const) {
    it(`accepte la signature d’une clé ${alg}`, () => {
      const appareil = new Appareil(alg);
      const cle = cleEnregistree(appareil);
      const d = defi();
      const suite = verifierLaConnexion(appareil.presenter(d), { ...site, defi: d }, cle);
      expect(suite.compteur).toBe(11);
    });
  }

  it('refuse la signature d’une autre clé', () => {
    const appareil = new Appareil(-7);
    const cle = cleEnregistree(appareil);
    const d = defi();
    expect(
      raisonDu(() =>
        verifierLaConnexion(
          appareil.presenter(d, { autreCle: autreClePrivee(-7) }),
          { ...site, defi: d },
          cle,
        ),
      ),
    ).toMatch(/signature/);
  });

  it('refuse une réponse modifiée après la signature', () => {
    const appareil = new Appareil(-7);
    const cle = cleEnregistree(appareil);
    const d = defi();
    const r = appareil.presenter(d);
    const authData = Buffer.from(r.response.authenticatorData, 'base64url');
    authData[36] = authData[36]! + 1;
    const triche = {
      ...r,
      response: { ...r.response, authenticatorData: authData.toString('base64url') },
    };
    expect(raisonDu(() => verifierLaConnexion(triche, { ...site, defi: d }, cle))).toMatch(
      /signature/,
    );
  });

  it('refuse un autre défi, une autre origine, la personne non vérifiée', () => {
    const appareil = new Appareil();
    const cle = cleEnregistree(appareil);
    const d = defi();
    const essai = (t: Triche) =>
      raisonDu(() => verifierLaConnexion(appareil.presenter(d, t), { ...site, defi: d }, cle));
    expect(essai({ defi: defi() })).toMatch(/défi/);
    expect(essai({ origine: 'https://apix.example' })).toMatch(/origine/);
    expect(essai({ rpId: 'apix.example' })).toMatch(/domaine/);
    expect(essai({ drapeaux: 0x01 })).toMatch(/non vérifiée/);
    expect(essai({ type: 'webauthn.create' })).toMatch(/geste/);
    expect(essai({ enTrop: true })).toMatch(/en trop/);
  });

  it('refuse un compteur qui ne monte pas : une copie de la clé circule', () => {
    const appareil = new Appareil();
    const cle = cleEnregistree(appareil);
    const d = defi();
    expect(
      raisonDu(() =>
        verifierLaConnexion(appareil.presenter(d, { compteur: 10 }), { ...site, defi: d }, cle),
      ),
    ).toMatch(/compteur/);
  });

  it('accepte une clé synchronisée, dont le compteur reste à 0', () => {
    const appareil = new Appareil(-7, { synchronisee: true });
    const cle = cleEnregistree(appareil);
    for (let i = 0; i < 2; i += 1) {
      const d = defi();
      expect(verifierLaConnexion(appareil.presenter(d), { ...site, defi: d }, cle).compteur).toBe(
        0,
      );
    }
  });
});
