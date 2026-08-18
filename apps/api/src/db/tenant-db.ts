/**
 * Accès base de données tenanté — LE point de passage unique du contexte RLS
 * (ADR-0002). Toute requête métier passe par withTenant() : le contexte
 * (app.tenant_id, app.user_id) est posé par set_config(..., is_local => true)
 * DANS la transaction, donc il ne peut jamais fuir entre requêtes via le
 * pooling de connexions.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TenantContext {
  tenantId: string;
  userId?: string;
}

@Injectable()
export class TenantDb implements OnModuleDestroy {
  readonly pool: Pool;
  /**
   * Accès SANS contexte tenant : sous RLS, les tables tenantées ne renvoient
   * AUCUNE ligne. À réserver aux tables globales (users, sessions).
   */
  readonly global: Db;

  constructor() {
    const env = loadEnv();
    this.pool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 10 });
    this.global = drizzle(this.pool, { schema });
  }

  /** Exécute `fn` dans une transaction porteuse du contexte tenant. */
  async withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.global.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                   set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  /**
   * Contexte utilisateur seul (sans tenant) : nécessaire au login pour lister
   * les organisations d'un utilisateur authentifié (policies `app_user_id()`).
   */
  async withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.global.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  }

  /**
   * Contexte « token d'invitation » : pour la page publique d'acceptation.
   * Sans session ni tenant, les policies dédiées n'exposent QUE la ligne
   * d'invitation dont l'appelant présente le hash, et ce qu'il faut pour
   * l'accepter (nom du tenant, personne à relier, membership à créer).
   */
  async withInvitationToken<T>(tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.global.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.invitation_token_hash', ${tokenHash}, true)`);
      return fn(tx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
