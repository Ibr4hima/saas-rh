/** Un nom de fichier, quel qu'il soit, passe dans l'en-tête de téléchargement. */
import { validateHeaderValue } from 'node:http';
import { describe, expect, it } from 'vitest';
import { contentDisposition } from '../src/common/telechargement';

describe('l’en-tête de téléchargement', () => {
  it('accepte l’apostrophe typographique et les accents', () => {
    const nom = 'Code du travail - l’article 12 (révisé).pdf';
    const entete = contentDisposition('inline', nom);
    expect(() => validateHeaderValue('Content-Disposition', entete)).not.toThrow();
    expect(entete).toContain(`filename="Code du travail - l'article 12 (revise).pdf"`);
    // La vraie forme se relit telle quelle.
    const utf8 = entete.split("filename*=UTF-8''")[1]!;
    expect(decodeURIComponent(utf8)).toBe(nom);
    expect(utf8).not.toMatch(/['()]/);
  });

  it('ne laisse ni guillemet ni nom vide', () => {
    expect(contentDisposition('attachment', '"')).toContain('filename="fichier"');
  });
});
