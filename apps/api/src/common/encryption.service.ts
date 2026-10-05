/**
 * Chiffrement applicatif des champs ultra-sensibles (CNI, futurs RIB/mobile
 * money) — ADR ch.04. AES-256-GCM, clé 32 octets fournie par l'environnement
 * (KMS en production). Format stocké : v1:<iv>:<tag>:<ciphertext> en base64.
 * La colonne ne contient jamais de clair ; perdre la clé = perdre le champ.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env';

const VERSION = 'v1';

/** Les données des candidats : leur version de chiffrement (octet de tête). */
export const VERSION_CANDIDATURES = 1;
const PREFIXE_TEXTE = 'c1:';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  /** Une clé par usage, dérivée de la clé maîtresse : elles ne se croisent jamais. */
  private readonly cleCandidatures: Buffer;
  private readonly cleIndex: Buffer;

  constructor() {
    const env = loadEnv();
    this.key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY doit être 32 octets encodés en base64');
    }
    const deriver = (usage: string) =>
      Buffer.from(hkdfSync('sha256', this.key, Buffer.alloc(0), `teranga:${usage}`, 32));
    this.cleCandidatures = deriver('candidatures:v1');
    this.cleIndex = deriver('index:v1');
  }

  /**
   * Chiffre des octets pour UNE place : `contexte` (organisation, table,
   * ligne, colonne) est authentifié avec eux. Recopié sur une autre ligne,
   * dans une autre organisation, le chiffré ne se déchiffre plus.
   * Format : version (1 octet) | iv (12) | tag (16) | chiffré.
   */
  chiffrerOctets(clair: Buffer, contexte: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cleCandidatures, iv);
    c.setAAD(Buffer.from(contexte, 'utf8'));
    const chiffre = Buffer.concat([c.update(clair), c.final()]);
    return Buffer.concat([Buffer.from([VERSION_CANDIDATURES]), iv, c.getAuthTag(), chiffre]);
  }

  dechiffrerOctets(stocke: Buffer, contexte: string): Buffer {
    if (stocke.length < 29 || stocke[0] !== VERSION_CANDIDATURES) {
      throw new Error('Format de donnée chiffrée invalide');
    }
    const d = createDecipheriv('aes-256-gcm', this.cleCandidatures, stocke.subarray(1, 13));
    d.setAAD(Buffer.from(contexte, 'utf8'));
    d.setAuthTag(stocke.subarray(13, 29));
    return Buffer.concat([d.update(stocke.subarray(29)), d.final()]);
  }

  /** Un champ texte, chiffré pour sa place : `c1:<base64>`. */
  chiffrerTexte(clair: string, contexte: string): string {
    return (
      PREFIXE_TEXTE + this.chiffrerOctets(Buffer.from(clair, 'utf8'), contexte).toString('base64')
    );
  }

  dechiffrerTexte(stocke: string, contexte: string): string {
    if (!stocke.startsWith(PREFIXE_TEXTE)) throw new Error('Format de champ chiffré invalide');
    return this.dechiffrerOctets(
      Buffer.from(stocke.slice(PREFIXE_TEXTE.length), 'base64'),
      contexte,
    ).toString('utf8');
  }

  /**
   * L'empreinte d'une valeur, pour la retrouver sans la stocker en clair
   * (une adresse déjà candidate à une offre) : un HMAC à clé, que seul qui
   * détient la clé sait recalculer.
   */
  indexAveugle(valeur: string, contexte: string): Buffer {
    return createHmac('sha256', this.cleIndex).update(`${contexte}\u0000${valeur}`).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext] = stored.split(':');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Format de champ chiffré invalide');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
