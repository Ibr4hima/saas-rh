# ADR-0180 : Les fiches s'ouvrent au centre de l'écran

**Statut** : acceptée · 2026-11-07 · remplace en partie l'[ADR-0177](0177-fiche-d-une-unite-stable.md)

## Contexte

L'ADR-0177 posait la fiche d'une unité de l'organigramme en haut de l'écran,
à 6 % de sa hauteur, pour que seul son bas bouge quand son contenu change.
Les autres fenêtres restaient centrées : une fiche ne s'ouvrait donc pas
toujours au même endroit. La DCH veut toutes les fiches au centre de l'écran.

## Décision

**Toute fenêtre s'ouvre au centre de l'écran**, à égale distance des quatre
bords, sur grand écran ; sur téléphone, elle occupe l'écran entier, comme
avant. Le composant commun des fenêtres n'a plus d'autre placement.

La fiche d'une unité garde le reste de l'ADR-0177 : elle se charge à
l'approche du bloc, s'ouvre entière à sa hauteur finale, sur un voile sans
flou. Quand son contenu grandit ensuite (« Modifier », une confirmation),
elle reste centrée et s'étend vers le haut comme vers le bas.

Dans l'import, l'organigramme et la fiche d'une unité tiennent dans la même
hauteur : passer de l'un à l'autre ne déplace pas la fenêtre.

## Conséquences

- Le paramètre `ancre` du composant de fenêtre disparaît.
