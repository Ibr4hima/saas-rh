import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Health } from '@teranga/contracts';
import { TenantDb } from '../../db/tenant-db';

/** Au-delà, la base est tenue pour absente : la sonde ne reste pas pendue. */
const DELAI_DE_LA_SONDE_MS = 3_000;

@Controller()
export class HealthController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * La santé, telle que la lit un déploiement ou un répartiteur de charge
   * (ADR-0067) : 200 quand la base répond, 503 sinon. Une instance coupée de
   * sa base ne reçoit plus de trafic, au lieu de répondre 500 à chacun.
   */
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const db = (await this.laBaseRepond()) ? 'ok' : 'down';
    if (db === 'down') res.status(503);
    return { status: db === 'ok' ? 'ok' : 'degraded', db, version: '0.0.1' };
  }

  private async laBaseRepond(): Promise<boolean> {
    let minuterie: NodeJS.Timeout | undefined;
    const delai = new Promise<false>((fin) => {
      minuterie = setTimeout(() => fin(false), DELAI_DE_LA_SONDE_MS);
    });
    try {
      return await Promise.race([this.db.pool.query('SELECT 1').then(() => true), delai]);
    } catch {
      return false;
    } finally {
      clearTimeout(minuterie);
    }
  }
}
