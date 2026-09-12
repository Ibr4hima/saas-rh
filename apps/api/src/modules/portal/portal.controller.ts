import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  acceptInvitationSchema,
  inviteEmployeeSchema,
  type AcceptInvitationInput,
  type InviteEmployeeInput,
  type MyEmployeeView,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { SESSION_COOKIE } from '../auth/auth.constants';
import { loadEnv } from '../../config/env';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { InvitationsService } from './invitations.service';

@Controller()
export class PortalController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  // ---------- Côté gestionnaire (session requise) ----------

  @Post('employees/:id/invite')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles('admin', 'hr')
  invite(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inviteEmployeeSchema)) body: InviteEmployeeInput,
  ) {
    return this.invitations.invite(req.sessionUser, id, body.role, body.email);
  }

  /** Mon dossier : l'employé relié au compte connecté. */
  @Get('me/employee')
  @UseGuards(SessionGuard)
  async myEmployee(@Req() req: AuthenticatedRequest): Promise<MyEmployeeView> {
    const user = req.sessionUser;
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const [row] = await tx
        .select({
          employeeId: t.employees.id,
          employeeNumber: t.employees.employeeNumber,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          hiredOn: t.employees.hiredOn,
          status: t.employees.status,
          workEmail: t.employees.workEmail,
          positionTitle: t.assignments.positionTitle,
          orgUnitName: t.orgUnits.name,
        })
        .from(t.persons)
        .innerJoin(t.employees, eq(t.employees.personId, t.persons.id))
        .leftJoin(
          t.assignments,
          and(
            eq(t.assignments.employeeId, t.employees.id),
            sql`${t.assignments.validity} @> CURRENT_DATE`,
          ),
        )
        .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.assignments.orgUnitId))
        .where(and(eq(t.persons.userId, user.userId), isNull(t.persons.deletedAt)))
        .limit(1);
      if (!row) {
        problem(
          404,
          'me.no_employee_record',
          'Aucun dossier employé relié à ce compte',
          'Ce compte gère l’organisation sans être lui-même un employé.',
        );
      }
      return {
        ...row,
        positionTitle: row.positionTitle ?? null,
        orgUnitName: row.orgUnitName ?? null,
      };
    });
  }

  // ---------- Côté public (acceptation, sans session) ----------

  @Get('invitations/:token')
  info(@Param('token') token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      return { valid: false, reason: 'not_found' as const };
    }
    return this.invitations.info(token);
  }

  @Post('invitations/:token/accept')
  async accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      problem(410, 'portal.invitation_invalid', "Cette invitation n'est plus valable");
    }
    const { result, session } = await this.invitations.accept(token, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (session) {
      const env = loadEnv();
      res.cookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        expires: session.expiresAt,
      });
    }
    return result;
  }
}
