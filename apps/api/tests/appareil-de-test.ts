import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { ReponseDeConnexion, ReponseDeCreation } from '@teranga/contracts';

/*
 * Un appareil de test pour les clés d'accès (ADR-0247) : il crée une clé et
 * la présente comme le font Face ID, Touch ID ou Windows Hello, octet pour
 * octet, avec la cryptographie de Node. Les tests le font aussi tricher.
 */

export const RP_ID = 'localhost';
export const ORIGINE = 'http://localhost:3002';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64 = (b: Buffer) => b.toString('base64url');

function tete(majeur: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(majeur << 5) | n]);
  if (n < 0x100) return Buffer.from([(majeur << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (majeur << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (majeur << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** Un encodeur CBOR, réduit à ce qu'écrivent les appareils. */
export function cbor(v: unknown): Buffer {
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([tete(2, v.length), v]);
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([tete(3, b.length), b]);
  }
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) {
    return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  }
  if (v === false) return Buffer.from([0xf4]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === null) return Buffer.from([0xf6]);
  throw new Error(`CBOR : ${String(v)}`);
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

/** UP, UV, AT : présente, vérifiée, une clé jointe. */
export const DRAPEAUX_CREATION = 0x45;
/** UP, UV : présente, vérifiée. */
export const DRAPEAUX_CONNEXION = 0x05;

export interface Triche {
  origine?: string;
  rpId?: string;
  drapeaux?: number;
  type?: string;
  defi?: string;
  crossOrigin?: boolean;
  /** Des octets ajoutés après les données de l'appareil. */
  enTrop?: boolean;
  /** Le compteur qu'annonce l'appareil. */
  compteur?: number;
  userHandle?: string | null;
  /** La signature d'une autre clé. */
  autreCle?: KeyObject;
}

export class Appareil {
  readonly identifiant = randomBytes(32);
  private readonly privee: KeyObject;
  private readonly publique: KeyObject;
  /** Une clé synchronisée garde son compteur à 0. */
  compteur: number;

  constructor(
    readonly alg: -7 | -8 | -257 = -7,
    o: { synchronisee?: boolean } = {},
  ) {
    const paire =
      alg === -7
        ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
        : alg === -8
          ? generateKeyPairSync('ed25519')
          : generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privee = paire.privateKey;
    this.publique = paire.publicKey;
    this.compteur = o.synchronisee ? 0 : 10;
  }

  /** La clé publique en COSE, comme l'appareil l'écrit. */
  cose(): Map<number, unknown> {
    const jwk = this.publique.export({ format: 'jwk' });
    const o = (v?: string) => Buffer.from(v ?? '', 'base64url');
    if (this.alg === -7) {
      return new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, o(jwk.x)],
        [-3, o(jwk.y)],
      ]);
    }
    if (this.alg === -8) {
      return new Map<number, unknown>([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, o(jwk.x)],
      ]);
    }
    return new Map<number, unknown>([
      [1, 3],
      [3, -257],
      [-1, o(jwk.n)],
      [-2, o(jwk.e)],
    ]);
  }

  private donneesDuNavigateur(type: string, defi: string, t: Triche): Buffer {
    return Buffer.from(
      JSON.stringify({
        type: t.type ?? type,
        challenge: t.defi ?? defi,
        origin: t.origine ?? ORIGINE,
        crossOrigin: t.crossOrigin ?? false,
      }),
    );
  }

  /** La création d'une clé, en réponse au défi du serveur. */
  creer(defi: string, t: Triche & { cose?: Map<number, unknown> } = {}): ReponseDeCreation {
    const navigateur = this.donneesDuNavigateur('webauthn.create', defi, t);
    const authData = Buffer.concat([
      sha256(t.rpId ?? RP_ID),
      Buffer.from([t.drapeaux ?? DRAPEAUX_CREATION]),
      u32(this.compteur),
      Buffer.alloc(16),
      u16(this.identifiant.length),
      this.identifiant,
      cbor(t.cose ?? this.cose()),
      t.enTrop ? Buffer.from([0]) : Buffer.alloc(0),
    ]);
    const attestation = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: b64(this.identifiant),
      rawId: b64(this.identifiant),
      type: 'public-key',
      response: {
        clientDataJSON: b64(navigateur),
        attestationObject: b64(attestation),
        transports: ['internal', 'hybrid', 'bizarre', 'internal'],
      },
    };
  }

  /** La clé présentée pour une connexion, signée. */
  presenter(defi: string, t: Triche = {}): ReponseDeConnexion {
    if (this.compteur > 0) this.compteur += 1;
    const navigateur = this.donneesDuNavigateur('webauthn.get', defi, t);
    const authData = Buffer.concat([
      sha256(t.rpId ?? RP_ID),
      Buffer.from([t.drapeaux ?? DRAPEAUX_CONNEXION]),
      u32(t.compteur ?? this.compteur),
      t.enTrop ? Buffer.from([0]) : Buffer.alloc(0),
    ]);
    const signe = Buffer.concat([authData, sha256(navigateur)]);
    const cle = t.autreCle ?? this.privee;
    const signature =
      this.alg === -7
        ? sign('sha256', signe, { key: cle, dsaEncoding: 'der' })
        : this.alg === -8
          ? sign(null, signe, cle)
          : sign('sha256', signe, cle);
    return {
      id: b64(this.identifiant),
      rawId: b64(this.identifiant),
      type: 'public-key',
      response: {
        clientDataJSON: b64(navigateur),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: t.userHandle === undefined ? null : t.userHandle,
      },
    };
  }
}

/** Une clé privée qui n'est pas celle de l'appareil, du même algorithme. */
export function autreClePrivee(alg: -7 | -8 | -257): KeyObject {
  return alg === -7
    ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    : alg === -8
      ? generateKeyPairSync('ed25519').privateKey
      : generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
}
