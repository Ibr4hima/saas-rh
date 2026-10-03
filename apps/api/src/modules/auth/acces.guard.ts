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

export const FERME_AUX_INACTIFS_KEY = 'fermeAuxInactifs';

/**
 * Fermé à qui n'est plus en activité : pendant le mois où son portail reste
 * ouvert, il ne pose plus de demande d'absence et n'a plus accès aux
 * objectifs, à l'Academy ni à l'organigramme. Sur une classe ou une route.
 */
export const FermeAuxInactifs = () => SetMetadata(FERME_AUX_INACTIFS_KEY, true);

@Injectable()
export class AccesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ferme = this.reflector.getAllAndOverride<boolean | undefined>(FERME_AUX_INACTIFS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (ferme && req.sessionUser.finDAcces) {
      problem(
        403,
        'acces.inactif',
        'Accès restreint',
        'Vous n’êtes plus en activité : cette page ne vous est plus ouverte.',
      );
    }
    const requises = this.reflector.getAllAndOverride<Capacite[] | undefined>(CAPACITES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requises || requises.length === 0) return true;

    if (!requises.some((c) => peut(req.sessionUser, c))) {
      problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    }
    return true;
  }
}
