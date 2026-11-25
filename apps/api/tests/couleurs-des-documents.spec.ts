/**
 * Les documents de la DCH s'impriment en noir (ADR-0203) : le texte, les
 * titres et leur filet, les pointillés du numéro, le pied de page. Seul le
 * drapeau du Sénégal garde ses couleurs ; le logo, une image, ne compte pas.
 */
import { describe, expect, it } from 'vitest';
import type { FicheCdd, FicheDisponibilite, FicheDomiciliation } from '@teranga/contracts';
import {
  pdfDeLAttestation,
  textesDeLAttestation,
} from '../src/modules/documents/attestation.service';
import {
  blocsDuContratDeTravail,
  pdfDuContratDeTravail,
} from '../src/modules/documents/contrat-travail';
import {
  pdfDeLaDecision,
  textesDeLaDecision,
} from '../src/modules/documents/decision-disponibilite';
import {
  pdfDeLaDomiciliation,
  textesDeLaDomiciliation,
} from '../src/modules/documents/domiciliation';
import { ENCRE } from '../src/modules/documents/entete';
import type { Personne } from '../src/modules/documents/redaction';
import { couleursDe } from './lecture-pdf';

/** Le vert, l'or et le rouge du drapeau. */
const DRAPEAU = ['#00853f', '#fdef42', '#e31b23'];
const DG: Personne = { nom: 'Moussa SARR', genre: 'male' };
const DCH: Personne = { nom: 'Awa DIOP', genre: 'female' };
const AUJOURDHUI = new Date('2026-11-14T10:00:00');

const disponibilite: FicheDisponibilite = {
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  demandeLe: '2025-08-29',
  effetLe: '2026-01-02',
  repriseLe: '2026-07-02',
  pvDirectionGeneraleLe: '2024-05-07',
  pvDirectionGeneraleAdjointeLe: '2024-12-13',
};

const domiciliation: FicheDomiciliation = {
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Diop',
  poste: 'Chargée d’études',
  debut: '2018-03-01',
  contrat: 'cdi',
  demandeLe: '2026-10-15',
  banque: 'cbao',
  destinataire: 'directeur_general',
  rib: 'SN0120100103612345678954',
  salaire: 650000,
};

const cdd: FicheCdd = {
  civilite: 'madame',
  prenom: 'Awa',
  nom: 'Ndiaye',
  naissanceLe: '2000-01-24',
  naissanceA: 'Dakar',
  cni: '2751200201234',
  cniDelivreeLe: '2024-01-17',
  cniDelivreeA: 'Dakar',
  nationalite: 'SN',
  adresse: 'Patte d’Oie Cité Impôt et Domaines - Dakar',
  poste: 'Contrôleur Interne',
  affectation: '00000000-0000-7000-8000-000000000000',
  debut: '2026-04-01',
  duree: 12,
  categorie: '7a',
  salaireDeBase: 350000,
  sursalaire: 136000,
  primeDeTransport: 26000,
  treiziemeMois: true,
};

const DOCUMENTS: [string, () => Promise<Buffer>][] = [
  [
    'l’attestation de travail',
    () =>
      pdfDeLAttestation(
        textesDeLAttestation(
          {
            agent: { nom: 'Moussa SARR', genre: 'male' },
            employeeNumber: 'EMP-002',
            depuis: '2023-06-01',
            poste: 'Analyste',
            contrat: 'cdi',
            signataire: null,
          },
          AUJOURDHUI,
        ),
        { logo: null },
      ),
  ],
  [
    'la décision de mise en disponibilité',
    () =>
      pdfDeLaDecision(
        textesDeLaDecision(
          {
            doc: 'decision_disponibilite',
            fiche: disponibilite,
            directionGenerale: DG,
            dch: DCH,
          },
          AUJOURDHUI,
        ),
        { logo: null },
      ),
  ],
  [
    'la domiciliation bancaire',
    () =>
      pdfDeLaDomiciliation(
        textesDeLaDomiciliation({ fiche: domiciliation, dch: DCH }, AUJOURDHUI),
        {
          logo: null,
        },
      ),
  ],
  [
    'le contrat à durée déterminée, sur quatre pages',
    () =>
      pdfDuContratDeTravail(
        blocsDuContratDeTravail(
          {
            doc: 'contrat_cdd',
            fiche: cdd,
            unite: { nom: 'Audit Interne', type: 'department' },
            signataire: DG,
          },
          AUJOURDHUI,
        ),
        { logo: null },
      ),
  ],
];

describe('les documents de la DCH', () => {
  it.each(DOCUMENTS)('%s s’imprime en noir, le drapeau seul en couleurs', async (_, pdf) => {
    const couleurs = couleursDe(await pdf());
    expect(couleurs).toContain(ENCRE);
    expect([...couleurs].filter((c) => c !== ENCRE && !DRAPEAU.includes(c))).toEqual([]);
  });
});
