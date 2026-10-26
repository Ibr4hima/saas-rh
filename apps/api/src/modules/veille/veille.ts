import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { parLeSysteme } from '../../db/systeme';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { annoncerLOuverture } from '../evaluations/circuit';
import { inactiverLesContratsEchus } from '../people/activite';
import { reconcilierLeCircuit } from '../time/visas';

/** Une minute entre la fin d'un tour et le début du suivant. */
export const CADENCE_DE_LA_VEILLE_MS = 60_000;

/**
 * La veille (ADR-0067) : ce que le temps change sans que personne n'écrive.
 * Un contrat arrive à son terme, une échéance approche, un N+1 part en congé
 * ce matin, une demande attend depuis deux jours ouvrés, un accès se ferme.
 *
 * Ces passages se faisaient à la lecture : la cloche, la liste du personnel
 * et le tableau de bord les déclenchaient, et la personne qui lisait
 * attendait qu'ils finissent. À 3 000 agents, la relève de la cloche durait
 * plusieurs minutes et retenait les autres derrière ses verrous. Ils se font
 * désormais ici, en tâche de fond, chaque minute, pour chaque organisation.
 *
 * Chaque étape a sa transaction : un verrou pris par l'une (la chaîne des
 * N+1, lors d'un départ) ne tient pas pendant les autres. Plusieurs
 * instances de l'API se partagent la veille sans la doubler : une étape
 * prend pour son organisation un verrou qu'elle n'attend pas ; occupé,
 * l'instance qui le tient fait le travail.
 */
@Injectable()
export class Veille implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Veille');
  private minuterie: NodeJS.Timeout | null = null;
  private arretee = false;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    // Les tests posent leurs propres dates et font passer la veille eux-mêmes.
    if (process.env.VITEST) return;
    this.programmer(5_000);
  }

  onModuleDestroy(): void {
    this.arretee = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private programmer(delai = CADENCE_DE_LA_VEILLE_MS): void {
    if (this.arretee) return;
    this.minuterie = setTimeout(() => {
      void this.veiller()
        .catch((e: unknown) => this.logger.error(`Tour manqué : ${(e as Error).message}`))
        .finally(() => this.programmer());
    }, delai);
    this.minuterie.unref();
  }

  /**
   * Un tour : chaque organisation, chaque étape. Une étape en échec n'arrête
   * ni les suivantes ni les autres organisations. `seules` : pour n'en faire
   * passer que certaines.
   */
  async veiller(seules?: string[]): Promise<void> {
    const { rows } = await this.db.global.execute<{ id: string }>(
      sql`SELECT organisations_a_passer() AS id`,
    );
    for (const { id } of rows) {
      if (seules && !seules.includes(id)) continue;
      for (const [nom, etape] of this.etapes(id)) {
        if (this.arretee) return;
        try {
          await this.db.withTenant({ tenantId: id }, async (tx) => {
            if (!(await prendreLaMain(tx, id, nom))) return;
            await parLeSysteme(tx, () => etape(tx));
          });
        } catch (e) {
          this.logger.error(`Organisation ${id}, ${nom} : ${(e as Error).message}`);
        }
      }
    }
  }

  /** Dans cet ordre : un dossier rangé n'a plus d'échéance ni de demande à suivre. */
  private etapes(tenantId: string): Array<[string, (tx: Tx) => Promise<unknown>]> {
    return [
      ['contrats', (tx) => inactiverLesContratsEchus(tx, tenantId)],
      ['échéances', (tx) => this.notifications.genererLesEcheances(tx, tenantId)],
      ['circuit', (tx) => reconcilierLeCircuit(tx, tenantId)],
      ['évaluation', (tx) => annoncerLOuverture(tx, tenantId)],
    ];
  }
}

/**
 * L'étape, pour cette organisation, à cette instance, sauf si une autre la
 * fait déjà. Le verrou tient jusqu'à la fin de la transaction.
 */
async function prendreLaMain(tx: Tx, tenantId: string, etape: string): Promise<boolean> {
  const { rows } = await tx.execute<{ pris: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${`veille:${tenantId}:${etape}`})) AS pris`,
  );
  return Boolean(rows[0]?.pris);
}
