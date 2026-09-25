/**
 * Les règles de l'évaluation finale, sans base : tirage, correction,
 * rythme des tentatives, numéro et validité du certificat.
 */
import { describe, expect, it } from 'vitest';
import type { QuestionPosee } from '../src/db/schema';
import {
  corriger,
  expiration,
  fenetreTentatives,
  melanger,
  normaliserNumero,
  numeroCertificat,
  statutCertificat,
  tirerQuestions,
  type Hasard,
} from '../src/modules/academy/evaluation';

/** Un hasard rejouable (générateur congruentiel), pour des tests stables. */
function graine(n: number): Hasard {
  let etat = n;
  return (max) => {
    etat = (etat * 1103515245 + 12345) % 2147483648;
    return etat % max;
  };
}

const banque = Array.from({ length: 12 }, (_, i) => ({
  id: `q${i}`,
  prompt: `Question ${i}`,
  kind: i % 3 === 0 ? 'multiple' : 'unique',
  options: [
    { id: `q${i}a`, text: 'A', correct: true },
    { id: `q${i}b`, text: 'B', correct: i % 3 === 0 },
    { id: `q${i}c`, text: 'C', correct: false },
  ],
}));

describe('le tirage', () => {
  it('pose le nombre demandé, sans doublon, bonnes réponses figées à part', () => {
    const posees = tirerQuestions(banque, 5, graine(1));
    expect(posees).toHaveLength(5);
    expect(new Set(posees.map((q) => q.id)).size).toBe(5);
    for (const q of posees) {
      // Les choix partent sans leur drapeau « correct » : c'est la copie qu'on
      // enverra à l'écran.
      expect(q.options.every((o) => !('correct' in o))).toBe(true);
      expect(q.correct.length).toBeGreaterThan(0);
    }
  });

  it('pose toute la banque si elle est plus petite que demandé', () => {
    expect(tirerQuestions(banque.slice(0, 3), 10, graine(2))).toHaveLength(3);
  });

  it('deux tentatives ne posent pas les mêmes questions dans le même ordre', () => {
    const a = tirerQuestions(banque, 6, graine(3)).map((q) => q.id);
    const b = tirerQuestions(banque, 6, graine(99)).map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it('le mélange garde tous les éléments', () => {
    const m = melanger([1, 2, 3, 4, 5, 6], graine(7));
    expect([...m].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('la correction', () => {
  const q = (
    id: string,
    correct: string[],
    kind: 'unique' | 'multiple' = 'unique',
  ): QuestionPosee => ({
    id,
    prompt: id,
    kind,
    options: [
      { id: `${id}a`, text: 'A' },
      { id: `${id}b`, text: 'B' },
      { id: `${id}c`, text: 'C' },
    ],
    correct,
  });
  const dix = Array.from({ length: 10 }, (_, i) => q(`q${i}`, [`q${i}a`]));
  const justes = (n: number) =>
    Object.fromEntries(dix.map((x, i) => [x.id, [i < n ? `${x.id}a` : `${x.id}b`]]));

  it('8 sur 10, c’est 80 % : réussi ; 7 sur 10 : échoué', () => {
    expect(corriger(dix, justes(8))).toMatchObject({ correctCount: 8, passed: true, score: 0.8 });
    expect(corriger(dix, justes(7))).toMatchObject({ correctCount: 7, passed: false });
  });

  it('le seuil s’arrondit à la question supérieure : 6 sur 7 réussit, 5 sur 7 échoue', () => {
    const sept = Array.from({ length: 7 }, (_, i) => q(`p${i}`, [`p${i}a`]));
    const copie = (n: number) =>
      Object.fromEntries(sept.map((x, i) => [x.id, [i < n ? `${x.id}a` : `${x.id}b`]]));
    expect(corriger(sept, copie(6)).passed).toBe(true);
    expect(corriger(sept, copie(5)).passed).toBe(false);
  });

  it('une question à plusieurs réponses : toutes, et rien d’autre', () => {
    const m = q('m', ['ma', 'mb'], 'multiple');
    expect(corriger([m], { m: ['ma', 'mb'] }).correctCount).toBe(1);
    expect(corriger([m], { m: ['ma'] }).correctCount).toBe(0);
    // Tout cocher ne rapporte rien.
    expect(corriger([m], { m: ['ma', 'mb', 'mc'] }).correctCount).toBe(0);
  });

  it('une copie vide, ou des identifiants inventés, ne rapportent rien', () => {
    expect(corriger(dix, null)).toMatchObject({ correctCount: 0, passed: false });
    expect(corriger(dix, { q0: ['inventé'] }).correctCount).toBe(0);
  });

  it('une réponse cochée deux fois compte une fois', () => {
    expect(corriger([q('x', ['xa'])], { x: ['xa', 'xa'] }).correctCount).toBe(1);
  });
});

describe('le rythme des tentatives', () => {
  const T = new Date('2026-09-25T10:00:00Z');
  const il_y_a = (h: number) => new Date(T.getTime() - h * 3600 * 1000);

  it('trois tentatives par vingt-quatre heures glissantes', () => {
    expect(fenetreTentatives([], T)).toEqual({ restantes: 3, prochaine: null });
    expect(fenetreTentatives([il_y_a(2), il_y_a(1)], T).restantes).toBe(1);
  });

  it('épuisées, la suivante s’ouvre quand la plus ancienne sort de la fenêtre', () => {
    const r = fenetreTentatives([il_y_a(5), il_y_a(3), il_y_a(1)], T);
    expect(r.restantes).toBe(0);
    expect(r.prochaine?.toISOString()).toBe(
      new Date(il_y_a(5).getTime() + 24 * 3600 * 1000).toISOString(),
    );
  });

  it('les tentatives de plus de vingt-quatre heures ne comptent plus', () => {
    expect(fenetreTentatives([il_y_a(30), il_y_a(26), il_y_a(25)], T).restantes).toBe(3);
  });
});

describe('le certificat', () => {
  it('un numéro APX-XXXX-XXXX, sans lettre ambiguë', () => {
    const n = numeroCertificat(graine(4));
    expect(n).toMatch(/^APX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('un numéro saisi à la main se remet au propre', () => {
    expect(normaliserNumero('apx 7k3m 9q2f')).toBe('APX-7K3M-9Q2F');
    expect(normaliserNumero('7K3M9Q2F')).toBe('APX-7K3M-9Q2F');
    expect(normaliserNumero('APX-7K3M-9QOF')).toBe('APX-7K3M-9Q0F');
    expect(normaliserNumero('APX-123')).toBeNull();
  });

  it('valable N mois, fin de mois comprise', () => {
    expect(expiration(new Date('2026-01-31T09:00:00Z'), 1)?.toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    expect(expiration(new Date('2026-09-25T09:00:00Z'), 12)?.toISOString().slice(0, 10)).toBe(
      '2027-09-25',
    );
    expect(expiration(new Date('2026-09-25T09:00:00Z'), null)).toBeNull();
  });

  it('valide, expiré ou révoqué, à la date du jour', () => {
    const maintenant = new Date('2026-09-25T00:00:00Z');
    expect(statutCertificat({ expiresAt: null, revokedAt: null }, maintenant)).toBe('valide');
    expect(
      statutCertificat({ expiresAt: new Date('2026-01-01'), revokedAt: null }, maintenant),
    ).toBe('expire');
    expect(
      statutCertificat({ expiresAt: null, revokedAt: new Date('2026-02-01') }, maintenant),
    ).toBe('revoque');
  });
});
