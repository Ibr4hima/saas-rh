/**
 * Le certificat d'APIX Academy, à la charte de l'APIX (ADR-0185) : les
 * polices de la charte, une seule page quel que soit le cas, et le score
 * dans l'anneau du sceau, « 100 % » compris.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import {
  genererCertificatPdf,
  poseDuScore,
  type DonneesCertificat,
} from '../src/modules/academy/certificat-pdf';
import { enregistrerPolices } from '../src/modules/documents/entete';
import { policesDe } from './lecture-pdf';

const BASE: DonneesCertificat = {
  numero: 'APX-109J-MVBF',
  titulaire: 'Hawa Ba',
  matricule: 'A12345678',
  formation: 'Macroéconomie',
  organisation: 'APIX-SA',
  score: 0.8,
  emisLe: new Date('2026-09-25T10:00:00Z'),
  expireLe: null,
  urlVerification: 'https://rh.apix.sn/verifier/APX-109J-MVBF',
};

const pages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('le certificat d’APIX Academy', () => {
  it('suit la charte : Anton pour le titre, Raleway pour le texte, Exo pour les mentions', async () => {
    const pdf = await genererCertificatPdf(BASE, { logo: null });
    expect([...policesDe(pdf)].sort()).toEqual([
      'Anton-Regular',
      'Exo-Regular',
      'Raleway-Bold',
      'Raleway-Italic',
      'Raleway-Regular',
      'Raleway-SemiBold',
    ]);
  });

  it('tient sur une page : nom et intitulé longs, formation sans évaluation, spécimen', async () => {
    const cas: Partial<DonneesCertificat>[] = [
      {},
      {
        titulaire: 'Ndèye Fatou Kiné Diouf Sarr Ndiaye',
        formation:
          'Analyse financière des partenariats public-privé et montage des projets d’infrastructures dans la zone économique spéciale de Diamniadio',
        score: 0.796,
      },
      { score: null, expireLe: new Date('2028-09-25T10:00:00Z') },
      { titulaire: 'Prénom Nom', matricule: null, numero: 'APX-XXXX-XXXX', specimen: true },
    ];
    for (const plus of cas) {
      expect(pages(await genererCertificatPdf({ ...BASE, ...plus }, { logo: null }))).toBe(1);
    }
  });

  it('pose le score dans l’anneau intérieur du sceau, « 100 % » compris', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    for (const valeur of ['0', '7', '80', '99', '100']) {
      // L'anneau a 27,5 points de rayon : chaque coin des chiffres et du « % »
      // en reste à 4 points au moins.
      for (const [x, y] of poseDuScore(doc, valeur).coins) {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(23.5);
      }
    }
    // « 80 % » garde son corps ; « 100 % », plus large, se resserre.
    expect(poseDuScore(doc, '80').corps).toBe(25);
    expect(poseDuScore(doc, '100').corps).toBeLessThan(25);
  });
});
