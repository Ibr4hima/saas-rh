import { z } from 'zod';

/**
 * Primitives partagées : erreurs, auth, pagination, santé.
 *
 * Ce module n'importe RIEN d'autre du paquet. Il vit à part parce que
 * `index.ts` en dépendait tout en réexportant les modules qui, eux, en
 * dépendaient aussi : le cycle index → employees → index laissait
 * `contractTypeSchema` indéfini dès qu'on chargeait les contrats hors bundle
 * (vitest résout le paquet vers les sources). Rien ne doit plus importer
 * depuis « ./index ».
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

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  libelle: string;
  ok: (password: string) => boolean;
}

/**
 * La politique de mot de passe — SOURCE UNIQUE.
 *
 * L'écran affiche cette liste et la coche en direct ; le serveur revalide la
 * MÊME liste. Une politique écrite deux fois dérive : la coche verte finirait
 * par promettre ce que l'API refuse, ou l'inverse.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    libelle: `${PASSWORD_MIN_LENGTH} caractères minimum`,
    ok: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  { libelle: 'Une majuscule', ok: (p) => /[A-Z]/.test(p) },
  { libelle: 'Une minuscule', ok: (p) => /[a-z]/.test(p) },
  { libelle: 'Un chiffre', ok: (p) => /\d/.test(p) },
  { libelle: 'Un caractère spécial', ok: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const PASSWORD_EMAIL_RULE = 'Différent de votre email';

/**
 * Le mot de passe ne reprend pas l'identifiant.
 *
 * On compare la partie locale de l'adresse par fenêtres de quatre caractères :
 * « diop » dans « diop2026! » se voit, alors qu'une comparaison stricte le
 * laisserait passer. En dessous de trois caractères la règle ne veut rien dire
 * — trop d'homonymies fortuites — et elle cesse alors de s'appliquer.
 */
export function passwordDiffersFromEmail(password: string, email: string): boolean {
  const local = (email.split('@')[0] ?? '').toLowerCase();
  if (local.length < 3) return true;
  const p = password.toLowerCase();
  if (local.length < 4) return !p.includes(local);
  for (let i = 0; i <= local.length - 4; i += 1) {
    if (p.includes(local.slice(i, i + 4))) return false;
  }
  return true;
}

/** Les règles à afficher, celle qui dépend de l'adresse comprise. */
export function passwordRulesFor(email: string): PasswordRule[] {
  return [
    ...PASSWORD_RULES,
    { libelle: PASSWORD_EMAIL_RULE, ok: (p) => passwordDiffersFromEmail(p, email) },
  ];
}

/** Ce qui manque encore, en une phrase — c'est ce que le serveur renverra. */
export function passwordShortfall(password: string): string | null {
  const manque = PASSWORD_RULES.filter((r) => !r.ok(password)).map((r) => r.libelle.toLowerCase());
  if (manque.length === 0) return null;
  return `Le mot de passe doit comporter : ${manque.join(', ')}.`;
}

export const passwordSchema = z
  .string()
  .max(128)
  .superRefine((valeur, ctx) => {
    const manque = passwordShortfall(valeur);
    if (manque) ctx.addIssue({ code: 'custom', message: manque });
  });

export const registerInputSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120),
    givenName: z.string().trim().min(1).max(80),
    familyName: z.string().trim().min(1).max(80),
    email: z.email().max(254),
    password: passwordSchema,
  })
  // La règle qui croise deux champs ne peut pas vivre dans `passwordSchema` :
  // elle a besoin de l'adresse.
  .refine((v) => passwordDiffersFromEmail(v.password, v.email), {
    message: 'Le mot de passe ne doit pas reprendre votre adresse email.',
    path: ['password'] as PropertyKey[],
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

// ---------- Noms de personnes ----------

/**
 * Le nom d'affichage d'une personne, quand la place manque.
 *
 * Au Sénégal, deux ou trois prénoms sont la règle plutôt que l'exception —
 * « Mouhamadou Moustapha Habib Kane ». Écrit en entier dans une carte ou une
 * colonne de tableau, le nom déborde ou se fait couper au milieu, et c'est
 * justement le NOM DE FAMILLE, à la fin, qui disparaît. On garde donc le
 * premier prénom en entier et on réduit les suivants à leur initiale :
 * « Mouhamadou M. H. Kane ».
 *
 * Les prénoms composés ne se coupent PAS sur leur trait d'union : « Jean-
 * Baptiste » est un seul prénom, « Jean B. » en ferait deux. Seule l'espace
 * sépare deux prénoms.
 */
/**
 * Le premier prénom, seul.
 *
 * « Mouhamadou Moustapha Salih » est un état civil ; « Mouhamadou » est la
 * façon dont on s'adresse à quelqu'un. Un message de remerciement qui récite
 * les trois prénoms sonne comme un formulaire administratif.
 */
export function premierPrenom(givenName: string): string {
  return givenName.trim().split(/\s+/)[0] ?? '';
}

/**
 * « de » ou « d' », selon ce qui suit.
 *
 * « le poste de Chargé d'affaires », mais « le poste d'Analyste marketing ».
 * L'élision se fait devant une voyelle et devant un h muet — et les intitulés
 * de poste qui commencent par un h en portent presque toujours un muet
 * (hôtesse, horticulteur, hydraulicien). Les rares h aspirés — « héros » — ne
 * sont pas des métiers.
 */
export function deElide(mot: string): string {
  const premier = mot.trim()[0]?.toLocaleLowerCase('fr') ?? '';
  return /[aeiouyàâäéèêëîïôöùûüh]/.test(premier) ? "d'" : 'de ';
}

export function nomAbrege(givenName: string, familyName: string): string {
  const nom = familyName.trim();
  const prenoms = givenName.trim().split(/\s+/).filter(Boolean);
  if (prenoms.length === 0) return nom;
  const [premier, ...suivants] = prenoms;
  const initiales = suivants.map((p) => `${[...p][0]!.toLocaleUpperCase('fr')}.`);
  return [premier, ...initiales, nom].filter(Boolean).join(' ');
}
