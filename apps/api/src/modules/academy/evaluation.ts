import { randomInt } from 'node:crypto';
import {
  FENETRE_TENTATIVES_H,
  SECONDES_PAR_QUESTION,
  SEUIL_REUSSITE,
  TENTATIVES_PAR_JOUR,
} from '@teranga/contracts';
import type { OptionQuestion, QuestionPosee } from '../../db/schema';

/* ————————————————————————————————————————————————————————————————
   Les règles de l'évaluation finale.

   Tout ce qui décide — quelles questions sont posées, dans quel ordre, ce qui
   est juste, quand on peut repasser — tient ici, en fonctions PURES. Le
   hasard lui-même est un paramètre : les tests le fixent, la production le
   tire de `crypto` (un tirage prévisible serait une fuite de la banque).

   Ce que ces règles protègent :

   · La BANQUE. Chaque tentative tire ses questions au hasard et mélange les
     choix : deux collègues qui composent côte à côte n'ont ni les mêmes
     questions, ni les mêmes réponses au même endroit.

   · La CORRECTION. Une question compte si les choix cochés sont EXACTEMENT
     les bons — ni un de moins, ni un de plus. Cocher tout ne rapporte rien.

   · Le RYTHME. Trois tentatives par vingt-quatre heures glissantes : on
     repasse après avoir revu les leçons, pas en rafale jusqu'à tomber juste.
   ———————————————————————————————————————————————————————————————— */

/** Un entier au hasard dans [0, n). */
export type Hasard = (n: number) => number;

export const hasardSur: Hasard = (n) => randomInt(n);

/** Fisher–Yates : chaque ordre a la même chance. */
export function melanger<T>(items: readonly T[], hasard: Hasard): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = hasard(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface QuestionDeBanque {
  id: string;
  prompt: string;
  kind: string;
  options: OptionQuestion[];
}

/**
 * Tire `n` questions dans la banque — toutes si elle en a moins —, mélange
 * leur ordre et celui de leurs choix, et fige le tout avec les bonnes
 * réponses : c'est la copie contre laquelle on corrigera.
 */
export function tirerQuestions(
  banque: QuestionDeBanque[],
  n: number,
  hasard: Hasard,
): QuestionPosee[] {
  return melanger(banque, hasard)
    .slice(0, Math.max(0, n))
    .map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind === 'multiple' ? 'multiple' : 'unique',
      options: melanger(q.options, hasard).map((o) => ({ id: o.id, text: o.text })),
      correct: q.options.filter((o) => o.correct).map((o) => o.id),
    }));
}

export interface Correction {
  score: number;
  correctCount: number;
  total: number;
  parQuestion: Array<{ id: string; correct: boolean }>;
  passed: boolean;
}

/** Corrige une copie : tout ou rien par question, 80 % pour réussir. */
export function corriger(
  posees: QuestionPosee[],
  reponses: Record<string, string[]> | null,
): Correction {
  const parQuestion = posees.map((q) => {
    const cochees = new Set(reponses?.[q.id] ?? []);
    const bonnes = new Set(q.correct);
    const juste = cochees.size === bonnes.size && [...bonnes].every((id) => cochees.has(id));
    return { id: q.id, correct: juste };
  });
  const correctCount = parQuestion.filter((q) => q.correct).length;
  const total = posees.length;
  const score = total === 0 ? 0 : correctCount / total;
  // Le nombre de bonnes réponses exigé, arrondi à l'entier supérieur : sept
  // questions à 80 % en exigent six. La marge d'un milliardième ne sert qu'à
  // un seuil futur dont le produit tomberait juste au-dessus d'un entier.
  const exigees = Math.ceil(SEUIL_REUSSITE * total - 1e-9);
  const passed = total > 0 && correctCount >= exigees;
  return { score, correctCount, total, parQuestion, passed };
}

/** Le temps accordé à une tentative, en secondes. */
export function dureeTentative(nombreDeQuestions: number): number {
  return nombreDeQuestions * SECONDES_PAR_QUESTION;
}

/**
 * Combien de tentatives restent dans la fenêtre glissante, et quand la
 * suivante s'ouvre si elles sont épuisées.
 *
 * La fenêtre compte les tentatives COMMENCÉES dans les vingt-quatre dernières
 * heures. La prochaine s'ouvre quand la plus ancienne des trois dernières en
 * sort.
 */
export function fenetreTentatives(
  debuts: Date[],
  maintenant: Date,
): { restantes: number; prochaine: Date | null } {
  const duree = FENETRE_TENTATIVES_H * 3600 * 1000;
  const recentes = debuts
    .map((d) => d.getTime())
    .filter((t) => t > maintenant.getTime() - duree)
    .sort((a, b) => a - b);
  const restantes = Math.max(0, TENTATIVES_PAR_JOUR - recentes.length);
  if (restantes > 0) return { restantes, prochaine: null };
  const cle = recentes[recentes.length - TENTATIVES_PAR_JOUR]!;
  return { restantes: 0, prochaine: new Date(cle + duree) };
}

/**
 * Le numéro d'un certificat : APX-XXXX-XXXX, huit caractères de l'alphabet
 * de Crockford — sans I, L, O ni U, qu'on confond à la lecture ou à la
 * frappe. Quarante bits de hasard : le numéro ne se devine pas, et c'est lui
 * qui ouvre la page publique de vérification.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function numeroCertificat(hasard: Hasard): string {
  const bloc = () => Array.from({ length: 4 }, () => CROCKFORD[hasard(CROCKFORD.length)]).join('');
  return `APX-${bloc()}-${bloc()}`;
}

/**
 * Un numéro saisi à la main, remis au propre : majuscules, tirets remis,
 * et les confusions courantes rattrapées (O → 0, I et L → 1).
 */
export function normaliserNumero(saisie: string): string | null {
  const brut = saisie
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  const corps = brut.startsWith('APX') ? brut.slice(3) : brut;
  if (!/^[0-9A-Z]{8}$/.test(corps)) return null;
  return `APX-${corps.slice(0, 4)}-${corps.slice(4)}`;
}

/** La fin de validité : `mois` mois après l'émission, ou jamais. */
export function expiration(emis: Date, mois: number | null): Date | null {
  if (mois === null) return null;
  const fin = new Date(emis);
  const jour = fin.getUTCDate();
  fin.setUTCDate(1);
  fin.setUTCMonth(fin.getUTCMonth() + mois);
  // Le 31 janvier plus un mois tombe le dernier jour de février, pas le 3 mars.
  const dernier = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 0)).getUTCDate();
  fin.setUTCDate(Math.min(jour, dernier));
  return fin;
}

export function statutCertificat(
  c: { expiresAt: Date | null; revokedAt: Date | null },
  maintenant: Date,
): 'valide' | 'expire' | 'revoque' {
  if (c.revokedAt) return 'revoque';
  if (c.expiresAt && c.expiresAt.getTime() <= maintenant.getTime()) return 'expire';
  return 'valide';
}
