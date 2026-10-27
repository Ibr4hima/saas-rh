/**
 * L'en-tête `Content-Disposition` d'un fichier, sûr quel que soit son nom.
 *
 * Node refuse dans un en-tête tout caractère hors Latin-1 : l'apostrophe
 * typographique de « Code du travail - Loi n° 97-17 l’article.pdf » faisait
 * répondre 500. Le nom part en deux formes (RFC 6266) : une version ASCII
 * pour les vieux navigateurs, et la vraie, en UTF-8, que tous les autres lisent.
 */
export function contentDisposition(mode: 'inline' | 'attachment', nom: string): string {
  const ascii =
    nom
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[’‘]/g, "'")
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '') || 'fichier';
  // encodeURIComponent laisse passer ' ( ) * : l'apostrophe, en particulier,
  // couperait la valeur `UTF-8''…` en deux.
  const utf8 = encodeURIComponent(nom).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
