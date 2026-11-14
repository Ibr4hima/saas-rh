/**
 * Les heures ouvrées : le temps que la DCH a pour traiter une demande
 * (ADR-0128 ; les délais sont au contrat, `FENETRE_DU_PRINCIPAL_HEURES`).
 * Une journée ouvrée compte ses vingt-quatre heures ; un samedi, un dimanche
 * ou un jour férié n'en compte aucune, et un pont (un férié collé au
 * week-end, avant ou après) s'enjambe comme le week-end.
 *
 * Fonctions pures, testées unitairement. Dakar vit à UTC+0, sans heure d'été
 * (cf. `FUSEAU_HORAIRE`) : ses jours commencent à minuit UTC.
 */

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;

/** Minuit, au début du jour de cet instant. */
const minuit = (ms: number) => Math.floor(ms / JOUR_MS) * JOUR_MS;

/** Un samedi, un dimanche ou un jour férié : le jour de cet instant ne compte pas. */
function chome(ms: number, feries: ReadonlySet<string>): boolean {
  const jour = new Date(ms).getUTCDay();
  return jour === 0 || jour === 6 || feries.has(new Date(ms).toISOString().slice(0, 10));
}

/** Garde-fou : un calendrier sans jour ouvré sur plus d'un an ne fait pas boucler. */
const JOURS_MAX = 400;

/**
 * L'instant où `heures` heures ouvrées se sont écoulées depuis `depuis`.
 * Déposée un samedi, une demande attend le lundi pour que l'horloge parte ;
 * arrivée le vendredi à 10 h, ses 48 heures prennent fin le mardi à 10 h, et
 * le mercredi si le lundi est férié.
 */
export function ajouterHeuresOuvrees(
  depuis: Date,
  heures: number,
  feries: ReadonlySet<string>,
): Date {
  let t = depuis.getTime();
  let reste = heures * HEURE_MS;
  for (let n = 0; n < JOURS_MAX; n += 1) {
    const finDuJour = minuit(t) + JOUR_MS;
    if (!chome(t, feries)) {
      if (reste <= finDuJour - t) return new Date(t + reste);
      reste -= finDuJour - t;
    }
    t = finDuJour;
  }
  return new Date(t + reste);
}

/**
 * L'instant `heures` heures ouvrées avant `jusqua` : l'inverse, pour dater ce
 * qui attend depuis tant d'heures ouvrées.
 */
export function retirerHeuresOuvrees(
  jusqua: Date,
  heures: number,
  feries: ReadonlySet<string>,
): Date {
  let t = jusqua.getTime();
  let reste = heures * HEURE_MS;
  for (let n = 0; n < JOURS_MAX; n += 1) {
    // Le jour qui précède l'instant : la veille entière, à minuit pile.
    const debutDuJour = t === minuit(t) ? t - JOUR_MS : minuit(t);
    if (!chome(debutDuJour, feries)) {
      if (reste <= t - debutDuJour) return new Date(t - reste);
      reste -= t - debutDuJour;
    }
    t = debutDuJour;
  }
  return new Date(t - reste);
}

/** Les heures ouvrées écoulées entre deux instants. */
export function heuresOuvreesEntre(
  depuis: Date,
  jusqua: Date,
  feries: ReadonlySet<string>,
): number {
  let t = depuis.getTime();
  const fin = jusqua.getTime();
  let ms = 0;
  while (t < fin) {
    const finDuJour = Math.min(minuit(t) + JOUR_MS, fin);
    if (!chome(t, feries)) ms += finDuJour - t;
    t = finDuJour;
  }
  return ms / HEURE_MS;
}
