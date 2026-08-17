import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';

export interface DashboardStats {
  activeEmployees: number;
  pendingRequests: number;
  upcomingAbsences: number;
  orgUnits: number;
}

@Controller()
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Compteurs du tableau de bord — une seule requête par tuile, côté SQL. */
  @Get('dashboard')
  async stats(@Req() req: AuthenticatedRequest): Promise<DashboardStats> {
    const user = req.sessionUser;
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const count = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
      const n = sql<number>`count(*)::int`;

      const [activeEmployees, pendingRequests, upcomingAbsences, orgUnits] = await Promise.all([
        count(tx.select({ n }).from(t.employees).where(eq(t.employees.status, 'active'))),
        count(
          tx.select({ n }).from(t.absenceRequests).where(eq(t.absenceRequests.status, 'pending')),
        ),
        count(
          tx
            .select({ n })
            .from(t.absenceRequests)
            .where(
              and(
                eq(t.absenceRequests.status, 'approved'),
                gte(t.absenceRequests.endDate, sql`CURRENT_DATE`),
                lte(t.absenceRequests.startDate, sql`CURRENT_DATE + 30`),
              ),
            ),
        ),
        count(tx.select({ n }).from(t.orgUnits).where(isNull(t.orgUnits.deletedAt))),
      ]);

      return { activeEmployees, pendingRequests, upcomingAbsences, orgUnits };
    });
  }
}
