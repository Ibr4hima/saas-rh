import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import {
  ALGORITHMES_DES_CLES,
  TRANSPORTS_DES_CLES,
  type ReponseDeConnexion,
  type ReponseDeCreation,
} from '@teranga/contracts';

/* ────────────────────────────────────────────────────────────────
   Les clés d'accès (ADR-0247), vérifiées ici avec la cryptographie de
   Node : la norme WebAuthn, pour ce que la plateforme en demande.

   Ce qu'une clé doit prouver : qu'elle a été créée, puis présentée, sur ce
   site (son origine et son domaine), en réponse au défi que le serveur
   vient de donner, la personne présente et vérifiée par son appareil
   (Face ID, Touch ID, empreinte, code de l'appareil).

   Aucune attestation n'est demandée : une clé s'ajoute à un compte dont la
   session vient d'être ouverte par un code reçu par email, et ne prouve rien
   de plus que cette session. Trois algorithmes : ES256 (la plupart des
   appareils), EdDSA, RS256 (Windows Hello).
   ──────────────────────────────────────────────────────────────── */

/** Une clé refusée, et pourquoi : pour le journal, jamais pour l'écran. */
export class CleRefusee extends Error {}

const refus = (raison: string): never => {
  throw new CleRefusee(raison);
};

// ──────────────────────────────────────────────── CBOR (RFC 8949)

/** Une valeur CBOR, telle que les appareils l'écrivent. */
export type Cbor = number | string | Buffer | boolean | null | undefined | Cbor[] | CborMap;
export type CborMap = Map<number | string, Cbor>;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Le lecteur CBOR, réduit à ce que les clés écrivent : entiers, octets,
 * textes, listes, tables, vrai, faux, nul. Pas de longueur indéfinie, pas
 * d'étiquette, pas de nombre à virgule ; une table n'a pas deux fois la
 * même clé. Tout le reste est refusé.
 */
class LecteurCbor {
  constructor(
    private readonly b: Buffer,
    public pos = 0,
  ) {}

  private octet(): number {
    if (this.pos >= this.b.length) refus('CBOR tronqué');
    return this.b[this.pos++]!;
  }

  octets(n: number): Buffer {
    if (n > this.b.length - this.pos) refus('CBOR tronqué');
    const o = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(o);
  }

  private nombre(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.octet();
    if (info === 25) return this.octets(2).readUInt16BE(0);
    if (info === 26) return this.octets(4).readUInt32BE(0);
    if (info === 27) {
      const n = this.octets(8).readBigUInt64BE(0);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) refus('CBOR : entier trop grand');
      return Number(n);
    }
    return refus('CBOR : longueur indéfinie ou réservée');
  }

  /** Un nombre d'éléments : chacun prend au moins un octet. */
  private compte(info: number, parElement: number): number {
    const n = this.nombre(info);
    if (n * parElement > this.b.length - this.pos) refus('CBOR tronqué');
    return n;
  }

  lire(profondeur = 0): Cbor {
    if (profondeur > 8) refus('CBOR trop imbriqué');
    const tete = this.octet();
    const majeur = tete >> 5;
    const info = tete & 0x1f;
    switch (majeur) {
      case 0:
        return this.nombre(info);
      case 1:
        return -1 - this.nombre(info);
      case 2:
        return this.octets(this.nombre(info));
      case 3: {
        try {
          return utf8.decode(this.octets(this.nombre(info)));
        } catch (e) {
          if (e instanceof CleRefusee) throw e;
          return refus('CBOR : texte illisible');
        }
      }
      case 4: {
        const n = this.compte(info, 1);
        const liste: Cbor[] = [];
        for (let i = 0; i < n; i += 1) liste.push(this.lire(profondeur + 1));
        return liste;
      }
      case 5: {
        const n = this.compte(info, 2);
        const table: CborMap = new Map();
        for (let i = 0; i < n; i += 1) {
          const cle = this.lire(profondeur + 1);
          if (typeof cle !== 'number' && typeof cle !== 'string') refus('CBOR : clé de table');
          if (table.has(cle as number | string)) refus('CBOR : clé en double');
          table.set(cle as number | string, this.lire(profondeur + 1));
        }
        return table;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        return refus('CBOR : valeur non prise en charge');
      default:
        return refus('CBOR : étiquette non prise en charge');
    }
  }
}

/** Une valeur CBOR seule, qui occupe tous les octets. */
export function lireCbor(octets: Buffer): Cbor {
  const l = new LecteurCbor(octets);
  const v = l.lire();
  if (l.pos !== octets.length) refus('CBOR : octets en trop');
  return v;
}

// ──────────────────────────────────────── les données de l'appareil

