import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  /** Rôle propriétaire — migrations uniquement (bypasse la RLS). */
  DATABASE_URL: z.string().min(1),
  /** Rôle applicatif non-owner — tout le runtime (soumis à la RLS, ADR-0002). */
  APP_DATABASE_URL: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
  /** Clé AES-256 (32 octets base64) pour le chiffrement applicatif des champs sensibles. */
  DATA_ENCRYPTION_KEY: z.string().min(40),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Derrière un reverse proxy : valeur Express `trust proxy` ('1', 'loopback'…)
   * pour que req.ip reflète le client réel et pas le proxy. Vide = désactivé.
   */
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((v) => (v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Charge .env depuis la racine du monorepo (ou le cwd), puis valide. */
export function loadEnv(): Env {
  if (cached) return cached;
  for (const candidate of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../../.env'),
  ]) {
    if (existsSync(candidate)) {
      dotenv({ path: candidate });
      break;
    }
  }
  cached = envSchema.parse(process.env);
  return cached;
}
