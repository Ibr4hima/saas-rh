/**
 * La fiche d'entretien annuel d'évaluation, en PDF (ADR-0205).
 *
 * Ce qui compte : la version de l'agent ne porte jamais la partie réservée
 * à la hiérarchie ; le texte est celui de la grille corrigée ; le
 * management ne vaut que pour le personnel cadre ; tout est à l'encre
 * noire ; les textes au plus long tiennent, sur autant de pages qu'il faut.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it, vi } from 'vitest';
import { LONGUEURS_DE_LA_FICHE, MAXIMUMS_DE_LA_FICHE } from '@teranga/contracts';
import {
  ficheDEntretienPdf,
  typographie,
  type DonneesDeLaFiche,
} from '../src/modules/entretiens/fiche-pdf';
import { ficheExemple } from './fiche-exemple';
import { couleursDe, policesDe } from './lecture-pdf';

const DRAPEAU = ['#00853f', '#fdef42', '#e31b23'];

/** Le PDF, et tout ce que la fiche y a écrit, appel après appel de pdfkit. */
async function imprimer(d: DonneesDeLaFiche) {
  const espion = vi.spyOn(PDFDocument.prototype, 'text');
  try {
    const pdf = await ficheDEntretienPdf(d);
    const textes = espion.mock.calls.map((appel) => String(appel[0]));
    return { pdf, textes, tout: textes.join('\n') };
  } finally {
    espion.mockRestore();
  }
}

