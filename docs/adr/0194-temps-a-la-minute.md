# ADR-0194 : Le temps d'une demande de document se lit à la minute

**Statut** : acceptée · 2026-11-07 · précise l'[ADR-0128](0128-principal-et-backups.md)

## Contexte

« Temps écoulé » et « Durée traitement » comptaient en heures ouvrées
entières : une demande arrivée il y a vingt minutes, ou traitée en quarante,
affichait « < 1 h ». La DCH veut voir depuis combien de temps une demande
attend, et en combien de temps elle a été traitée.

## Décision

**Sous l'heure, les minutes** : de « 0 min » à « 59 min ». **Au-delà, les
heures et les minutes** : « 3 h 5 min », ou « 52 h » quand il ne reste pas
de minutes.

Le temps reste ouvré : les week-ends et les jours fériés ne comptent pas.
Les couleurs ne changent pas : orange passé 48 heures, rouge passé 72.

## Conséquences

- La vue d'une demande porte `minutesOuvrees` à côté de `heuresOuvrees`,
  qui garde les seuils.
- Le temps affiché est celui du dernier chargement de la file.
