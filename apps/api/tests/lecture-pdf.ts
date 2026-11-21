/**
 * Ce que les tests lisent d'un PDF produit par pdfkit : ses polices, le corps
 * de son texte et ses couleurs.
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
  for (const contenu of fluxDe(pdf)) {
    for (const [, taille] of contenu.matchAll(/\/F\d+ ([\d.]+) Tf/g)) {
      tailles.set(Number(taille), (tailles.get(Number(taille)) ?? 0) + 1);
    }
  }
  return [...tailles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
}

/**
 * Les couleurs qu'un PDF emploie pour remplir et pour tracer, en hexadécimal
 * (« #111111 ») : pdfkit les écrit en RVB de 0 à 1 (`0 0.31 0.57 scn`).
 */
export function couleursDe(pdf: Buffer): Set<string> {
  const couleurs = new Set<string>();
  const hex = (v: string) =>
    Math.round(Number(v) * 255)
      .toString(16)
      .padStart(2, '0');
  for (const contenu of fluxDe(pdf)) {
    for (const [, r, v, b] of contenu.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:scn|SCN|rg|RG)\b/g)) {
      couleurs.add(`#${hex(r!)}${hex(v!)}${hex(b!)}`);
    }
  }
  return couleurs;
}

/** Les flux de contenu d'un PDF, décompressés : pdfkit les compresse. */
function fluxDe(pdf: Buffer): string[] {
  const flux: string[] = [];
  for (const [, brut] of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      flux.push(inflateSync(Buffer.from(brut!, 'latin1')).toString('latin1'));
    } catch {
      // Un flux qui n'est pas compressé, une image : rien à lire.
    }
  }
  return flux;
}
