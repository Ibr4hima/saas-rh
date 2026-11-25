/**
 * L'analyse d'un texte de loi collé tel quel.
 *
 * C'est la seule porte d'entrée réaliste : personne ne saisira trois cents
 * articles dans un formulaire. Ce qui est éprouvé ici, c'est ce qui casse en
 * silence — un en-tête pris pour de la prose, un article rangé sous la mauvaise
 * section, une numérotation qui repart à un et écrase le renvoi.
 */
import { describe, expect, it } from 'vitest';
import { analyserTexte, composerTexte, depuisRomain } from '@teranga/contracts';

const TEXTE = `CHAPITRE PREMIER — Le contrat de travail

Le contrat de travail est la convention par laquelle une personne s'engage.

Section I — Formation du contrat

Article premier — Liberté de la forme

Le contrat est passé dans les formes qu'il convient aux parties d'adopter.

Article 2 — Période d'essai

La période d'essai doit être stipulée par écrit.

CHAPITRE II — Durée du travail

Article 3 — Durée légale

La durée légale est de quarante heures par semaine.`;

describe('analyserTexte', () => {
  it('reconnaît chapitres, sections et articles', () => {
    const a = analyserTexte(TEXTE);
    expect(a.problemes).toEqual([]);
    expect(a.chapters).toHaveLength(2);
    expect(a.chapters[0]!.title).toBe('Le contrat de travail');
    expect(a.chapters[0]!.sections.map((s) => s.title)).toEqual(['Formation du contrat']);
    expect(a.articleCount).toBe(3);
  });

  it('range les articles sous la section ouverte', () => {
    const a = analyserTexte(TEXTE);
    expect(a.chapters[0]!.articles.map((x) => x.sectionNumber)).toEqual([1, 1]);
    // Le chapitre II n'a pas de section : ses articles n'en portent aucune.
    expect(a.chapters[1]!.articles[0]!.sectionNumber).toBeNull();
  });

  it('numérote par le RANG, et garde le nombre écrit quand il diffère', () => {
    const a = analyserTexte(`CHAPITRE PREMIER — Un
Article premier — A

Corps.

CHAPITRE II — Deux
Article premier — B

Corps.`);
    const tous = a.chapters.flatMap((c) => c.articles);
    // Deux « Article premier » dans le texte : les rangs, eux, restent uniques.
    expect(tous.map((x) => x.number)).toEqual([1, 2]);
    expect(tous.map((x) => x.label)).toEqual([null, 'premier']);
  });

  it('garde une numérotation qui n’est pas un simple nombre', () => {
    const a = analyserTexte(`CHAPITRE PREMIER — Un
Article L.34 — Champ d'application

Corps.`);
    expect(a.chapters[0]!.articles[0]!.label).toBe('L.34');
  });

  it('ne prend pas une phrase pour un en-tête', () => {
    const a = analyserTexte(`CHAPITRE PREMIER — Un
Article premier — A

L'article 5 du présent règlement, qui traite de la discipline et des sanctions applicables, demeure en vigueur nonobstant les dispositions contraires.`);
    expect(a.articleCount).toBe(1);
    expect(a.chapters[0]!.articles[0]!.body).toContain('nonobstant');
  });

  it('signale les articles posés avant tout chapitre', () => {
    const a = analyserTexte(`Article premier — Orphelin

Corps.`);
    expect(a.chapters[0]!.title).toBe('Sans chapitre');
    expect(a.problemes.join(' ')).toContain('avant tout chapitre');
  });

  it('signale un article sans contenu', () => {
    const a = analyserTexte(`CHAPITRE PREMIER — Un
Article premier — Vide
Article 2 — Plein

Corps.`);
    expect(a.problemes.join(' ')).toContain('sans contenu');
  });

  it('composer puis analyser rend le point de départ', () => {
    const depart = analyserTexte(TEXTE);
    const retour = analyserTexte(composerTexte(depart.chapters));
    expect(retour.chapters).toEqual(depart.chapters);
    expect(retour.problemes).toEqual([]);
  });
});

describe('depuisRomain', () => {
  it('lit les chiffres romains', () => {
    expect([depuisRomain('I'), depuisRomain('IV'), depuisRomain('XIV')]).toEqual([1, 4, 14]);
  });
  it('rend zéro sur ce qui n’en est pas', () => {
    expect(depuisRomain('42')).toBe(0);
  });
});
