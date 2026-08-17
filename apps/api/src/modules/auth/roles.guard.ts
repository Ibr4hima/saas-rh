import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { AuthenticatedRequest } from './session.guard';

export const ROLES_KEY = 'roles';
/** Restreint une route aux rôles listés. S'utilise APRÈS SessionGuard. */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = req.sessionUser?.role;
    if (!role || !required.includes(role)) {
      problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    }
    return true;
  }
}
