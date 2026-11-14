# ADR-0124 : L'action de l'écran, aux mesures du bouton de la date

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Dans l'en-tête, l'action de l'écran (« Nouvel employé », « Nouvelle offre »,
« Télécharger »…) et le bouton de la date avaient la même hauteur, 36 px,
mais pas les mêmes mesures : l'action écrivait son mot en 13 px, avec 14 px
de marge et 6 px entre l'icône et le mot ; la date, en 12,5 px, avec 12 px de
marge et 8 px d'écart. Côte à côte, l'action paraissait plus grande. L'APIX
demande que les boutons du haut aient tous la taille du bouton de la date.

## Décision

**L'action de l'écran prend les mesures du bouton de la date**, sur tous les
écrans : 36 px de haut, 12 px de marge de chaque côté, 8 px entre l'icône et
le mot, le mot en 12,5 px, demi-gras. Elle reste pleine, la date reste
bordée. Les onglets de l'en-tête ont déjà sa hauteur et son corps
(ADR-0119).

## Conséquences

- Une action de l'en-tête est un peu plus étroite : « Nouvel employé » passe
  de 153 à 148 px.
- Sur téléphone, rien ne change : l'action et la date y sont des ronds de
  36 px.
