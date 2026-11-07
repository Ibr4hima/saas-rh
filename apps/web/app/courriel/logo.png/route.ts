import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/* ────────────────────────────────────────────────────────────────
   Le logo des courriels : celui que le site affiche, dans ses encres, comme
   sur l'écran de connexion en thème clair. Les courriels le chargent d'ici :
   rien ne voyage en pièce jointe.

   En PNG, deux fois plus fin que sa taille d'affichage : les messageries ne
   lisent pas le SVG. Sans fichier de logo, 404 : le courriel porte alors le
   nom de l'organisation.

   Le logo se pose sur un fond blanc aux coins arrondis, avec sa zone de
   protection tout autour (ADR-0186). Sur la carte blanche du courriel, ce
   fond ne se voit pas ; dans une messagerie qui assombrit le courriel, il
   garde le logo lisible, au lieu de laisser le bleu de « APIX » sur du noir.
   ──────────────────────────────────────────────────────────────── */

export const runtime = 'nodejs';

/** La hauteur du logo en tête du courriel, et sa largeur au plus. */
const HAUTEUR = 48;
const LARGEUR_MAX = 200;
/** Le fond blanc : la marge autour du logo et l'arrondi de ses coins, en pixels CSS. */
const MARGE = 8;
const RAYON = 8;

let prepare: Promise<Buffer | null> | null = null;

async function logoDuCourriel(): Promise<Buffer | null> {
  for (const nom of ['logo-apix.svg', 'logo-apix.png']) {
    let source: Buffer;
    try {
      source = await readFile(join(process.cwd(), 'public', nom));
    } catch {
      continue;
    }
    const logo = await sharp(source, { density: 288 })
      .resize({ height: HAUTEUR * 2, width: LARGEUR_MAX * 2, fit: 'inside' })
      .png()
      .toBuffer();
    const { width = 0, height = 0 } = await sharp(logo).metadata();
    const largeur = width + MARGE * 4;
    const hauteur = height + MARGE * 4;
    const fond = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><rect width="${largeur}" height="${hauteur}" rx="${RAYON * 2}" fill="#ffffff"/></svg>`;
    return sharp(Buffer.from(fond))
      .composite([{ input: logo, top: MARGE * 2, left: MARGE * 2 }])
      .png()
      .toBuffer();
  }
  return null;
}

export async function GET(): Promise<Response> {
  prepare ??= logoDuCourriel().catch(() => null);
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
