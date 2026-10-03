import { open, type FileHandle } from 'node:fs/promises';

/* ————————————————————————————————————————————————————————————————
   La durée d'un fichier MP4, lue dans le fichier lui-même.

   Le navigateur de la RH la connaît déjà — c'est lui qui refuse une vidéo de
   treize minutes avant de l'envoyer. Mais ce qu'il dit, il peut le mentir, et
   c'est sur cette durée que se calcule le seuil des 90 % : le serveur la
   relit donc de son côté.

   Un MP4 est une suite de boîtes (« atoms ») : taille, type, contenu. La
   durée est dans `moov › mvhd`, en unités d'une échelle de temps propre au
   fichier. Un MP4 FRAGMENTÉ — celui qu'enregistre un navigateur — y met zéro
   et la range dans `moov › mvex › mehd`. On lit les deux, rien d'autre : le
   stockage local sert à développer, Cloudflare mesurera lui-même en
   production.
   ———————————————————————————————————————————————————————————————— */

/** Le `moov` d'une vidéo de douze minutes fait quelques centaines de Ko ; au-delà, on refuse. */
const MOOV_MAX = 64 * 1024 * 1024;

interface Boite {
  type: string;
  /** Début du CONTENU (après l'en-tête). */
  debut: number;
  /** Fin de la boîte, exclue. */
  fin: number;
}

/** Les boîtes d'un tampon, entre `debut` et `fin`. */
function boitesDe(buf: Buffer, debut = 0, fin = buf.length): Boite[] {
  const out: Boite[] = [];
  let o = debut;
  while (o + 8 <= fin) {
    let taille = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    let entete = 8;
    if (taille === 1) {
      if (o + 16 > fin) break;
      taille = Number(buf.readBigUInt64BE(o + 8));
      entete = 16;
    } else if (taille === 0) {
      taille = fin - o;
    }
    if (taille < entete || o + taille > fin) break;
    out.push({ type, debut: o + entete, fin: o + taille });
    o += taille;
  }
  return out;
}

/** Les boîtes de premier niveau d'un fichier, sans le lire en entier. */
async function boitesDuFichier(fh: FileHandle, tailleFichier: number): Promise<Boite[]> {
  const out: Boite[] = [];
  const entete = Buffer.alloc(16);
  let o = 0;
  while (o + 8 <= tailleFichier) {
    await fh.read(entete, 0, 16, o);
    let taille = entete.readUInt32BE(0);
    const type = entete.toString('latin1', 4, 8);
    let longueurEntete = 8;
    if (taille === 1) {
      taille = Number(entete.readBigUInt64BE(8));
      longueurEntete = 16;
    } else if (taille === 0) {
      taille = tailleFichier - o;
    }
    if (taille < longueurEntete) break;
    out.push({ type, debut: o + longueurEntete, fin: Math.min(o + taille, tailleFichier) });
    o += taille;
  }
  return out;
}

/** Les premiers octets sont-ils ceux d'un MP4 (ou d'un MOV) ? */
export function ressembleAUnMp4(debut: Buffer): boolean {
  return debut.length >= 8 && debut.toString('latin1', 4, 8) === 'ftyp';
}

/** La durée, en secondes, du `moov` fourni — ou `null` si elle n'y est pas. */
export function dureeDuMoov(moov: Buffer): number | null {
  const enfants = boitesDe(moov);
  const mvhd = enfants.find((b) => b.type === 'mvhd');
  if (!mvhd) return null;
  const version = moov.readUInt8(mvhd.debut);
  const echelle =
    version === 1 ? moov.readUInt32BE(mvhd.debut + 20) : moov.readUInt32BE(mvhd.debut + 12);
  let duree =
    version === 1
      ? Number(moov.readBigUInt64BE(mvhd.debut + 24))
      : moov.readUInt32BE(mvhd.debut + 16);
  if (echelle === 0) return null;

  // MP4 fragmenté : `mvhd` dit zéro (ou « inconnue »), `mehd` dit vrai.
  if (duree === 0 || duree === 0xffffffff) {
    const mvex = enfants.find((b) => b.type === 'mvex');
    const mehd = mvex ? boitesDe(moov, mvex.debut, mvex.fin).find((b) => b.type === 'mehd') : null;
    if (!mehd) return null;
    const v = moov.readUInt8(mehd.debut);
    duree =
      v === 1 ? Number(moov.readBigUInt64BE(mehd.debut + 4)) : moov.readUInt32BE(mehd.debut + 4);
    if (duree === 0) return null;
  }
  return duree / echelle;
}

/**
 * La durée d'un fichier MP4, en secondes.
 *
 * @returns `null` si le fichier n'est pas un MP4, ou si sa durée est illisible.
 */
export async function dureeMp4(chemin: string): Promise<number | null> {
  const fh = await open(chemin, 'r');
  try {
    const { size } = await fh.stat();
    const debut = Buffer.alloc(12);
    await fh.read(debut, 0, 12, 0);
    if (!ressembleAUnMp4(debut)) return null;
    const moov = (await boitesDuFichier(fh, size)).find((b) => b.type === 'moov');
    if (!moov || moov.fin - moov.debut > MOOV_MAX) return null;
    const contenu = Buffer.alloc(moov.fin - moov.debut);
    await fh.read(contenu, 0, contenu.length, moov.debut);
    return dureeDuMoov(contenu);
  } finally {
    await fh.close();
  }
}
