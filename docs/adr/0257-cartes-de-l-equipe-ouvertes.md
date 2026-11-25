# ADR-0257 : Mon équipe : toutes les cartes s'ouvrent, et l'auto-évaluation faite y dit sa date

**Statut** : acceptée · 2026-11-22 · révise les ADR [0216](0216-evaluation-par-le-n1.md) et [0235](0235-statut-sur-les-cartes-de-l-equipe.md)

## Contexte

Dans « Mon équipe », seule la carte d'un agent dont l'auto-évaluation
était faite s'ouvrait sur sa page (ADR-0216). À côté de l'adresse, chaque
carte donnait le statut de l'agent, cadre ou non cadre (ADR-0235). L'APIX
veut que toutes les cartes s'ouvrent, et que la carte d'un agent qui a fait
son auto-évaluation en donne la date à la place du statut.

## Décision

**Toutes les cartes de « Mon équipe » s'ouvrent** sur la page de l'agent.
Tant que l'auto-évaluation n'est pas transmise, la page ne montre que
l'en-tête de l'agent (son nom, son poste, ses repères) et la bande des
trois étapes : « Auto-évaluation » (« Non faite »), « Évaluation par le
N+1 » et « Transmission à la DCH ». La fiche à remplir n'apparaît qu'une
fois l'auto-évaluation transmise, comme avant.

**L'auto-évaluation faite, la carte affiche « Auto-évaluation » et,
dessous, « Faite le 18 nov. »**, à la place de « Statut ». Les cartes des
agents qui ne l'ont pas encore faite gardent le statut.

## Conséquences

- Le statut d'un agent qui a fait son auto-évaluation se lit sur sa page,
  dans les repères de l'en-tête.
- L'API ne change pas : la page d'un agent de l'équipe s'ouvrait déjà
  avant la transmission de l'auto-évaluation.
