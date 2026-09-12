import { Controller, Get, Inject } from '@nestjs/common';
import type { Health } from '@teranga/contracts';
import { TenantDb } from '../../db/tenant-db';

@Controller()
export class HealthController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  @Get('health')
  async health(): Promise<Health> {
    let dbStatus: Health['db'] = 'ok';
    try {
      await this.db.pool.query('SELECT 1');
    } catch {
      dbStatus = 'down';
    }
    return { status: 'ok', db: dbStatus, version: '0.0.1' };
  }
}
