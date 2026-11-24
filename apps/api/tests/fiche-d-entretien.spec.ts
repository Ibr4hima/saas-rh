/**
 * La fiche d'entretien annuel d'évaluation, en PDF (ADR-0205, ADR-0208).
 *
 * Ce qui compte : la version de l'agent ne porte jamais la partie réservée
 * à la hiérarchie ; chaque page porte l'en-tête du modèle de la DCH ; le
 * texte est celui de la grille corrigée ; le management ne vaut que pour le
 * personnel cadre ; le noir, avec le bleu et l'orange de l'APIX par touches ;
 * les textes au plus long tiennent, sur autant de pages qu'il faut. La fiche
 * vierge porte toutes les sections, et rien n'y est rempli.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it, vi } from 'vitest';
import { LONGUEURS_DE_LA_FICHE, MAXIMUMS_DE_LA_FICHE } from '@teranga/contracts';
import {
  ficheDEntretienPdf,
  ficheDeLAgentPdf,
  ficheViergePdf,
  typographie,
  type DonneesDeLaFiche,
} from '../src/modules/entretiens/fiche-pdf';
import { ficheExemple } from './fiche-exemple';
import { couleursDe, policesDe } from './lecture-pdf';

/** Le noir du texte, le blanc des cases cochées, le bleu et l'orange de l'APIX. */
const COULEURS = ['#111111', '#ffffff', '#004f91', '#b14600'];

/** Le PDF, et tout ce que la fiche y a écrit, appel après appel de pdfkit. */
async function capter(fabriquer: () => Promise<Buffer>) {
  const espion = vi.spyOn(PDFDocument.prototype, 'text');
  try {
    const pdf = await fabriquer();
    const textes = espion.mock.calls.map((appel) => String(appel[0]));
    // `suite` : les morceaux écrits l'un après l'autre, comme « Page », « 2 », « sur », « 10 ».
    return { pdf, textes, tout: textes.join('\n'), suite: textes.join('') };
  } finally {
    espion.mockRestore();
  }
}

const imprimer = (d: DonneesDeLaFiche) => capter(() => ficheDEntretienPdf(d));
const imprimerLaVierge = () => capter(() => ficheViergePdf(2026));

