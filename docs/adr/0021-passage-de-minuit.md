# ADR-0021 : Le passage de minuit

**Statut** : acceptée · 2026-10-06

## Contexte

Les fins de contrat, les contrats qui commencent (ADR-0018) et les mots de
passe à effacer (ADR-0016) se rangeaient au premier passage de la journée,
déclenché par l'activité sur la plateforme : la relève des notifications,
le tableau de bord, la liste du personnel. Sans personne connecté, le jour
ne changeait pas.

## Décision

**Chaque nuit, juste après minuit à Dakar, et au démarrage de l'API**, un
passage parcourt chaque organisation et y range les contrats, au nom du
système (`PassageDeMinuit`). Le démarrage rattrape une nuit manquée.

L'API ne voit aucune organisation hors de son contexte (RLS) : une fonction
`organisations_a_passer()` lui en donne la liste, et rien d'autre
(migration 0088). Chaque organisation passe dans sa transaction, sous sa
RLS ; une organisation en échec n'empêche pas les autres.

Les déclencheurs au fil de la journée restent : ils rattrapent ce que la
nuit n'aurait pas vu (une date corrigée, un serveur arrêté).

## Conséquences

- Plusieurs instances de l'API passent chacune : le verrou de la chaîne par
  organisation les sérialise, la seconde ne trouve plus rien à ranger.
- Le passage ne tourne pas sous les tests, qui posent leurs propres dates.
