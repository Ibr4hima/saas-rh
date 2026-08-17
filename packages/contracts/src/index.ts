import { z } from 'zod';

/**
 * Contrats partagés API <-> clients (web, PWA).
 * Source unique des types côté client — toute évolution est additive dans /v1 (ADR-0006).
 */

// ---------- Erreurs (RFC 9457) ----------

/** Corps d'erreur `application/problem+json` renvoyé par l'API. */
export const problemSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Code stable, documenté, jamais renommé (ex : `auth.invalid_credentials`). */
  code: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;

// ---------- Auth ----------

export const passwordSchema = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
  .max(128);

export const registerInputSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
  /** Requis si l'utilisateur appartient à plusieurs organisations. */
  organizationSlug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const membershipRoleSchema = z.enum(['admin', 'hr', 'payroll', 'manager', 'employee']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const sessionUserSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  tenantId: z.uuid(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  role: membershipRoleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

// ---------- Pagination (curseur opaque, ADR-0006) ----------

export const cursorPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------- Santé ----------

export const healthSchema = z.object({
  status: z.literal('ok'),
  db: z.enum(['ok', 'down']),
  version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

export * from './employees';
