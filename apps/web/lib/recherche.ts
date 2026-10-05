/* ────────────────────────────────────────────────────────────────
   Une recherche, une règle : ni la casse ni les accents ne comptent,
   et chaque mot tapé doit se retrouver, dans n'importe quel ordre.
   C'est celle de la liste du personnel, côté serveur.
   ──────────────────────────────────────────────────────────────── */

/** « Sécurité » et « securite » se comparent comme « securite ». */
export function comparable(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’‘]/g, "'")
    .toLocaleLowerCase('fr');
}

/** Vrai si chaque mot de `recherche` se trouve dans l'un des `champs`. */
export function correspond(recherche: string, ...champs: (string | null | undefined)[]): boolean {
  const mots = comparable(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;
  const texte = comparable(champs.filter(Boolean).join(' '));
  return mots.every((m) => texte.includes(m));
}
