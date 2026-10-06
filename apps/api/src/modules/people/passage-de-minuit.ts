import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../db/tenant-db';
import { inactiverLesContratsEchus } from './activite';

/** Quelques secondes après minuit : la base a changé de jour. */
const MARGE_MS = 30_000;

/**
 * Le délai jusqu'au prochain passage, juste après minuit à Dakar. Dakar est à
 * UTC+0 sans heure d'été (cf. `FUSEAU_HORAIRE`) : son minuit est celui d'UTC.
 */
export function delaiJusquAMinuit(maintenant: Date): number {
  const minuit = new Date(maintenant);
  minuit.setUTCHours(24, 0, 0, 0);
  return minuit.getTime() - maintenant.getTime() + MARGE_MS;
}

/**
 * Chaque nuit, juste après minuit, et au démarrage (une nuit manquée se
 * rattrape) : les contrats de chaque organisation passent. Les fins de
 * contrat rangent leurs dossiers dans les inactifs, les contrats qui
 * commencent appliquent leur place, les mots de passe échus s'effacent ; le
 * tout au nom du système. La relève des notifications le fait aussi, au fil
 * de la journée : ce passage-ci garantit que le jour change à minuit, même
 * si personne n'ouvre la plateforme.
 */
@Injectable()
export class PassageDeMinuit implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Passage de minuit');
  private minuterie: NodeJS.Timeout | null = null;

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  onModuleInit(): void {
    // Les tests posent leurs propres dates : pas de passage qui les devance.
    if (process.env.VITEST) return;
    void this.passer();
    this.programmer();
  }

  onModuleDestroy(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private programmer(): void {
    this.minuterie = setTimeout(() => {
      void this.passer().finally(() => this.programmer());
    }, delaiJusquAMinuit(new Date()));
    this.minuterie.unref();
  }

  /**
   * Un passage : chaque organisation dans sa transaction, sous sa RLS. Une
   * organisation en échec n'empêche pas les autres. `seules` : pour n'en
   * passer que certaines.
   */
  async passer(seules?: string[]): Promise<number> {
    const { rows } = await this.db.global.execute<{ id: string }>(
      sql`SELECT organisations_a_passer() AS id`,
    );
    let rangees = 0;
    for (const { id } of rows) {
      if (seules && !seules.includes(id)) continue;
      try {
        rangees += await this.db.withTenant({ tenantId: id }, (tx) =>
          inactiverLesContratsEchus(tx, id),
        );
      } catch (e) {
        this.logger.error(`Organisation ${id} : ${(e as Error).message}`);
      }
    }
    return rangees;
  }
}
