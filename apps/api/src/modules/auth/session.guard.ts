import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import { EN_ARRIERE_PLAN, SESSION_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  sessionUser: SessionUser;
  sessionToken: string;
}

/**
 * En campagne (ADR-0211), un compte qui n'est pas d'administration n'a que
 * l'évaluation annuelle : sa session, la campagne, la déconnexion et ses
 * clés d'accès. Le reste de l'API lui est fermé, comme les écrans
 * (ADR-0290).
 */
const OUVERT_EN_CAMPAGNE = /^(\/v1)?\/(campagne(\/|$)|me$|auth\/)/;

/** La route demandée hors de la campagne, pour un compte qui n'a que la campagne. */
export const fermeeEnCampagne = (user: SessionUser, chemin: string): boolean =>
  user.campagne !== null && user.role !== 'admin' && !OUVERT_EN_CAMPAGNE.test(chemin);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) {
      problem(401, 'auth.session_required', 'Authentification requise');
    }
    // Un relevé automatique de la page (la cloche, les compteurs) ne compte
    // pas comme une activité : un onglet resté ouvert ne garde pas la
    // session en vie.
    const user = await this.auth.resolveSession(token, {
      activite: req.headers[EN_ARRIERE_PLAN] !== '1',
    });
    if (!user) {
      problem(401, 'auth.session_invalid', 'Votre session a expiré : reconnectez-vous');
    }
    if (fermeeEnCampagne(user, req.path)) {
      problem(
        403,
        'campagne.hors_campagne',
        'Pendant la campagne, seule l’évaluation annuelle est ouverte',
      );
    }
    req.sessionUser = user;
    req.sessionToken = token;
    return true;
  }
}
