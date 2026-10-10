/* ────────────────────────────────────────────────────────────────
   Le logo des courriels.

   Le site le sert, en blanc (apps/web/app/courriel/logo.png) : celui de
   l'écran de connexion. Le courriel le charge de là, rien ne voyage en pièce
   jointe. L'expéditeur s'assure qu'il existe et lit ses dimensions (Outlook
   les veut écrites dans la balise) ; sans lui, le courriel porte le nom de
   l'organisation.
   ──────────────────────────────────────────────────────────────── */

export interface LogoCourriel {
  src: string;
  /** Les dimensions affichées, en pixels CSS : l'image est deux fois plus fine. */
  largeur: number;
  hauteur: number;
}

export const CHEMIN_DU_LOGO = '/courriel/logo.png';

export async function sonderLogo(
  portail: string,
  appeler: typeof fetch = fetch,
): Promise<LogoCourriel | null> {
  const src = `${portail.replace(/\/$/, '')}${CHEMIN_DU_LOGO}`;
  try {
    const r = await appeler(src, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const png = Buffer.from(await r.arrayBuffer());
    // La signature PNG, puis le bloc IHDR : largeur et hauteur, en pixels.
    if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') return null;
    return {
      src,
      largeur: Math.round(png.readUInt32BE(16) / 2),
      hauteur: Math.round(png.readUInt32BE(20) / 2),
    };
  } catch {
    return null;
  }
}
