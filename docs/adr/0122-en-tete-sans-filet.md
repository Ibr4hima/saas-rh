# ADR-0122 : L'en-tête sans filet au défilement

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Depuis l'ADR-0115, un filet séparait l'en-tête de l'écran du contenu dès que
celui-ci défilait. Ce filet courait sur toute la largeur de la colonne :
il dépassait des blocs et des tableaux, à gauche comme à droite. L'APIX
demande de l'enlever.

## Décision

**L'en-tête et la page ne font qu'un seul fond**, même quand le contenu
défile : aucun filet, aucune ombre ne les sépare. Le contenu s'efface au
bord de la zone qui défile, sous l'en-tête, qui reste en place.

## Conséquences

- La page ne suit plus le défilement pour dessiner l'en-tête.
