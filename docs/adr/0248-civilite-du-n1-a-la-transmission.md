# ADR-0248 : La confirmation de l'auto-évaluation nomme le N+1 avec sa civilité

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0224](0224-en-tete-de-l-agent.md)

## Contexte

Avant de transmettre son auto-évaluation, l'agent confirme dans une
fenêtre. Elle disait : « Elle part à [prénom nom], votre N+1, et ne pourra
plus être modifiée. » L'APIX veut une phrase plus explicite, qui nomme le
N+1 avec sa civilité.

## Décision

La fenêtre dit : « Votre auto-évaluation sera transmise à Monsieur
[prénom nom]. Vous ne pourrez plus la modifier après transmission. », ou
« Madame [prénom nom] ».

- La civilité suit le sexe inscrit au dossier du N+1, comme « Supérieur
  hiérarchique » sur l'en-tête de l'agent (ADR-0224). Le prénom n'en dit
  rien.
- Sans sexe inscrit au dossier, le nom seul, sans civilité.
- Sans N+1 désigné : « … sera transmise à votre N+1. »
- La civilité ne reste pas seule en bout de ligne.

## Conséquences

- Un N+1 dont le dossier ne dit pas le sexe paraît sans civilité : la DCH
  le complète dans le dossier.