const pagesDe = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const italiennesDe = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/MediaBox \[0 0 841\.89 595\.28\]/g) ?? []).length;

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

  it('la partie de l’agent seule : ni le N+1, ni ses sections, ni les validations (ADR-0241)', async () => {
    const agent = await capter(() => ficheDeLAgentPdf(ficheExemple()));
    const complete = await imprimer(ficheExemple());
    // L'auto-évaluation d'un objectif, et les souhaits.
    expect(agent.tout).toContain('Le nouveau circuit de collecte a fait gagner une semaine.');
    expect(agent.tout).toContain('Évoluer vers la gestion de projets');
    // Rien de ce que remplit le N+1.
    expect(agent.tout).not.toContain('Résultat remarquable, salué par la Direction générale.');
    expect(agent.tout).not.toContain('VALIDATION ET SUIVI');
    expect(agent.tout).not.toContain('PARTIE STRICTEMENT RÉSERVÉE À LA HIÉRARCHIE');
    expect(pagesDe(agent.pdf)).toBeLessThan(pagesDe(complete.pdf));
  });

  it('sans objectif, la mention seule, sans l’échelle (ADR-0244)', async () => {
    const sans = await imprimer(ficheExemple({ objectifs: [] }));
    expect(sans.tout).toContain('Aucun objectif n’a été fixé pour cette année.');
    expect(sans.textes).not.toContain('ÉCHELLE');
    const avec = await imprimer(ficheExemple());
    expect(avec.textes).toContain('ÉCHELLE');
    const agent = await capter(() => ficheDeLAgentPdf(ficheExemple({ objectifs: [] })));
    expect(agent.textes).not.toContain('ÉCHELLE');
    // La fiche vierge a ses blocs d'objectifs à remplir : elle garde son échelle.
    const vierge = await imprimerLaVierge();
    expect(vierge.textes).toContain('ÉCHELLE');
  });

  it('imprime les points forts et les axes de développement en puces (ADR-0251)', async () => {
    const base = ficheExemple();
    /** Les puces dessinées : un rond bleu chacune. */
    const puces = async (pointsForts: string, axesDeDeveloppement: string) => {
      const espion = vi.spyOn(PDFDocument.prototype, 'circle');
      try {
        await ficheDEntretienPdf(
          ficheExemple({ evaluation: { ...base.evaluation, pointsForts, axesDeDeveloppement } }),
        );
        return espion.mock.calls.length;
      } finally {
        espion.mockRestore();
      }
    };
    // Une ligne, une puce, que le N+1 l'ait écrite avec un tiret ou non.
    const sansTiret = await puces('Rigueur\nFiabilité', 'Déléguer');
    expect(sansTiret).toBe(await puces('- Rigueur\n- Fiabilité', '- Déléguer'));
    expect(sansTiret - (await puces('', ''))).toBe(3);
  });

  it('imprime les autres réalisations en puces (ADR-0261)', async () => {
    const base = ficheExemple();
    const puces = async (autresRealisations: string) => {
      const espion = vi.spyOn(PDFDocument.prototype, 'circle');
      try {
        await ficheDEntretienPdf(ficheExemple({ auto: { ...base.auto, autresRealisations } }));
        return espion.mock.calls.length;
      } finally {
        espion.mockRestore();
      }
    };
    // Une ligne, une puce, écrite avec un tiret ou non.
    const sansTiret = await puces('Forum de juin\nDeux notes de conjoncture');
    expect(sansTiret).toBe(await puces('- Forum de juin\n- Deux notes de conjoncture'));
    expect(sansTiret - (await puces(''))).toBe(2);
  });

  it('imprime le texte de la grille, corrigé', async () => {
    const { tout } = await imprimer(ficheExemple());
    for (const juste of [
      'FICHE D’ENTRETIEN ANNUEL D’ÉVALUATION',
      'ÉVALUATION DES COMPÉTENCES ET DES PERFORMANCES',
      'Compréhension du poste',
      'Connaît parfaitement le poste de travail.',
      'S1/EN05',
      '15/12/2018',
      'BESOINS ET PROJETS DE FORMATION',
    ]) {
      expect(tout).toContain(juste);
    }
    for (const faute of [
      'HIERACHIE',
      'Comprehension',
      'ÉVALUATION DES ET',
      'Connait ',
      'ponctuelle',
      // L'évaluation ne fixe plus les objectifs de l'année suivante (ADR-0272).
      'Les objectifs de l’année 2027',
    ]) {
      expect(tout).not.toContain(faute);
    }
  });

  it('l’identification, les dates en lettres et le nom en capitales', async () => {
    const { tout } = await imprimer(ficheExemple());
    expect(tout).toContain('Moussa SARR');
    expect(tout).toContain('Matricule EMP-002');
    // Le jour reste avec son mois : l'espace est insécable.
    expect(tout).toContain('22 décembre 2026');
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

  it('le noir, avec le bleu et l’orange de l’APIX par touches ; les polices de la DCH', async () => {
    const { pdf } = await imprimer(ficheExemple());
    const couleurs = couleursDe(pdf);
    for (const c of couleurs) expect(COULEURS).toContain(c);
    expect(couleurs).toContain('#004f91');
    expect(couleurs).toContain('#b14600');
    const polices = policesDe(pdf);
    expect(polices).toContain('Raleway-Regular');
    expect(polices).toContain('Raleway-Bold');
    expect(polices).toContain('Exo-Regular');
  });

  it('chaque page porte l’en-tête du modèle et son numéro sur le total', async () => {
    const { pdf, textes, suite } = await imprimer(ficheExemple());
    const n = pagesDe(pdf);
    expect(textes.filter((t) => t === 'DCH')).toHaveLength(n);
    expect(textes.filter((t) => t === 'FICHE D’ENTRETIEN ANNUEL D’ÉVALUATION')).toHaveLength(n);
    expect(textes.filter((t) => t === 'Moussa SARR  ·  Matricule EMP-002')).toHaveLength(n);
    for (let i = 1; i <= n; i++) expect(suite).toContain(`Page ${i} sur ${n}`);
  });

  it('la grille des compétences à l’italienne, comme dans le modèle', async () => {
    const { pdf } = await imprimer(ficheExemple());
    expect(italiennesDe(pdf)).toBeGreaterThanOrEqual(1);
    expect(italiennesDe(pdf)).toBeLessThan(pagesDe(pdf));
  });

  it('qui a validé en ligne paraphe : ses initiales, à la main (ADR-0209)', async () => {
    const complete = await imprimer(ficheExemple());
    // L'agent en section 7 ; le N+1 en section 7 et sous ses observations ;
    // le N+2 sous ses commentaires.
    expect(complete.textes.filter((t) => t === 'M.S.')).toHaveLength(1);
    expect(complete.textes.filter((t) => t === 'A.D.')).toHaveLength(2);
    expect(complete.textes.filter((t) => t === 'A.N.')).toHaveLength(1);
    expect(policesDe(complete.pdf)).toContain('Allura-Regular');

    const base = ficheExemple();
    const sansValidation = await imprimer(
      ficheExemple({ validations: { n1: null, agent: null }, n2: { ...base.n2!, le: null } }),
    );
    for (const paraphe of ['M.S.', 'A.D.', 'A.N.']) {
      expect(sansValidation.textes).not.toContain(paraphe);
    }
    expect(policesDe(sansValidation.pdf)).not.toContain('Allura-Regular');
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
        formations: Array.from({ length: MAXIMUMS_DE_LA_FICHE.formations }, () => ({
          intitule: long(LONGUEURS_DE_LA_FICHE.ligne),
          justification: long(LONGUEURS_DE_LA_FICHE.ligne),
        })),
      },
      reservee: { comprehension: 'B', tenue: 'B', observations: texte },
      n2: { ...base.n2!, commentaires: texte },
    });
    const { pdf, textes, suite } = await imprimer(d);
    const n = pagesDe(pdf);
    expect(n).toBeGreaterThan(15);
    expect(suite).toContain(`Page ${n} sur ${n}`);
    expect(textes).toContain('OBJECTIF 12');
  });
});

