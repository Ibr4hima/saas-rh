/**
 * Ce que les tests lisent d'un PDF produit par pdfkit : ses polices et le
 * corps de son texte.
 */
import { inflateSync } from 'node:zlib';

/** Les polices qu'un PDF embarque, sans le préfixe de leur sous-ensemble : « Raleway-Bold ». */
export const policesDe = (pdf: Buffer): Set<string> =>
  new Set(
    (pdf.toString('latin1').match(/\/BaseFont \/[A-Z]{6}\+[\w-]+/g) ?? []).map((p) =>
      p.replace(/^.*\+/, ''),
    ),
  );

/**
 * Le corps le plus employé d'un PDF, celui de son texte courant : pdfkit
 * choisit le corps à chaque mot (`/F1 11 Tf`), dans des flux compressés.
 */
export function corpsDuTexte(pdf: Buffer): number {
  const tailles = new Map<number, number>();
  for (const [, flux] of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenu: string;
    try {
      contenu = inflateSync(Buffer.from(flux!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const [, taille] of contenu.matchAll(/\/F\d+ ([\d.]+) Tf/g)) {
      tailles.set(Number(taille), (tailles.get(Number(taille)) ?? 0) + 1);
    }
  }
  return [...tailles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
}
