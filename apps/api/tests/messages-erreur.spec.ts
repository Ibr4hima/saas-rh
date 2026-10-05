/**
 * Les erreurs se lisent en français : celles que l'API écrit, celles que Zod
 * produit en validant un corps, et celles que Nest lève de lui-même.
 */
import { NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createJobPostingSchema } from '@teranga/contracts';
import { ProblemException, ProblemFilter } from '../src/common/problem';
import { ZodValidationPipe } from '../src/common/zod.pipe';

/** Ce que le filtre renvoie pour une exception. */
function reponse(exception: unknown) {
  let corps: Record<string, unknown> = {};
  const res = {
    status: () => res,
    type: () => res,
    json: (c: Record<string, unknown>) => {
      corps = c;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return corps;
}

describe('messages d’erreur', () => {
  it('Zod valide en français', () => {
    try {
      new ZodValidationPipe(createJobPostingSchema).transform({
        title: '',
        contractType: 'zz',
        deadline: '2020-99-99',
      });
      throw new Error('attendu un refus');
    } catch (err) {
      const { detail } = (err as ProblemException).problem;
      expect(detail).toContain('title : Champ requis');
      expect(detail).toContain('contractType : Valeur non reconnue');
      expect(detail).toContain('deadline : Date invalide');
      expect(detail).not.toMatch(/\b(invalid|expected|received)\b/i);
    }
  });

  it('les erreurs de Nest gardent leur statut, avec un titre français', async () => {
    expect(reponse(new NotFoundException('Cannot GET /v1/rien'))).toMatchObject({
      status: 404,
      title: 'Adresse introuvable',
    });
    const refus = await new ParseUUIDPipe()
      .transform('pas-un-uuid', { type: 'param' })
      .catch((e: unknown) => e);
    expect(reponse(refus)).toMatchObject({ status: 400, title: 'Requête invalide' });
  });
});
