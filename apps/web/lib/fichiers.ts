import { apiUrl } from './api';

/** Le contenu d'un fichier choisi, en base64, pour l'envoyer dans un JSON. */
export function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => reject(new Error('Impossible de lire ce fichier, réessayez.'));
    lecteur.readAsDataURL(fichier);
  });
}

/**
 * Enregistre sur le poste un fichier servi par l'API.
 *
 * Pas un simple lien `download` : l'API vit sur une autre origine, et
 * l'attribut y est IGNORÉ (le navigateur naviguerait vers le fichier). On le
 * récupère donc avec la session, puis on l'enregistre depuis une adresse
 * `blob:` locale, à laquelle l'attribut s'applique. Rend false en cas d'échec :
 * un échec ne doit pas passer pour un succès.
 */
export async function enregistrer(chemin: string, nom: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(chemin), { credentials: 'include' });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Le navigateur lit l'adresse après le clic : la révoquer tout de suite
    // annulerait l'enregistrement qu'on vient de demander.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

/** « 1,2 Mo », « 340 Ko ». */
export function taille(octets: number): string {
  if (octets >= 1024 * 1024) {
    return `${(octets / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  }
  return `${Math.max(1, Math.round(octets / 1024))} Ko`;
}
