/**
 * Les polices des documents (ADR-0086) : Google Sans, comme apix-e-voting,
 * et Comic Sans MS pour ce que les modèles de l'APIX écrivent avec elle. Sa
 * licence interdisant de la versionner, Comic Relief tient sa place.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import {
  pdfDeLAttestation,
  textesDeLAttestation,
} from '../src/modules/documents/attestation.service';
import { enregistrerPolices, police } from '../src/modules/documents/entete';

describe('Google Sans', () => {
  it('est la police par défaut, en romain, gras et italique', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal')).toBe('google-sans-normal');
    expect(police(doc, 'bold')).toBe('google-sans-bold');
    expect(police(doc, 'italic')).toBe('google-sans-italic');
  });

  it('écrit l’attestation de travail, en-tête et pied de page compris ; Comic Sans MS, son timbre', async () => {
    const pdf = await pdfDeLAttestation(
      textesDeLAttestation(
        {
          agent: { nom: 'Moussa NDIAYE', genre: 'male' },
          employeeNumber: 'EMP-002',
          depuis: '2023-06-01',
          poste: 'Analyste',
          contrat: 'cdi',
          signataire: null,
        },
        new Date(),
      ),
      { logo: null },
    );
    const polices = new Set(
      (pdf.toString('latin1').match(/\/BaseFont \/[A-Z]{6}\+[\w-]+/g) ?? []).map((p) =>
        p.replace(/^.*\+/, ''),
      ),
    );
    expect([...polices].filter((p) => !/^(GoogleSans|ComicRelief|ComicSansMS)/.test(p))).toEqual(
      [],
    );
    expect([...polices].some((p) => p.startsWith('GoogleSans-Bold'))).toBe(true);
    expect([...polices].some((p) => /^Comic(Relief|SansMS)-Bold/.test(p))).toBe(true);
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
    expect(police(doc, 'bold-italic')).toBe('google-sans-bold');
  });

  it('sans fichiers, Helvetica', () => {
    expect(police(new PDFDocument(), 'bold')).toBe('Helvetica-Bold');
  });
});
