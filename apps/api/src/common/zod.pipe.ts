import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ProblemException } from './problem';

/** Valide le corps de requête contre un schéma Zod du paquet contracts. */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {
    if (!schema) {
      // Un schéma absent signifie presque toujours un dist de @teranga/contracts
      // périmé (git pull sans rebuild) : on échoue tôt avec le remède.
      throw new Error(
        'Schéma Zod manquant : le paquet @teranga/contracts est probablement périmé. ' +
          'Arrêtez le serveur puis relancez `pnpm build` et `pnpm dev`.',
      );
    }
  }

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
        .join(' ; ');
      throw new ProblemException({
        status: 400,
        code: 'validation_failed',
        title: 'Requête invalide',
        detail,
      });
    }
    return result.data;
  }
}
