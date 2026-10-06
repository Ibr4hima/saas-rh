import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
   Les messages de validation, en français.

   Zod écrit en anglais par défaut (« Invalid input », « Too small ») ;
   l'API les renvoyait tels quels. Les cas courants ont ici leur phrase ;
   le reste suit la traduction française livrée avec Zod.
   ──────────────────────────────────────────────────────────────── */

const pluriel = (n: number | bigint, mot: string) => `${n} ${mot}${Number(n) > 1 ? 's' : ''}`;

const FORMATS: Record<string, string> = {
  email: 'Adresse email invalide',
  date: 'Date invalide',
  datetime: 'Date et heure invalides',
  uuid: 'Identifiant invalide',
  url: 'Adresse web invalide',
};

function messageFr(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined || issue.input === null ? 'Champ requis' : 'Valeur invalide';
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1
          ? 'Champ requis'
          : `Au moins ${pluriel(issue.minimum, 'caractère')}`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `Au moins ${pluriel(issue.minimum, 'élément')}`;
      }
      return `La valeur doit être au moins ${issue.minimum}`;
    case 'too_big':
      if (issue.origin === 'string') return `${pluriel(issue.maximum, 'caractère')} au plus`;
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `${pluriel(issue.maximum, 'élément')} au plus`;
      }
      return `La valeur doit être au plus ${issue.maximum}`;
    case 'invalid_format':
      return FORMATS[issue.format] ?? 'Format invalide';
    case 'invalid_value':
      return 'Valeur non reconnue';
    default:
      return undefined;
  }
}

z.config({
  ...z.locales.fr(),
  customError: messageFr,
  // Dans le navigateur, le site interdit d'évaluer du code (politique de
  // sécurité du contenu) : zod valide sans compiler, et n'essaie même pas.
  // Réglé ici, avant qu'aucun schéma ne se crée.
  ...('document' in globalThis ? { jitless: true } : {}),
});
