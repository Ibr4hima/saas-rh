import { statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Le logo déposé dans `public/`, tel que le site le sert : le SVG d'abord,
 * puis le PNG ; null sans fichier. Lu au serveur à chaque rendu : la page
 * arrive avec la bonne adresse, le navigateur n'essaie rien qui échoue. Un
 * logo remplacé s'affiche sans redémarrer, et sa date entre dans l'adresse
 * pour que l'ancien ne reste pas en cache.
 */
export function logoInstalle(): string | null {
  for (const nom of ['logo-apix.svg', 'logo-apix.png']) {
    try {
      const { mtimeMs } = statSync(join(process.cwd(), 'public', nom));
      return `/${nom}?v=${Math.round(mtimeMs)}`;
    } catch {
      // Pas ce format : le suivant.
    }
  }
  return null;
}
