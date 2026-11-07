# ADR-0119 : Les onglets et les choix segmentés, à la hauteur des boutons de l'en-tête

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0108](0108-boutons-aux-coins-d-e-voting.md)

## Contexte

Dans l'en-tête de « Gestion du personnel », les onglets « Actifs » et
« Inactifs » dépassaient de quelques pixels l'action « Nouvel employé » et la
date du jour : 41 px contre 36. Les choix de même dessin, dans les fenêtres
et les fiches (« Quelques heures » ou « Un ou plusieurs jours », « Oui » ou
« Non »), avaient la même mesure. L'APIX les veut à la taille du bouton de
la date, sur toutes les pages.

## Décision

**Un groupe d'onglets, ou de choix segmentés, mesure 36 px de haut** : la
hauteur des boutons de l'en-tête. Chaque onglet fait 28 px, dans un cadre de
3 px et son filet. Les coins ne changent pas : 10 px pour le cadre, 7 px
pour un onglet.

## Conséquences

- La règle vaut partout où ce dessin revient : les onglets d'une page, dans
  l'en-tête ou dans la carte, et les choix segmentés des fenêtres et des
  fiches.
