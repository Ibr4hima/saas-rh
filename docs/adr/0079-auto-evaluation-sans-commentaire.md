# ADR-0079 : Auto-évaluation, un statut par objectif, sans commentaire

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0076](0076-evaluation-annuelle.md) pour l'auto-évaluation de
l'agent.

## Contexte

Ouverte, l'auto-évaluation demandait, sous chaque objectif, un statut
(atteint, partiellement ou non atteint) et un commentaire. Les commentaires
s'enregistraient au brouillon, et l'envoi au n+1 attendait les deux.

## Décision

**Un statut, sans commentaire.** Sous chaque objectif, l'agent choisit
atteint, partiellement ou non atteint, et la case prend la couleur du choix.
Plus de zone de texte ni de bouton « Enregistrer » : chaque choix
s'enregistre aussitôt, comme la coche en cours d'année.

**L'envoi attend un statut par objectif**, rien d'autre ; une formation garde
celui que lui donne l'APIX Academy. Le bouton « Auto-évaluation » compte les
objectifs qui ont leur statut.

Le n+1 lit le statut de chaque objectif, puis évalue comme avant : l'atteinte
retenue, un commentaire sous chaque objectif, le report éventuel et la note
(ADR-0076).

## Conséquences

- La route qui enregistrait les commentaires de l'agent est retirée de l'API.
- Les commentaires d'une auto-évaluation déjà envoyée restent lisibles, chez
  l'agent et chez le n+1, à côté du statut.
- Un commentaire resté au brouillon ne part pas : l'agent ne le voit plus, et
  l'envoi l'efface de la fiche. Le journal d'audit le garde.
