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
      problem(401, 'auth.session_invalid', 'Session expirée ou invalide');
    }
    req.sessionUser = user;
    req.sessionToken = token;
    return true;
  }
}
