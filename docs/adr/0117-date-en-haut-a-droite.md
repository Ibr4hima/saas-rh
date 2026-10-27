# ADR-0117 : La date du jour en haut à droite de chaque écran

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Depuis l'ADR-0115, la date du jour ne s'écrivait qu'une fois par écran :
sous le salut des accueils, ou parmi les commandes de l'en-tête, réduite à
son icône sous 1280 px ; l'Academy n'en avait pas. L'APIX demande la date en
haut à droite de toutes les pages, comme sur l'ancienne bande bleue, et
qu'un clic mène aux jours fériés. La page où elle mène s'appelle désormais
« Calendrier des jours fériés ».

## Décision

**La date se tient en haut à droite de chaque écran**, l'Academy comprise :
un bouton blanc cerclé d'un filet, l'icône du calendrier et la date en
toutes lettres (« Dimanche 18 octobre 2026 »), aux coins des contrôles comme
les autres boutons qui portent un mot (ADR-0108). Sous 1152 px, l'icône
seule, dans un rond comme les commandes voisines : le titre et les onglets
gardent leur place.

**Un clic mène au « Calendrier des jours fériés »**, l'ancien « Calendrier ·
Jours fériés » ; la pastille s'allume quand on y est.

**Le salut des accueils s'écrit seul** : la date ne se répète plus dessous.

## Conséquences

- Sur téléphone, l'en-tête porte l'icône de la date sur tous les écrans,
  accueils et Academy compris.
