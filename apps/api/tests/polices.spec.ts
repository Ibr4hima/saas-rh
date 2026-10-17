/**
 * Les polices des documents (ADR-0090) : Arial, et Comic Sans MS pour ce que
 * les modèles de l'APIX écrivent avec elle. Leur licence interdisant de les
 * versionner, Arimo et Comic Relief tiennent leur place, aux mêmes chasses.
 * Google Sans reste celle du certificat d'APIX Academy.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import {
  pdfDeLAttestation,
  textesDeLAttestation,
} from '../src/modules/documents/attestation.service';
import { enregistrerPolices, police } from '../src/modules/documents/entete';

describe('Arial', () => {
  it('est la police par défaut, dans ses quatre coupes', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal')).toBe('arial-normal');
    expect(police(doc, 'bold')).toBe('arial-bold');
    expect(police(doc, 'italic')).toBe('arial-italic');
    expect(police(doc, 'bold-italic')).toBe('arial-bold-italic');
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
    // Arimo dans le dépôt ; Arial là où l'exploitant l'a déposée.
    expect([...polices].filter((p) => !/^(Arimo|Arial|ComicRelief|ComicSansMS)/.test(p))).toEqual(
      [],
    );
    expect([...polices].some((p) => /^(Arimo|Arial)-Bold/.test(p))).toBe(true);
    expect([...polices].some((p) => /^Comic(Relief|SansMS)-Bold/.test(p))).toBe(true);
  });
});

describe('Google Sans', () => {
  it('reste la police du certificat d’APIX Academy', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal', 'google-sans')).toBe('google-sans-normal');
    expect(police(doc, 'bold', 'google-sans')).toBe('google-sans-bold');
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

  it('sans fichiers, Helvetica', () => {
    expect(police(new PDFDocument(), 'bold')).toBe('Helvetica-Bold');
  });
});
