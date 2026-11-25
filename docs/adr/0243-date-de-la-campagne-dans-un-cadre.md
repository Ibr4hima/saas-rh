# ADR-0243 : La date de la barre de la campagne, dans un cadre

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0219](0219-date-dans-la-barre-de-la-campagne.md)

## Contexte

Dans la barre de la campagne, la date du jour se posait à même le fond,
l'icône du calendrier en gris (ADR-0219). Dans la barre de la plateforme,
elle se tient dans un cadre, comme les autres commandes de l'en-tête.
L'APIX la veut comme dans la plateforme.

## Décision

La date de la campagne prend le cadre de celle de la plateforme : un filet
fin, le fond des cartes, les coins des contrôles, 36 px de haut, 12 px de
marge de chaque côté, l'icône à la couleur du texte. Elle ne se clique
toujours pas : le survol ne la change pas. Sur un téléphone, elle garde sa
forme courte, « 21 nov. 2026 », dans le même cadre.

## Conséquences

- La date et le rond du compte se tiennent côte à côte à la même hauteur.
