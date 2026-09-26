/**
 * Chiffrement applicatif des champs ultra-sensibles (CNI, futurs RIB/mobile
 * money) — ADR ch.04. AES-256-GCM, clé 32 octets fournie par l'environnement
 * (KMS en production). Format stocké : v1:<iv>:<tag>:<ciphertext> en base64.
 * La colonne ne contient jamais de clair ; perdre la clé = perdre le champ.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env';

const VERSION = 'v1';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const env = loadEnv();
    this.key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY doit être 32 octets encodés en base64');
    }
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
