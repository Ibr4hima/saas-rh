import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import { SESSION_COOKIE } from './auth.constants';
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
    const user = await this.auth.resolveSession(token);
    if (!user) {
      problem(401, 'auth.session_invalid', 'Session expirée ou invalide');
    }
    req.sessionUser = user;
    req.sessionToken = token;
    return true;
  }
}
