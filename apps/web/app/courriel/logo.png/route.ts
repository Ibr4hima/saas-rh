import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/* ────────────────────────────────────────────────────────────────
   Le logo des courriels : celui que le site affiche, en blanc, comme sur
   l'écran de connexion (ses encres d'origine, foncées, disparaîtraient sur le
   bleu du dôme). Les courriels le chargent d'ici : rien ne voyage en pièce
   jointe.

   En PNG, deux fois plus fin que sa taille d'affichage : les messageries ne
   lisent pas le SVG. Sans fichier de logo, ou sans transparence (un PNG à
   fond blanc deviendrait un rectangle blanc), 404 : le courriel porte alors
   le nom de l'organisation.
   ──────────────────────────────────────────────────────────────── */

export const runtime = 'nodejs';

/** La hauteur du logo sur l'écran de connexion, et sa largeur au plus. */
const HAUTEUR = 44;
const LARGEUR_MAX = 190;

let prepare: Promise<Buffer | null> | null = null;

async function logoBlanc(): Promise<Buffer | null> {
  for (const nom of ['logo-apix.svg', 'logo-apix.png']) {
    let source: Buffer;
    try {
      source = await readFile(join(process.cwd(), 'public', nom));
    } catch {
      continue;
    }
    const { data, info } = await sharp(source, { density: 288 })
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
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
  }
  return null;
}

export async function GET(): Promise<Response> {
  prepare ??= logoBlanc().catch(() => null);
  const png = await prepare;
  if (!png) {
    // Un logo déposé plus tard sera pris à la demande suivante.
    prepare = null;
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
  });
}
