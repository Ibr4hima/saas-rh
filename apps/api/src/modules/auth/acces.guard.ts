import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { peut, type Capacite } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { AuthenticatedRequest } from './session.guard';

export const CAPACITES_KEY = 'capacites';

/**
 * Restreint une route à qui détient l'une de ces habilitations — le
 * directeur du Capital Humain, un membre de la DCH à qui il l'a confiée, ou
 * l'administrateur pour la gestion. S'utilise APRÈS SessionGuard.
 */
export const Peut = (...capacites: Capacite[]) => SetMetadata(CAPACITES_KEY, capacites);

@Injectable()
export class AccesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requises = this.reflector.getAllAndOverride<Capacite[] | undefined>(CAPACITES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requises || requises.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!requises.some((c) => peut(req.sessionUser, c))) {
      problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    }
    return true;
  }
}
