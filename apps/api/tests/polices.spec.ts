/**
 * Les polices des documents. Ceux de la DCH suivent la charte de l'APIX de
 * 2026 (ADR-0173) : Raleway pour le texte, Anton pour les titres, Exo pour le
 * pied de page, toutes libres et versionnées. Arial (ADR-0090) et Times New
 * Roman (ADR-0098) restent celles de la déclaration de mouvement et des
 * grilles d'évaluation : leur licence interdisant de les versionner, Arimo et
 * Tinos tiennent leur place, aux mêmes chasses. Le certificat d'APIX Academy
 * suit lui aussi la charte (ADR-0185).
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import {
  pdfDeLAttestation,
  textesDeLAttestation,
} from '../src/modules/documents/attestation.service';
import { enregistrerPolices, police } from '../src/modules/documents/entete';
import { policesDe } from './lecture-pdf';

describe('Raleway', () => {
  it('est la police par défaut, dans ses quatre coupes et les graisses du bloc de la République', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal')).toBe('raleway-normal');
    expect(police(doc, 'bold')).toBe('raleway-bold');
    expect(police(doc, 'italic')).toBe('raleway-italic');
    expect(police(doc, 'bold-italic')).toBe('raleway-bold-italic');
    expect(police(doc, 'normal', 'raleway-light')).toBe('raleway-light-normal');
    expect(police(doc, 'normal', 'raleway-medium')).toBe('raleway-medium-normal');
    expect(police(doc, 'normal', 'raleway-semibold')).toBe('raleway-semibold-normal');
  });

  it('écrit l’attestation de travail ; Anton, son titre ; Exo, son pied de page', async () => {
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
    const polices = [...policesDe(pdf)];
    expect(polices.filter((p) => !/^(Raleway|Anton|Exo)/.test(p))).toEqual([]);
    for (const attendue of ['Raleway-Regular', 'Raleway-Bold', 'Anton-Regular', 'Exo-Regular']) {
      expect(polices).toContain(attendue);
    }
  });
});

describe('Times New Roman', () => {
  it('a ses quatre coupes, celles de la déclaration de mouvement et des grilles', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal', 'times')).toBe('times-normal');
    expect(police(doc, 'bold', 'times')).toBe('times-bold');
    expect(police(doc, 'italic', 'times')).toBe('times-italic');
    expect(police(doc, 'bold-italic', 'times')).toBe('times-bold-italic');
  });
});

describe('Arial', () => {
  it('a ses quatre coupes, celles des grilles d’évaluation', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    expect(police(doc, 'normal', 'arial')).toBe('arial-normal');
    expect(police(doc, 'bold', 'arial')).toBe('arial-bold');
    expect(police(doc, 'italic', 'arial')).toBe('arial-italic');
    expect(police(doc, 'bold-italic', 'arial')).toBe('arial-bold-italic');
  });
});

describe('à défaut', () => {
  it('une coupe absente cède la place à sa voisine de la même famille', () => {
    const doc = new PDFDocument();
    enregistrerPolices(doc);
    // Anton n'a que son romain.
    expect(police(doc, 'italic', 'anton')).toBe('anton-normal');
  });

  it('sans fichiers, Helvetica', () => {
    expect(police(new PDFDocument(), 'bold')).toBe('Helvetica-Bold');
  });
});
