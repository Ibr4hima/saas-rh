import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

/* ────────────────────────────────────────────────────────────────
   Le logo des courriels.

   Celui de l'organisation, en blanc, comme sur l'écran de connexion : ses
   encres d'origine, foncées, disparaîtraient sur le bleu. Il n'est pas dans
   le dépôt (il appartient à l'organisation) : on le prend là où le site le
   sert, ou là où `MAIL_LOGO` le désigne. Il voyage DANS le courriel, en pièce
   jointe affichée : Outlook le montre sans demander de télécharger les images.

   Sans fichier, ou sans transparence (un PNG à fond blanc deviendrait un
   rectangle blanc), le courriel porte le nom de l'organisation à la place.
   ──────────────────────────────────────────────────────────────── */

export interface LogoCourriel {
  cid: string;
  png: Buffer;
  /** Les dimensions affichées, en pixels CSS : l'image est deux fois plus fine. */
  largeur: number;
  hauteur: number;
}

/** La hauteur du logo sur l'écran de connexion. */
const HAUTEUR = 44;
const LARGEUR_MAX = 190;

/** Les fichiers essayés, dans l'ordre : le SVG d'abord, net et transparent. */
export function fichiersDuLogo(designe?: string): string[] {
  if (designe) return [resolve(designe)];
  const publics = [
    resolve(process.cwd(), '../web/public'),
    resolve(process.cwd(), 'apps/web/public'),
    resolve(__dirname, '../../../../web/public'),
  ];
  return publics.flatMap((d) => [resolve(d, 'logo-apix.svg'), resolve(d, 'logo-apix.png')]);
}

/** Le logo blanc, prêt à joindre ; `null` : le nom de l'organisation le remplace. */
export async function preparerLogo(fichiers: string[]): Promise<LogoCourriel | null> {
  const fichier = fichiers.find((f) => existsSync(f));
  if (!fichier) return null;
  try {
    const { data, info } = await sharp(fichier, { density: 288 })
      .resize({ height: HAUTEUR * 2, width: LARGEUR_MAX * 2, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparent = false;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 255;
      if (data[i + 3]! < 250) transparent = true;
    }
    if (!transparent) return null;
    const png = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return {
      cid: 'logo-organisation',
      png,
      largeur: Math.round(info.width / 2),
      hauteur: Math.round(info.height / 2),
    };
  } catch {
    return null;
  }
}