const PRESENTE = 0x01; // UP : la personne a touché, regardé, confirmé.
const VERIFIEE = 0x04; // UV : l'appareil l'a reconnue (biométrie, code).
const SAUVEGARDABLE = 0x08; // BE : la clé peut se synchroniser.
const SAUVEGARDEE = 0x10; // BS : elle l'est.
const CLE_JOINTE = 0x40; // AT : une clé neuve suit.
const EXTENSIONS = 0x80; // ED : des extensions suivent.

export interface DonneesDeLAppareil {
  rpIdHash: Buffer;
  presente: boolean;
  verifiee: boolean;
  sauvegardee: boolean;
  compteur: number;
  cle: { identifiant: Buffer; cose: CborMap } | null;
}

/** Les données d'authentification (WebAuthn, § 6.1). */
export function lireDonneesDeLAppareil(d: Buffer): DonneesDeLAppareil {
  if (d.length < 37) refus('données de l’appareil trop courtes');
  const drapeaux = d[32]!;
  const lecteur = new LecteurCbor(d, 37);
  let cle: DonneesDeLAppareil['cle'] = null;
  if (drapeaux & CLE_JOINTE) {
    lecteur.octets(16); // L'AAGUID du modèle d'appareil : rien ne s'en sert.
    const longueur = lecteur.octets(2).readUInt16BE(0);
    if (longueur === 0 || longueur > 1023) refus('identifiant de clé hors limites');
    const identifiant = lecteur.octets(longueur);
    const cose = lecteur.lire();
    if (!(cose instanceof Map)) refus('clé publique illisible');
    cle = { identifiant, cose: cose as CborMap };
  }
  if (drapeaux & EXTENSIONS) {
    if (!(lecteur.lire() instanceof Map)) refus('extensions illisibles');
  }
  if (lecteur.pos !== d.length) refus('données de l’appareil : octets en trop');
  if (drapeaux & SAUVEGARDEE && !(drapeaux & SAUVEGARDABLE)) refus('drapeaux incohérents');
  return {
    rpIdHash: d.subarray(0, 32),
    presente: (drapeaux & PRESENTE) !== 0,
    verifiee: (drapeaux & VERIFIEE) !== 0,
    sauvegardee: (drapeaux & SAUVEGARDEE) !== 0,
    compteur: d.readUInt32BE(33),
    cle,
  };
}

// ──────────────────────────────────────────────── la clé publique

const b64u = (b: Buffer) => b.toString('base64url');
const octetsDe = (v: Cbor, longueur?: number): Buffer => {
  if (!Buffer.isBuffer(v) || (longueur !== undefined && v.length !== longueur)) {
    return refus('clé publique : paramètre invalide');
  }
  return v;
};

/** La clé publique COSE (RFC 9053), en SPKI DER, et son algorithme. */
export function cleDepuisCose(cose: CborMap): { spki: Buffer; algorithme: number } {
  const kty = cose.get(1);
  const alg = cose.get(3);
  const jwk = (() => {
    if (alg === -7 && kty === 2 && cose.get(-1) === 1) {
      return {
        kty: 'EC',
        crv: 'P-256',
        x: b64u(octetsDe(cose.get(-2), 32)),
        y: b64u(octetsDe(cose.get(-3), 32)),
      };
    }
    if (alg === -8 && kty === 1 && cose.get(-1) === 6) {
      return { kty: 'OKP', crv: 'Ed25519', x: b64u(octetsDe(cose.get(-2), 32)) };
    }
    if (alg === -257 && kty === 3) {
      const n = octetsDe(cose.get(-1));
      // Au moins 2048 bits.
      if (n.length < 256) refus('clé RSA trop courte');
      return { kty: 'RSA', n: b64u(n), e: b64u(octetsDe(cose.get(-2))) };
    }
    return refus('algorithme de clé non pris en charge');
  })();
  try {
    // Node refuse un point hors de la courbe.
    const cle = createPublicKey({ key: jwk, format: 'jwk' });
    return { spki: cle.export({ type: 'spki', format: 'der' }), algorithme: alg as number };
  } catch {
    return refus('clé publique invalide');
  }
}

