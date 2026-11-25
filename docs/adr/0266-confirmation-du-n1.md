# ADR-0266 : « Votre évaluation sera transmise à … » : la confirmation du N+1

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0216](0216-evaluation-par-le-n1.md)

## Contexte

Avant de transmettre l'évaluation à l'agent, le N+1 confirme dans une
fenêtre. Elle disait : « Elle part à [prénom nom], sans la partie réservée
à la hiérarchie. Elle ne pourra plus être modifiée, sauf si l'agent vous
la renvoie. » L'APIX a reformulé ce texte.

## Décision

La fenêtre dit : « Votre évaluation sera transmise à [prénom nom], sans
la partie réservée à la hiérarchie. Elle ne pourra plus être modifiée. »
Le nom de l'agent reste en gras.

## Conséquences

- Le renvoi par l'agent ne change pas
  ([ADR-0217](0217-validation-par-l-agent.md)) : renvoyée, l'évaluation se
  modifie de nouveau, même si la fenêtre ne le dit plus.
