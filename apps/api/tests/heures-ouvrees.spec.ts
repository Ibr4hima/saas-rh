import { describe, expect, it } from 'vitest';
import {
  DELAI_DE_TRAITEMENT_HEURES,
  FENETRE_DU_PRINCIPAL_HEURES,
  RAPPEL_AVANT_LA_FIN_HEURES,
} from '@teranga/contracts';
import {
  ajouterHeuresOuvrees,
  heuresOuvreesEntre,
  retirerHeuresOuvrees,
} from '../src/modules/time/heures-ouvrees';

/**
 * Les heures ouvrées de la DCH (ADR-0128) : vingt-quatre heures par jour
 * ouvré, aucune le samedi, le dimanche ou un jour férié. Dakar est à UTC+0.
 */
const sansFerie = new Set<string>();
const le = (iso: string) => new Date(`${iso}Z`);
const iso = (d: Date) => d.toISOString().slice(0, 16);

describe('ajouterHeuresOuvrees', () => {
  it('en semaine, 48 heures font deux jours pleins', () => {
    // Lundi 19 octobre 2026, 10 h.
    expect(iso(ajouterHeuresOuvrees(le('2026-10-19T10:00'), 48, sansFerie))).toBe(
      '2026-10-21T10:00',
    );
  });

  it('le week-end ne compte pas : du vendredi 10 h au mardi 10 h', () => {
    expect(iso(ajouterHeuresOuvrees(le('2026-10-16T10:00'), 48, sansFerie))).toBe(
      '2026-10-20T10:00',
    );
  });

  it('un lundi férié prolonge le week-end : le mercredi 10 h', () => {
    const feries = new Set(['2026-10-19']);
    expect(iso(ajouterHeuresOuvrees(le('2026-10-16T10:00'), 48, feries))).toBe('2026-10-21T10:00');
  });

  it('un vendredi férié aussi : arrivée le jeudi 10 h, fin le mardi 10 h', () => {
    // Noël 2026 tombe un vendredi.
    const feries = new Set(['2026-12-25']);
    expect(iso(ajouterHeuresOuvrees(le('2026-12-24T10:00'), 48, feries))).toBe('2026-12-29T10:00');
  });

  it('un pont de quatre jours : vendredi saint et lundi de Pâques', () => {
    const feries = new Set(['2026-04-03', '2026-04-06']);
    // Arrivée le jeudi 2 avril à 18 h : 6 heures le jeudi, puis le mardi.
    expect(iso(ajouterHeuresOuvrees(le('2026-04-02T18:00'), 48, feries))).toBe('2026-04-08T18:00');
  });

  it('déposée un samedi, l’horloge part le lundi à minuit', () => {
    expect(iso(ajouterHeuresOuvrees(le('2026-10-24T15:30'), 48, sansFerie))).toBe(
      '2026-10-28T00:00',
    );
    expect(iso(ajouterHeuresOuvrees(le('2026-10-24T15:30'), 0, sansFerie))).toBe(
      '2026-10-26T00:00',
    );
  });

  it('déposée un jour férié, l’horloge part le lendemain ouvré', () => {
    const feries = new Set(['2026-05-01']);
    // Le 1er mai 2026 est un vendredi : départ le lundi 4 mai.
    expect(iso(ajouterHeuresOuvrees(le('2026-05-01T09:00'), 24, feries))).toBe('2026-05-05T00:00');
  });

  it('48 heures pile au soir du vendredi : la fenêtre se ferme à minuit, avant le week-end', () => {
    // Arrivée le jeudi à minuit : jeudi et vendredi pleins.
    expect(iso(ajouterHeuresOuvrees(le('2026-10-22T00:00'), 48, sansFerie))).toBe(
      '2026-10-24T00:00',
    );
  });

  it('le rappel à la personne principale, quinze heures avant la fin de la fenêtre', () => {
    const arrivee = le('2026-10-19T10:00');
    const rappel = ajouterHeuresOuvrees(
      arrivee,
      FENETRE_DU_PRINCIPAL_HEURES - RAPPEL_AVANT_LA_FIN_HEURES,
      sansFerie,
    );
    expect(iso(rappel)).toBe('2026-10-20T19:00');
    // Arrivée un vendredi à 10 h : le rappel tombe le lundi à 19 h.
    expect(
      iso(
        ajouterHeuresOuvrees(
          le('2026-10-16T10:00'),
          FENETRE_DU_PRINCIPAL_HEURES - RAPPEL_AVANT_LA_FIN_HEURES,
          sansFerie,
        ),
      ),
    ).toBe('2026-10-19T19:00');
  });

  it('les 72 heures de traitement enjambent aussi le week-end', () => {
    expect(
      iso(ajouterHeuresOuvrees(le('2026-10-21T10:00'), DELAI_DE_TRAITEMENT_HEURES, sansFerie)),
    ).toBe('2026-10-26T10:00');
  });
});

describe('retirerHeuresOuvrees', () => {
  it('rend l’instant d’arrivée, en semaine comme par-dessus un pont', () => {
    expect(iso(retirerHeuresOuvrees(le('2026-10-21T10:00'), 48, sansFerie))).toBe(
      '2026-10-19T10:00',
    );
    const feries = new Set(['2026-10-19']);
    expect(iso(retirerHeuresOuvrees(le('2026-10-21T10:00'), 48, feries))).toBe('2026-10-16T10:00');
  });

  it('depuis un samedi, le compte part du vendredi soir', () => {
    expect(iso(retirerHeuresOuvrees(le('2026-10-24T10:00'), 50, sansFerie))).toBe(
      '2026-10-21T22:00',
    );
  });
});

describe('heuresOuvreesEntre', () => {
  it('compte les heures des jours ouvrés seulement', () => {
    expect(heuresOuvreesEntre(le('2026-10-16T10:00'), le('2026-10-20T10:00'), sansFerie)).toBe(48);
    expect(heuresOuvreesEntre(le('2026-10-24T08:00'), le('2026-10-25T20:00'), sansFerie)).toBe(0);
  });

  it('un jour férié ne compte pas', () => {
    const feries = new Set(['2026-10-19']);
    expect(heuresOuvreesEntre(le('2026-10-16T10:00'), le('2026-10-20T10:00'), feries)).toBe(24);
  });

  it('s’accorde avec ajouterHeuresOuvrees', () => {
    const feries = new Set(['2026-12-25']);
    const depuis = le('2026-12-23T17:45');
    const fin = ajouterHeuresOuvrees(depuis, 72, feries);
    expect(heuresOuvreesEntre(depuis, fin, feries)).toBe(72);
  });
});