/** La signature d'une clé, vérifiée selon son algorithme. Jamais d'exception : faux. */
export function signatureValide(
  spki: Buffer,
  algorithme: number,
  donnees: Buffer,
  signature: Buffer,
): boolean {
  try {
    const cle = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const type = cle.asymmetricKeyType;
    if (algorithme === -7 && type === 'ec') {
      return verify('sha256', donnees, { key: cle, dsaEncoding: 'der' }, signature);
    }
    if (algorithme === -8 && type === 'ed25519') return verify(null, donnees, cle, signature);
    // RSASSA-PKCS1-v1_5, le remplissage par défaut de Node.
    if (algorithme === -257 && type === 'rsa') return verify('sha256', donnees, cle, signature);
    return false;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────── les cérémonies

/** Ce que le site attend d'une clé : son domaine (RP ID), ses origines, le défi donné. */
export interface Attendu {
  rpId: string;
  origines: readonly string[];
  defi: string;
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

/** Deux défis en base64url, comparés sans que le temps ne dise où ils diffèrent. */
function memeDefi(a: string, b: string): boolean {
  const x = Buffer.from(a, 'base64url');
  const y = Buffer.from(b, 'base64url');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Les données du navigateur (clientDataJSON) : le geste, le défi, l'origine. */
function lireDonneesDuNavigateur(
  b64: string,
  type: 'webauthn.create' | 'webauthn.get',
  a: Attendu,
): Buffer {
  const brut = Buffer.from(b64, 'base64url');
  let c: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    c = JSON.parse(utf8.decode(brut)) as typeof c;
  } catch {
    return refus('données du navigateur illisibles');
  }
  if (typeof c !== 'object' || c === null) refus('données du navigateur illisibles');
  if (c.type !== type) refus('geste inattendu');
  if (typeof c.challenge !== 'string' || !memeDefi(c.challenge, a.defi)) refus('défi différent');
  if (typeof c.origin !== 'string' || !a.origines.includes(c.origin)) refus('origine inattendue');
  // Une page de ce site dans le cadre d'un autre : refusé.
  if (c.crossOrigin === true) refus('cadre d’un autre site');
  return brut;
}

/** Le domaine, l'appareil qui a reconnu la personne : exigés aux deux cérémonies. */
function exigerPersonneVerifiee(d: DonneesDeLAppareil, a: Attendu): void {
  if (!timingSafeEqual(d.rpIdHash, sha256(a.rpId))) refus('domaine différent');
  if (!d.presente) refus('personne absente');
  if (!d.verifiee) refus('personne non vérifiée par l’appareil');
}

export interface CleCreee {
  identifiant: string;
  spki: Buffer;
  algorithme: number;
  compteur: number;
  sauvegardee: boolean;
  transports: string[];
}

/** La création d'une clé (WebAuthn, § 7.1), sans attestation. */
export function verifierLaCreation(r: ReponseDeCreation, a: Attendu): CleCreee {
  if (r.id !== r.rawId) refus('identifiant incohérent');
  lireDonneesDuNavigateur(r.response.clientDataJSON, 'webauthn.create', a);
  const objet = lireCbor(Buffer.from(r.response.attestationObject, 'base64url'));
  if (!(objet instanceof Map)) refus('attestation illisible');
  const authData = (objet as CborMap).get('authData');
  if (!Buffer.isBuffer(authData)) refus('attestation sans données');
  // Le format de l'attestation n'importe pas : aucune n'est demandée, ni crue.
  const d = lireDonneesDeLAppareil(authData as Buffer);
  exigerPersonneVerifiee(d, a);
  if (!d.cle) refus('aucune clé jointe');
  const { identifiant, cose } = d.cle!;
  if (!identifiant.equals(Buffer.from(r.rawId, 'base64url'))) refus('identifiant différent');
  const { spki, algorithme } = cleDepuisCose(cose);
  if (!(ALGORITHMES_DES_CLES as readonly number[]).includes(algorithme)) refus('algorithme refusé');
  const connus: readonly string[] = TRANSPORTS_DES_CLES;
  const transports = [...new Set(r.response.transports ?? [])].filter((x) => connus.includes(x));
  return {
    identifiant: b64u(identifiant),
    spki,
    algorithme,
    compteur: d.compteur,
    sauvegardee: d.sauvegardee,
    transports,
  };
}

/** La clé enregistrée qu'une connexion présente. */
export interface CleEnregistree {
  spki: Buffer;
  algorithme: number;
  compteur: number;
}

/** Une connexion par clé (WebAuthn, § 7.2) : ce qui change sur la clé enregistrée. */
export function verifierLaConnexion(
  r: ReponseDeConnexion,
  a: Attendu,
  cle: CleEnregistree,
): { compteur: number; sauvegardee: boolean } {
  if (r.id !== r.rawId) refus('identifiant incohérent');
  const navigateur = lireDonneesDuNavigateur(r.response.clientDataJSON, 'webauthn.get', a);
  const authData = Buffer.from(r.response.authenticatorData, 'base64url');
  const d = lireDonneesDeLAppareil(authData);
  if (d.cle) refus('clé jointe à une connexion');
  exigerPersonneVerifiee(d, a);
  const signe = Buffer.concat([authData, sha256(navigateur)]);
  const signature = Buffer.from(r.response.signature, 'base64url');
  if (!signatureValide(cle.spki, cle.algorithme, signe, signature)) refus('signature invalide');
  // Un compteur qui ne monte pas : une copie de la clé circule. Une clé
  // synchronisée garde 0.
  if ((d.compteur > 0 || cle.compteur > 0) && d.compteur <= cle.compteur) {
    refus('compteur de signatures en arrière');
  }
  return { compteur: d.compteur, sauvegardee: d.sauvegardee };
}
