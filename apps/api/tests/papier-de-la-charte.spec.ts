/**
 * Le papier à en-tête de la charte de l'APIX (ADR-0173) : à droite, le logo
 * se centre sur le bloc de la République, du haut du drapeau à la ligne de
 * base de sa dernière ligne, et son bord droit tombe sur la marge du texte.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, describe, expect, it } from 'vitest';
import { dessinerEnTete, enregistrerPolices } from '../src/modules/documents/entete';

/** Deux logos d'essai, d'un bleu uni : à la proportion de celui de l'APIX, et trois fois plus large que haut. */
const LOGOS = {
  courant:
    'iVBORw0KGgoAAAANSUhEUgAAACMAAAAXCAYAAACBMvbiAAAAKklEQVR42u3OMQ0AAAgDsDlEG4ohQQVHj/5NqucNGRkZGRkZGRkZGRmZs5Gh4oct+Vy7AAAAAElFTkSuQmCC',
  large:
    'iVBORw0KGgoAAAANSUhEUgAAADwAAAAUCAYAAADRA14pAAAAL0lEQVR42u3PMREAAAgEoG9oNhNrDk8GApBUzyvCwsLCwsLCwsLCwsLCwsLCwtct0J7FyaHMPKYAAAAASUVORK5CYII=',
};

/** Le haut du drapeau et la ligne de base de la dernière ligne du bloc. */
const HAUT_DU_BLOC = 29.4;
const BAS_DU_BLOC = 128.12;
/** La marge droite du texte, celle du papier. */
const MARGE_DROITE = 544.5;

const dossier = mkdtempSync(join(tmpdir(), 'papier-'));
afterAll(() => rmSync(dossier, { recursive: true, force: true }));

/** Où l'en-tête pose le logo : pdfkit l'écrit « l 0 0 -h x y+h cm », puis « /I1 Do ». */
async function placeDuLogo(png: string) {
  const chemin = join(dossier, `${png.length}.png`);
  writeFileSync(chemin, Buffer.from(png, 'base64'));
  const doc = new PDFDocument({ size: 'A4', compress: false, margin: 0 });
  enregistrerPolices(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (m: Buffer) => morceaux.push(m));
  const fini = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(morceaux))),
  );
  dessinerEnTete(doc, { logo: chemin });
  doc.end();
  const brut = (await fini).toString('latin1');
  const [, l, h, x, bas] = /([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\n\/I1 Do/
    .exec(brut)!
    .map(Number);
  return { gauche: x!, haut: bas! - h!, largeur: l!, hauteur: h! };
}

describe('le logo du papier à en-tête', () => {
  it.each(Object.entries(LOGOS))(
    'logo %s : son milieu à la hauteur du milieu du bloc de la République, son bord sur la marge',
    async (_nom, png) => {
      const { gauche, haut, largeur, hauteur } = await placeDuLogo(png);
      expect(haut + hauteur / 2).toBeCloseTo((HAUT_DU_BLOC + BAS_DU_BLOC) / 2, 2);
      expect(gauche + largeur).toBeCloseTo(MARGE_DROITE, 2);
    },
  );

  it('garde sa hauteur de la charte, sauf s’il est si large qu’elle le ferait déborder', async () => {
    expect((await placeDuLogo(LOGOS.courant)).hauteur).toBeCloseTo(61.2, 2);
    const large = await placeDuLogo(LOGOS.large);
    expect(large.largeur).toBeCloseTo(150, 2);
    expect(large.hauteur).toBeCloseTo(50, 2);
  });
});
