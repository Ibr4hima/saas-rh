import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

/** La clé de développement publiée dans `.env.example` : connue de tous. */
const CLE_DE_DEVELOPPEMENT = 'mfM8qEsFfS1lIiWvm8hrM8zqi+O/PFhzPku1whgaMoU=';

/** Une entrée de `trust proxy` : une adresse, un réseau, ou un nom qu'Express connaît. */
const procheDeConfiance = (v: string) => {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(v)) return true;
  const [adresse, masque] = v.split('/');
  return isIP(adresse ?? '') !== 0 && (masque === undefined || /^\d{1,3}$/.test(masque));
};

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3001),
    /** Rôle propriétaire : migrations uniquement (bypasse la RLS). */
    DATABASE_URL: z.string().min(1),
    /** Rôle applicatif non-owner : tout le runtime (soumis à la RLS, ADR-0002). */
    APP_DATABASE_URL: z.string().min(1),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
    /** Clé AES-256 (32 octets base64) pour le chiffrement applicatif des champs sensibles. */
    DATA_ENCRYPTION_KEY: z.string().min(40),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * Créer une organisation depuis la page publique d'inscription. Fermé par
     * défaut : sans cela, n'importe qui pouvait ouvrir une « APIX S.A » et
     * publier des offres sur le vrai domaine. La toute première organisation
     * d'une base vide se crée toujours (installation).
     */
    INSCRIPTION_OUVERTE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * Derrière un reverse proxy : les proxys dont on croit l'en-tête
     * X-Forwarded-For, pour que req.ip soit l'adresse du client et non celle
     * du proxy. Un nombre de sauts ('2'), ou une liste d'adresses, de réseaux
     * et de noms Express ('loopback, 10.0.0.0/8'). 'false' : l'API est
     * exposée directement. 'true' est refusé : il croirait n'importe quel
     * en-tête, que le client écrit lui-même. Obligatoire en production.
     */
    TRUST_PROXY: z
      .string()
      .default('')
      .transform((v) => v.trim())
      .refine(
        (v) =>
          v === '' ||
          v === 'false' ||
          /^\d+$/.test(v) ||
          v
            .split(',')
            .map((x) => x.trim())
            .every(procheDeConfiance),
        {
          message:
            "TRUST_PROXY : un nombre de sauts, une liste d'adresses ou de réseaux, ou 'false'",
        },
      )
      .transform((v): string | number | false | undefined =>
        v === ''
          ? undefined
          : v === 'false'
            ? false
            : /^\d+$/.test(v)
              ? Number(v)
              : v
                  .split(',')
                  .map((x) => x.trim())
                  .join(','),
      ),
    /**
     * APIX Academy, stockage vidéo LOCAL (développement, démonstration) : le
     * répertoire des fichiers. Par défaut `apps/api/var/academy-media`.
     */
    ACADEMY_MEDIA_DIR: z.string().min(1).optional(),
    /**
     * L'adresse publique de l'application web, celle que porte le QR code d'un
     * certificat, pour qu'un tiers le vérifie. En production : l'URL réelle.
     */
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3002'),
    /**
     * Comment partent les courriels. 'smtp' : un serveur SMTP (Mailpit en
     * développement, qui les garde tous sans rien envoyer au dehors) ;
     * 'graph' : Microsoft 365, par l'API Microsoft Graph ; 'aucun' : rien ne
     * part, les liens se transmettent à la main. Par défaut : 'smtp' en
     * développement (Mailpit, localhost:1025), 'aucun' ailleurs.
     */
    MAIL_TRANSPORT: z.enum(['aucun', 'smtp', 'graph']).optional(),
    /** L'expéditeur, tel que le destinataire le lit : « Capital Humain <rh@apix.sn> ». */
    MAIL_FROM: z.string().min(3).default('Capital Humain <rh@localhost>'),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    /** 'true' : TLS dès la connexion (port 465). Sinon STARTTLS si le serveur le propose. */
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    /**
     * Microsoft 365 : une application enregistrée dans Entra ID, avec la
     * permission d'application Mail.Send limitée à la boîte qui envoie.
     */
    GRAPH_TENANT_ID: z.string().min(1).optional(),
    GRAPH_CLIENT_ID: z.string().min(1).optional(),
    GRAPH_CLIENT_SECRET: z.string().min(1).optional(),
    /** La boîte qui envoie (rh@apix.sn) ; par défaut, l'adresse de MAIL_FROM. */
    GRAPH_SENDER: z.string().min(3).optional(),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.TRUST_PROXY !== undefined, {
    message:
      "TRUST_PROXY doit être réglé en production : les proxys devant l'API, ou 'false' si elle est exposée directement",
    path: ['TRUST_PROXY'],
  })
  .refine(
    (e) =>
      e.MAIL_TRANSPORT !== 'graph' ||
      Boolean(e.GRAPH_TENANT_ID && e.GRAPH_CLIENT_ID && e.GRAPH_CLIENT_SECRET),
    {
      message:
        'MAIL_TRANSPORT=graph : GRAPH_TENANT_ID, GRAPH_CLIENT_ID et GRAPH_CLIENT_SECRET sont requis',
      path: ['MAIL_TRANSPORT'],
    },
  )
  .refine((e) => e.NODE_ENV !== 'production' || e.DATA_ENCRYPTION_KEY !== CLE_DE_DEVELOPPEMENT, {
    message:
      'DATA_ENCRYPTION_KEY : la clé de développement est publique, en générer une (openssl rand -base64 32)',
    path: ['DATA_ENCRYPTION_KEY'],
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