describe('la fiche vierge', () => {
  it('porte toutes les sections, celles de l’agent, du N+1 et du N+2', async () => {
    const { tout } = await imprimerLaVierge();
    for (const titre of [
      'IDENTIFICATION DE L’AGENT ET DE L’ÉVALUATEUR',
      'BILAN DE L’ANNÉE 2026',
      'ÉVALUATION DES COMPÉTENCES ET DES PERFORMANCES',
      'SYNTHÈSE DE L’ÉVALUATION ET AXES D’AMÉLIORATION',
      'BESOINS ET PROJETS DE FORMATION',
      'PRÉOCCUPATIONS ET SOUHAITS DE L’AGENT',
      'VALIDATION ET SUIVI',
      'PARTIE STRICTEMENT RÉSERVÉE À LA HIÉRARCHIE',
      'Observations du N+1',
      'Commentaires du N+2',
      'Commentaires des autres niveaux hiérarchiques',
    ]) {
      expect(tout).toContain(titre);
    }
    // Rien sur l'année suivante : ses objectifs ont leur propre campagne (ADR-0272).
    expect(tout).not.toContain('2027');
  });

  it('rien n’y est rempli : ni nom, ni niveau, ni « Néant »', async () => {
    const { textes, tout } = await imprimerLaVierge();
    for (const rempli of ['Néant', 'Non renseigné', 'Sans objet', 'À fixer']) {
      expect(textes).not.toContain(rempli);
    }
    expect(tout).not.toContain('Validation en ligne');
    // Le bandeau de chaque page ne nomme personne.
    expect(tout).not.toContain('Matricule ');
  });

  it('trois objectifs à remplir ; le management, pour le personnel cadre', async () => {
    const { textes } = await imprimerLaVierge();
    expect(textes).toContain('OBJECTIF 3');
    expect(textes).not.toContain('OBJECTIF 4');
    expect(textes).toContain('Management');
    expect(textes).toContain('Personnel cadre seulement');
  });

  it('chaque page porte l’en-tête du modèle ; la grille des compétences à l’italienne', async () => {
    const { pdf, textes, suite } = await imprimerLaVierge();
    const n = pagesDe(pdf);
    expect(textes.filter((t) => t === 'DCH')).toHaveLength(n);
    expect(textes.filter((t) => t === 'FICHE D’ENTRETIEN ANNUEL D’ÉVALUATION')).toHaveLength(n);
    for (let i = 1; i <= n; i++) expect(suite).toContain(`Page ${i} sur ${n}`);
    expect(italiennesDe(pdf)).toBeGreaterThanOrEqual(1);
  });

  it('les couleurs et les polices de la fiche remplie, sans paraphe', async () => {
    const { pdf } = await imprimerLaVierge();
    for (const c of couleursDe(pdf)) expect(COULEURS).toContain(c);
    expect(policesDe(pdf)).toContain('Raleway-Bold');
    expect(policesDe(pdf)).not.toContain('Allura-Regular');
  });
});

describe('la typographie', () => {
  it('l’apostrophe courbe et les espaces insécables de la ponctuation française', () => {
    expect(typographie("L'avis : oui ? « Bien » ; non !")).toBe('L’avis : oui ? « Bien » ; non !');
  });

  it('un nombre reste avec ce qui le suit : « 1 % », « 48 heures »', () => {
    expect(typographie('Moins de 1 % en 48 heures, sur 312 dossiers en 2026.')).toBe(
      'Moins de 1\u00a0% en 48\u00a0heures, sur 312\u00a0dossiers en 2026.',
    );
  });
});
