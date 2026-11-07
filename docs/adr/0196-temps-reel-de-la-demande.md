# ADR-0196 : Le temps d'une demande de document se lit en temps réel

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0128](0128-principal-et-backups.md) et [ADR-0194](0194-temps-a-la-minute.md)

## Contexte

« Temps écoulé » et « Durée traitement » comptaient en heures ouvrées : un
samedi, une demande traitée en trois quarts d'heure affichait « 0 min ». Pour
la DCH, la durée de traitement est le temps écoulé avant que la demande soit
effectivement traitée.

## Décision

**Les deux colonnes disent le temps réellement écoulé** : « Temps écoulé »
depuis l'envoi de la demande, « Durée traitement » de l'envoi jusqu'au
traitement (mise à disposition ou refus).

**Sous l'heure, les minutes** (« 45 min ») ; **sous le jour, les heures et
les minutes** (« 3 h 5 min ») ; **au-delà, les jours et les heures**
(« 2 j 4 h »).

**L'urgence reste en heures ouvrées**, sans les week-ends ni les jours
fériés : « Temps écoulé » passe en orange après 48 heures ouvrées, en rouge
après 72 (ADR-0128). « Durée traitement » passe en rouge quand le traitement
a pris plus de 72 heures ouvrées. Une demande arrivée un vendredi soir peut
donc afficher « 2 j 15 h » le lundi sans être en retard.

## Conséquences

- La vue d'une demande porte `minutesEcoulees`, à la place de
  `minutesOuvrees` ; `heuresOuvrees` garde les seuils.
- Les délais de la personne principale et des backups ne changent pas.
