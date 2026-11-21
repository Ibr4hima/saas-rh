# ADR-0239 : De trois à cinq objectifs pour l'année à venir

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0216](0216-evaluation-par-le-n1.md)

## Contexte

Dans son évaluation, le N+1 fixe les objectifs de l'année suivante, dans un
tableau qui en prenait de zéro à dix sans bloquer la transmission
(ADR-0216). L'APIX en veut trois au moins, cinq au plus.

## Décision

**Le tableau des objectifs de l'année à venir** montre d'emblée trois
lignes à remplir, et son titre porte l'astérisque des champs obligatoires.
On en ajoute jusqu'à cinq ; à cinq, « Ajouter un objectif » disparaît. Il
ne descend pas sous trois lignes : à trois, le bouton qui retire une ligne
disparaît. Les lignes vides ne s'enregistrent qu'à la première frappe :
ouvrir la fiche ne met pas l'évaluation en cours.

**La transmission à l'agent** demande de trois à cinq objectifs écrits,
chacun avec son intitulé. Sinon, l'écran et l'API disent ce qui manque :
« les objectifs de l'année à venir (3 au moins) », « l'intitulé de
l'objectif 2 de l'année à venir ». Une ligne laissée vide ne compte pas et
ne part pas.

L'indicateur de réussite et l'échéance restent libres.

## Conséquences

- La fiche garde jusqu'à dix objectifs, sa limite d'avant la règle : une
  évaluation enregistrée avant se relit telle quelle, et ne part qu'une
  fois ramenée à cinq.
- La grille d'évaluation, hors de la campagne, garde ses propres règles.
