/**
 * Accès base de données tenanté — LE point de passage unique du contexte RLS
 * (ADR-0002). Toute requête métier passe par withTenant() : le contexte
 * (app.tenant_id, app.user_id) est posé par set_config(..., is_local => true)
 * DANS la transaction, donc il ne peut jamais fuir entre requêtes via le
 * pooling de connexions.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { avecMemoire } from '../common/memoire';
import { loadEnv } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Le fuseau de chaque connexion. « Aujourd'hui » se décide en base (une fin
 * de contrat, un congé qui commence, un rappel) : CURRENT_DATE doit donner le
 * jour de Dakar, quel que soit le réglage du serveur qui héberge la base.
 * Dakar est à UTC+0, sans heure d'été.
 */
export const FUSEAU_HORAIRE = 'Africa/Dakar';
/**
 * Sans compilation JIT : elle sert les longues requêtes d'analyse, pas des
 * lectures de quelques millisecondes. Sur la liste du personnel à 3 000
 * agents, elle coûtait 3,4 s de compilation pour 1,7 s d'exécution
 * (ADR-0067).
 */
export const OPTIONS_CONNEXION = `-c TimeZone=${FUSEAU_HORAIRE} -c jit=off`;

/**
 * Les bornes des connexions de l'application (ADR-0067) : une requête qui
 * dure plus d'une minute est arrêtée, un verrou attendu plus de vingt
 * secondes aussi, une transaction ouverte puis oubliée une minute se ferme.
 * Une requête bloquée ne retient plus une connexion du pool indéfiniment.
 * Les migrations gardent leurs propres réglages : un index sur une grande
 * table peut demander plus.
 */
export const OPTIONS_APPLICATION =
  `${OPTIONS_CONNEXION} -c statement_timeout=60000 -c lock_timeout=20000` +
  ` -c idle_in_transaction_session_timeout=60000`;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TenantContext {
  tenantId: string;
  userId?: string;
}

@Injectable()
export class TenantDb implements OnModuleDestroy {
  private readonly logger = new Logger('Base');
  readonly pool: Pool;
  /**
   * Accès SANS contexte tenant : sous RLS, les tables tenantées ne renvoient
   * AUCUNE ligne. À réserver aux tables globales (users, sessions).
   */
  readonly global: Db;

  constructor() {
    const env = loadEnv();
    this.pool = new Pool({
      connectionString: env.APP_DATABASE_URL,
      max: env.DB_POOL_MAX,
      // Toutes les connexions prises : une requête en attend une dix secondes
      // au plus, puis répond 503 au lieu de pendre.
      connectionTimeoutMillis: 10_000,
      options: OPTIONS_APPLICATION,
    });
    // Une connexion au repos qui tombe (base redémarrée, réseau coupé) le dit
    // ici : le pool l'écarte et en ouvre une autre à la demande suivante.
    // Sans cet écouteur, l'erreur arrêterait le processus entier.
    this.pool.on('error', (err) => this.logger.warn(`Connexion perdue : ${err.message}`));
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
   * Une lecture : `withTenant`, avec une mémoire le temps de la transaction
   * (cf. `avecMemoire`). Pour les files qui relisent le circuit demande par
   * demande sans rien en écrire (ADR-0067).
   */
  lire<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withTenant(ctx, (tx) => avecMemoire(() => fn(tx)));
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

  /**
   * Contexte « offre publique » : pour la page de candidature (sans compte).
   * Le slug n'expose QUE l'offre publiée correspondante (et le nom de son
   * organisation). Une fois l'offre validée, le code pose app.tenant_id
   * dans la même transaction pour insérer la candidature sous la policy
   * tenant standard — même pattern que l'acceptation d'invitation.
   */
  async withJobSlug<T>(slug: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.global.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.job_slug', ${slug}, true)`);
      return fn(tx);
    });
  }

  /**
   * Contexte « vérification de certificat » : pour la page publique qui
   * confirme qu'un certificat APIX Academy est authentique. Sans session ni
   * tenant, la policy dédiée n'expose QUE le certificat dont l'appelant
   * présente le numéro — jamais une liste.
   */
  async withCertificateNumber<T>(numero: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.global.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.certificate_number', ${numero}, true)`);
      return fn(tx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
