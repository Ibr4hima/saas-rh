/**
 * Les polices des documents : Arial pour ceux de la DCH, Comic Sans MS pour
 * certains de ses modèles (ADR-0085). Leurs équivalents libres, versionnés à
 * leur place, doivent en avoir les chasses : sans elles, une ligne ne se
 * couperait plus au même mot que sur le modèle de l'APIX.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { pdfDeLAttestation } from '../src/modules/documents/attestation.service';
import { enregistrerPolices, police, type Coupe } from '../src/modules/documents/entete';

const PHRASE =
  'L’Agence pour la Promotion des Investissements et des Grands Travaux (APIX S.A), ' +
  'Dakar : décision n° 2026-014 du 1er février 2026, Économie et Thiès, ' +
  '« 250 000 FCFA ».';

/** La largeur de la phrase, caractère par caractère : les chasses seules, sans crénage. */
function chasse(doc: InstanceType<typeof PDFDocument>, fonte: string): number {
  return [...PHRASE].reduce((s, c) => s + doc.font(fonte).fontSize(11).widthOfString(c), 0);
}

const HELVETICA: Record<Coupe, string> = {
  normal: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  'bold-italic': 'Helvetica-BoldOblique',
};

describe('Arial', () => {
  it('a ses quatre coupes', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    for (const coupe of Object.keys(HELVETICA) as Coupe[]) {
      expect(police(doc, coupe, 'arial')).toBe(`arial-${coupe}`);
    }
  });

  it('a les chasses d’Arial, qui sont celles d’Helvetica', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    for (const [coupe, helvetica] of Object.entries(HELVETICA) as [Coupe, string][]) {
      expect(chasse(doc, police(doc, coupe, 'arial'))).toBeCloseTo(chasse(doc, helvetica), 0);
    }
  });

  it('est la seule police de l’attestation de travail, en-tête compris', async () => {
    const pdf = await pdfDeLAttestation({
      titre: 'ATTESTATION DE TRAVAIL',
      paragraphes: ['L’Agence atteste.'],
      lieuEtDate: 'Fait à Dakar, le 17 octobre 2026',
      signature: ['Pour APIX S.A,', 'La Direction du Capital Humain'],
    });
    const polices = pdf.toString('latin1').match(/\/BaseFont \/[A-Z]{6}\+[\w-]+/g) ?? [];
    expect(polices.length).toBeGreaterThan(0);
    for (const p of polices) expect(p).toMatch(/\+(Arimo|Arial)/);
  });
});

describe('Comic Sans MS', () => {
  it('a son romain et son gras ; une italique absente reste dans la famille', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal', 'comic')).toBe('comic-normal');
    expect(police(doc, 'bold', 'comic')).toBe('comic-bold');
    expect(police(doc, 'italic', 'comic')).toMatch(/^comic-/);
  });
});

describe('à défaut', () => {
  it('une coupe absente cède la place à sa voisine de la même famille', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    // Google Sans n'a pas de gras italique dans le dépôt.
    expect(police(doc, 'bold-italic', 'google-sans')).toBe('google-sans-bold');
  });

  it('sans fichiers, Helvetica, qui a les chasses d’Arial', () => {
    expect(police(new PDFDocument(), 'bold', 'arial')).toBe('Helvetica-Bold');
  });
});
