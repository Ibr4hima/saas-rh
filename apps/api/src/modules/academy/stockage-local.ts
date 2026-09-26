import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import type { VideoUploadTarget } from '@teranga/contracts';
import { MAX_VIDEO_LOCALE_BYTES } from '@teranga/contracts';
import { loadEnv } from '../../config/env';

/* ————————————————————————————————————————————————————————————————
   Le stockage vidéo LOCAL : le disque du serveur de l'application.

   Il existe pour une raison : développer et démontrer APIX Academy avant que
   le compte Cloudflare Stream soit ouvert. Il n'est PAS l'architecture cible.
   Ici, les octets passent par l'API — à l'envoi comme à la lecture — et un
   seul fichier MP4 est servi tel quel, sans qualité adaptée à la connexion.
   Pour une démonstration, c'est très bien ; pour trois cents agents, c'est
   précisément ce qu'on a décidé d'éviter.

   Il imite pourtant le fournisseur cible là où cela compte : la lecture passe
   par une URL SIGNÉE et DATÉE, que l'écran reçoit au démarrage de la leçon et
   qui ne vaut rien une fois expirée. Le jour où Cloudflare le remplace, le
   reste du module ne change pas de forme.

   Les fichiers ne sont JAMAIS en base : un répertoire par organisation, un
   fichier par vidéo, nommé par son identifiant — jamais par ce que la RH a
   tapé, qui n'a pas sa place dans un chemin.
   ———————————————————————————————————————————————————————————————— */

/** Une URL de lecture vaut quatre heures : une leçon, ses pauses, et de la marge. */
const VALIDITE_LECTURE_S = 4 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class VideoTropLourde extends Error {}

@Injectable()
export class StockageVideoLocal {
  readonly nom = 'local' as const;
  readonly racine: string;
  private readonly cle: Buffer;

  constructor(racine?: string) {
    const env = loadEnv();
    this.racine =
      racine ?? env.ACADEMY_MEDIA_DIR ?? resolve(__dirname, '../../../var/academy-media');
    // Une clé À PART de celle qui chiffre les données : dérivée d'elle, mais
    // pour cet usage seulement — une URL signée qui fuit ne dit rien de
    // l'autre.
    this.cle = createHmac('sha256', env.DATA_ENCRYPTION_KEY).update('academy-media').digest();
  }

  private repertoire(tenantId: string): string {
    if (!UUID.test(tenantId)) throw new Error('Organisation invalide');
    return resolve(this.racine, tenantId);
  }

  chemin(tenantId: string, uid: string): string {
    if (!UUID.test(uid)) throw new Error('Vidéo invalide');
    return resolve(this.repertoire(tenantId), `${uid}.mp4`);
  }

  /** Un identifiant neuf, et l'adresse où l'écran enverra le fichier. */
  preparerEnvoi(lessonId: string): { uid: string; cible: VideoUploadTarget } {
    return {
      uid: randomUUID(),
      cible: {
        mode: 'local',
        // Relative à l'API : c'est elle qui reçoit.
        url: `/academy/lessons/${lessonId}/video/fichier`,
        method: 'PUT',
      },
    };
  }

  /**
   * Reçoit le fichier EN FLUX, jusqu'au disque : il n'est jamais entier en
   * mémoire. Un fichier plus lourd que permis est coupé au premier octet de
   * trop, pas après l'avoir reçu en entier.
   *
   * @returns Le chemin d'un fichier TEMPORAIRE : l'appelant le vérifie, puis
   *   l'installe ou le jette.
   */
  async recevoir(tenantId: string, uid: string, flux: Readable): Promise<string> {
    await mkdir(this.repertoire(tenantId), { recursive: true });
    const temporaire = `${this.chemin(tenantId, uid)}.part`;
    let recu = 0;
    const compteur = new Transform({
      transform(morceau: Buffer, _enc, suite) {
        recu += morceau.length;
        if (recu > MAX_VIDEO_LOCALE_BYTES) {
          suite(new VideoTropLourde('Fichier trop lourd'));
          return;
        }
        suite(null, morceau);
      },
    });
    try {
      await pipeline(flux, compteur, createWriteStream(temporaire));
    } catch (err) {
      await rm(temporaire, { force: true });
      throw err;
    }
    return temporaire;
  }

  async installer(temporaire: string, tenantId: string, uid: string): Promise<void> {
    await rename(temporaire, this.chemin(tenantId, uid));
  }

  async supprimer(tenantId: string, uid: string): Promise<void> {
    await rm(this.chemin(tenantId, uid), { force: true });
    await rm(`${this.chemin(tenantId, uid)}.part`, { force: true });
  }

  async taille(tenantId: string, uid: string): Promise<number | null> {
    try {
      return (await stat(this.chemin(tenantId, uid))).size;
    } catch {
      return null;
    }
  }

  private signature(tenantId: string, uid: string, exp: number): string {
    return createHmac('sha256', this.cle).update(`${tenantId}.${uid}.${exp}`).digest('base64url');
  }

  /** L'adresse de lecture, signée et datée — relative à l'API. */
  source(tenantId: string, uid: string, maintenant = Date.now()): { type: 'mp4'; url: string } {
    const exp = Math.floor(maintenant / 1000) + VALIDITE_LECTURE_S;
    const sig = this.signature(tenantId, uid, exp);
    return { type: 'mp4', url: `/academy/media/${tenantId}/${uid}?exp=${exp}&sig=${sig}` };
  }

  /** La signature tient-elle, et l'adresse est-elle encore valable ? */
  verifier(tenantId: string, uid: string, exp: string, sig: string, maintenant = Date.now()) {
    if (!UUID.test(tenantId) || !UUID.test(uid) || !/^\d{1,12}$/.test(exp)) return false;
    if (Number(exp) < Math.floor(maintenant / 1000)) return false;
    const attendue = Buffer.from(this.signature(tenantId, uid, Number(exp)));
    const recue = Buffer.from(sig);
    return attendue.length === recue.length && timingSafeEqual(attendue, recue);
  }
}
