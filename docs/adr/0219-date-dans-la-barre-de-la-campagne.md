# ADR-0219 : La date du jour dans la barre de la campagne, sans calendrier

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0212](0212-barre-de-la-campagne.md)

## Contexte

Dans la barre de la plateforme, la date du jour, en haut à droite, ouvre le
calendrier des jours fériés (ADR-0117). La barre de la campagne ne la
montrait pas. L'APIX la veut aussi en campagne, sans le calendrier : la
campagne ne montre que l'évaluation.

## Décision

La date du jour revient en haut à droite, à gauche du compte : l'icône du
calendrier, puis « Vendredi 20 novembre 2026 » ; sur un téléphone,
« 20 nov. 2026 ». Elle se lit et ne se clique pas : ni lien, ni survol, ni
calendrier derrière.

## Conséquences

- Le calendrier des jours fériés reste hors de la campagne, comme le reste
  de la plateforme.