const pagesDe = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('la fiche en PDF', () => {
  it('la version de l’agent s’arrête à la validation ; la complète porte la partie réservée', async () => {
    const agent = await imprimer(ficheExemple({ reservee: null }));
    expect(agent.tout).toContain('VALIDATION ET SUIVI');
    expect(agent.tout).not.toContain('PARTIE STRICTEMENT RÉSERVÉE À LA HIÉRARCHIE');
    expect(agent.tout).not.toContain('Fort potentiel');
    expect(agent.tout).not.toContain('Avis conforme');

    const complete = await imprimer(ficheExemple());
    expect(complete.tout).toContain('PARTIE STRICTEMENT RÉSERVÉE À LA HIÉRARCHIE');
    expect(complete.tout).toContain('Fort potentiel. À accompagner');
    expect(complete.tout).toContain('Avis conforme à celui du N+1.');
    // La partie réservée commence sur sa propre page : elle se détache.
    expect(pagesDe(complete.pdf)).toBe(pagesDe(agent.pdf) + 1);
  });

  it('imprime le texte de la grille, corrigé', async () => {
    const { tout } = await imprimer(ficheExemple());
    for (const juste of [
      'FICHE D’ENTRETIEN ANNUEL D’ÉVALUATION',
      'ÉVALUATION DES COMPÉTENCES ET DES PERFORMANCES',
      'Compréhension du poste',
      'Connaît parfaitement le poste de travail.',
      'Réf. S1/EN05',
      'Les objectifs de l’année 2027',
    ]) {
      expect(tout).toContain(juste);
    }
    for (const faute of [
      'HIERACHIE',
      'Comprehension',
      'ÉVALUATION DES ET',
      'Connait ',
      'ponctuelle',
    ]) {
      expect(tout).not.toContain(faute);
    }
  });

  it('l’identification, les dates en lettres et le nom en capitales', async () => {
    const { tout } = await imprimer(ficheExemple());
    expect(tout).toContain('Moussa SARR');
    expect(tout).toContain('Matricule EMP-002');
    expect(tout).toContain('22 décembre 2026');
    expect(tout).toContain('Non');

    const arrive = await imprimer(
      ficheExemple({ agent: { ...ficheExemple().agent, posteDepuis: '2026-03-01' } }),
    );
    expect(arrive.tout).toContain('Oui, depuis le 1er mars 2026');
  });

  it('le management ne vaut que pour le personnel cadre ; sans niveau, « Sans objet »', async () => {
    const cadre = await imprimer(ficheExemple());
    expect(cadre.textes).toContain('Management');
    expect(cadre.textes).toContain('Sans objet');

    const note = await imprimer(
      ficheExemple({
        evaluation: {
          ...ficheExemple().evaluation,
          competences: { ...ficheExemple().evaluation.competences, management: 'B' },
        },
      }),
    );
    expect(note.textes).not.toContain('Sans objet');
    expect(note.tout).toContain('Son autorité est acceptée, se fait obéir.');

    const nonCadre = await imprimer(ficheExemple({ personnel: 'non_cadre' }));
    expect(nonCadre.textes).not.toContain('Management');
  });

  it('un champ vide s’imprime « Néant »', async () => {
    const { textes } = await imprimer(ficheExemple());
    // « Autres commentaires » est vide dans l'exemple.
    expect(textes).toContain('Néant');
  });

  it('à l’encre noire seulement, avec les polices de la DCH', async () => {
    const { pdf } = await imprimer(ficheExemple());
    const permises = new Set(['#111111', '#ffffff', ...DRAPEAU]);
    for (const c of couleursDe(pdf)) expect(permises).toContain(c);
    const polices = policesDe(pdf);
    expect(polices).toContain('Raleway-Regular');
    expect(polices).toContain('Raleway-Bold');
    expect(polices).toContain('Anton-Regular');
  });

  it('chaque page porte son numéro sur le total', async () => {
    const { pdf, textes } = await imprimer(ficheExemple());
    const n = pagesDe(pdf);
    for (let i = 1; i <= n; i++) expect(textes).toContain(`Page ${i} sur ${n}`);
  });

  it('les textes au plus long tiennent, sur autant de pages qu’il faut', async () => {
    const long = (n: number) =>
      'Une phrase assez longue pour remplir la ligne. '.repeat(60).slice(0, n);
    const base = ficheExemple();
    const objectifs = Array.from({ length: MAXIMUMS_DE_LA_FICHE.objectifs }, (_, i) => ({
      id: `0b7f1a52-3c3e-4a59-9f2f-1e0f7a3b5d${String(i).padStart(2, '0')}`,
      intitule: long(LONGUEURS_DE_LA_FICHE.intitule),
      indicateurs: long(LONGUEURS_DE_LA_FICHE.indicateurs),
    }));
    const texte = long(LONGUEURS_DE_LA_FICHE.texte);
    const d = ficheExemple({
      objectifs,
      auto: {
        ...base.auto,
        vecu: texte,
        difficultes: texte,
        autresRealisations: texte,
        avenir: texte,
        missions: texte,
        contraintes: texte,
        competencesInexploitees: texte,
        autresCommentaires: texte,
        objectifs: Object.fromEntries(
          objectifs.map((o) => [
            o.id,
            { niveau: 'B' as const, resultats: texte, commentaire: texte },
          ]),
        ),
      },
      evaluation: {
        ...base.evaluation,
        objectifs: Object.fromEntries(
          objectifs.map((o) => [o.id, { niveau: 'C' as const, commentaire: texte }]),
        ),
        pointsForts: texte,
        axesDeDeveloppement: texte,
        plan: Array.from({ length: MAXIMUMS_DE_LA_FICHE.actions }, () => ({
          action: long(LONGUEURS_DE_LA_FICHE.ligne),
          delai: long(LONGUEURS_DE_LA_FICHE.delai),
          suivi: long(LONGUEURS_DE_LA_FICHE.ligne),
        })),
        objectifsAVenir: Array.from({ length: MAXIMUMS_DE_LA_FICHE.objectifsAVenir }, () => ({
          objectif: long(LONGUEURS_DE_LA_FICHE.intitule),
          indicateur: long(LONGUEURS_DE_LA_FICHE.indicateurs),
          echeance: '2027-12-31',
        })),
        formations: Array.from({ length: MAXIMUMS_DE_LA_FICHE.formations }, () => ({
          intitule: long(LONGUEURS_DE_LA_FICHE.ligne),
          justification: long(LONGUEURS_DE_LA_FICHE.ligne),
        })),
      },
      reservee: { comprehension: 'B', tenue: 'B', observations: texte },
      n2: { ...base.n2!, commentaires: texte },
    });
    const { pdf, textes } = await imprimer(d);
    const n = pagesDe(pdf);
    expect(n).toBeGreaterThan(15);
    expect(textes).toContain(`Page ${n} sur ${n}`);
    expect(textes).toContain('OBJECTIF 12');
  });
});

describe('la typographie', () => {
  it('l’apostrophe courbe et les espaces insécables de la ponctuation française', () => {
    expect(typographie("L'avis : oui ? « Bien » ; non !")).toBe('L’avis : oui ? « Bien » ; non !');
  });
});
