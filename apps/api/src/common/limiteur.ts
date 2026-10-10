import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { TenantDb } from '../db/tenant-db';

/**
 * L'anti-abus, partagé entre les instances : un compteur en base par
 * fenêtre de temps (migration 0078). La fenêtre glisse : le compte de la
 * fenêtre en cours, plus la part encore valable de la précédente.
 */
export interface Regle {
  /** Ce qu'on compte : 'candidature', 'connexion_ip'… */
  bucket: string;
  fenetreSecondes: number;
  max: number;
}

export interface Verdict {
  bloque: boolean;
  /** Secondes avant que la fenêtre ne laisse repasser. */
  reessayerDans: number;
}

/** Les candidatures d'une adresse sur une offre : dix par dix minutes. */
export const CANDIDATURES: Regle = { bucket: 'candidature', fenetreSecondes: 600, max: 10 };
/** Les connexions manquées d'une adresse : vingt par quart d'heure. */
export const ECHECS_PAR_ADRESSE: Regle = {
  bucket: 'connexion_ip',
  fenetreSecondes: 900,
  max: 20,
};
/** Les connexions manquées sur un compte : dix par quart d'heure, puis on attend. */
export const ECHECS_PAR_COMPTE: Regle = {
  bucket: 'connexion_compte',
  fenetreSecondes: 900,
  max: 10,
};

/** Les liens « mot de passe oublié » demandés d'une adresse : dix par heure. */
export const OUBLIS_PAR_ADRESSE: Regle = { bucket: 'oubli_ip', fenetreSecondes: 3600, max: 10 };
/** Les vérifications publiques de certificat d'une adresse : soixante par dix minutes. */
export const VERIFICATIONS_DE_CERTIFICAT: Regle = {
  bucket: 'certificat_ip',
  fenetreSecondes: 600,
  max: 60,
};
/** Les liens demandés pour une même adresse email : trois par heure. */
export const OUBLIS_PAR_COMPTE: Regle = { bucket: 'oubli_compte', fenetreSecondes: 3600, max: 3 };

/**
 * L'adresse du client, telle qu'Express la lit derrière les proxys de
 * confiance (TRUST_PROXY). Une IPv6 compte pour son /64 : un abonné en a
 * des milliards.
 */
export function adresseDuClient(req: Pick<Request, 'ip'>): string {
  const brute = (req.ip ?? '').replace(/^::ffff:/, '');
  if (isIP(brute) !== 6) return brute || 'inconnue';
  const groupes = brute.split('::')[0]!.split(':');
  return `${groupes.slice(0, 4).join(':')}::/64`;
}

/** Ce qui identifie un compte, sans le garder en clair. */
export const empreinte = (valeur: string) =>
  createHash('sha256').update(valeur.trim().toLowerCase()).digest('hex');

@Injectable()
export class Limiteur {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Compte une tentative, et dit si elle passe la limite. */
  async compter(regle: Regle, sujet: string): Promise<Verdict> {
    return this.lire(regle, sujet, true);
  }

  /** Dit si la limite est atteinte, sans rien compter. */
  async consulter(regle: Regle, sujet: string): Promise<Verdict> {
    return this.lire(regle, sujet, false);
  }

  private async lire(regle: Regle, sujet: string, compter: boolean): Promise<Verdict> {
    const fenetre = regle.fenetreSecondes;
    try {
      const debut = sql`date_bin(make_interval(secs => ${fenetre}::double precision), now(),
                                 TIMESTAMPTZ '2000-01-01Z')`;
      const { rows } = await this.db.global.execute<{
        hits: number;
        avant: number;
        ecoule: number;
      }>(
        compter
          ? sql`
            WITH cur AS (
              INSERT INTO rate_limit_counters AS c (bucket, subject, window_start, hits)
              VALUES (${regle.bucket}, ${sujet}, ${debut}, 1)
              ON CONFLICT (bucket, subject, window_start) DO UPDATE SET hits = c.hits + 1
              RETURNING hits, window_start)
            SELECT cur.hits, COALESCE(p.hits, 0) AS avant,
                   extract(epoch FROM now() - cur.window_start)::float AS ecoule
              FROM cur LEFT JOIN rate_limit_counters p
                ON p.bucket = ${regle.bucket} AND p.subject = ${sujet}
               AND p.window_start = cur.window_start - make_interval(secs => ${fenetre}::double precision)`
          : sql`
            SELECT COALESCE((SELECT hits FROM rate_limit_counters
                              WHERE bucket = ${regle.bucket} AND subject = ${sujet}
                                AND window_start = ${debut}), 0) AS hits,
                   COALESCE((SELECT hits FROM rate_limit_counters
                              WHERE bucket = ${regle.bucket} AND subject = ${sujet}
                                AND window_start = ${debut}
                                  - make_interval(secs => ${fenetre}::double precision)), 0) AS avant,
                   extract(epoch FROM now() - ${debut})::float AS ecoule`,
      );
      if (compter && Math.random() < 0.01) void this.purger();
      const r = rows[0]!;
      const ecoule = Number(r.ecoule);
      const estime = Number(r.hits) + Number(r.avant) * Math.max(0, 1 - ecoule / fenetre);
      // Compter : la tentative en cours est déjà dans le compte.
      const bloque = compter ? estime > regle.max : estime >= regle.max;
      return { bloque, reessayerDans: Math.max(1, Math.ceil(fenetre - ecoule)) };
    } catch (err) {
      // La base ne répond pas : on laisse passer plutôt que de fermer la porte.
      console.warn('Limiteur indisponible', (err as Error).name);
      return { bloque: false, reessayerDans: 0 };
    }
  }

  /** Un succès efface les échecs d'un compte. */
  async oublier(regle: Regle, sujet: string): Promise<void> {
    await this.db.global
      .execute(
        sql`DELETE FROM rate_limit_counters WHERE bucket = ${regle.bucket} AND subject = ${sujet}`,
      )
      .catch(() => undefined);
  }

  /** Les fenêtres passées ne servent plus : elles s'en vont, par lots. */
  private async purger(): Promise<void> {
    await this.db.global
      .execute(
        sql`DELETE FROM rate_limit_counters WHERE ctid IN (
              SELECT ctid FROM rate_limit_counters
               WHERE window_start < now() - interval '1 day' LIMIT 5000)`,
      )
      .catch(() => undefined);
  }
}
