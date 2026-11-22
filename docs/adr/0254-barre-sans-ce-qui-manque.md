# ADR-0254 : La barre au bas de la fiche ne dresse plus la liste de ce qui manque

**Statut** : acceptée · 2026-11-22 · révise l'[ADR-0241](0241-valider-l-auto-evaluation.md)

## Contexte

Sous l'auto-évaluation de l'agent et sous l'évaluation du N+1, la barre au
bas de la page (ADR-0241) disait, tant que l'obligatoire n'était pas rempli,
ce qui manquait encore, depuis l'ADR-0215 : « À compléter : la compétence
« Connaissances techniques et pratiques », la compétence « Qualité du
travail », la compétence « Organisation et planification » et 12 autres. »
L'APIX ne veut plus cette phrase.

## Décision

La barre ne dit plus que l'état de l'enregistrement (« Brouillon enregistré
à 16 h 54 ») et porte ses boutons. Le bouton de transmission reste inactif
tant que l'obligatoire n'est pas rempli.

## Conséquences

- Ce qui reste à remplir se repère aux astérisques des champs obligatoires ;
  en tête de l'auto-évaluation, l'avancement des réponses obligatoires
  reste affiché.
- Le serveur refuse toujours une transmission incomplète, et sa réponse dit
  ce qui manque.
