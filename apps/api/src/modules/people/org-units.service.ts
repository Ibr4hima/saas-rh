import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { CreateOrgUnitInput, OrgUnit, SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';

@Injectable()
export class OrgUnitsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async list(user: SessionUser): Promise<OrgUnit[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const rows = await tx
        .select({
          id: t.orgUnits.id,
          name: t.orgUnits.name,
          unitType: t.orgUnits.unitType,
          parentId: t.orgUnits.parentId,
        })
        .from(t.orgUnits)
        .where(isNull(t.orgUnits.deletedAt))
        .orderBy(asc(t.orgUnits.unitType), asc(t.orgUnits.name));
      return rows as OrgUnit[];
    });
  }

  async create(user: SessionUser, input: CreateOrgUnitInput): Promise<{ id: string }> {
    const id = uuidv7();
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      if (input.parentId) {
        const [parent] = await tx
          .select({ id: t.orgUnits.id })
          .from(t.orgUnits)
          .where(and(eq(t.orgUnits.id, input.parentId), isNull(t.orgUnits.deletedAt)))
          .limit(1);
        if (!parent) {
          problem(422, 'org.parent_not_found', "L'unité parente n'existe pas");
        }
      }
      await tx.insert(t.orgUnits).values({
        id,
        tenantId: user.tenantId,
        name: input.name,
        unitType: input.unitType,
        parentId: input.parentId ?? null,
      });
    });
    return { id };
  }
}
