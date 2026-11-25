# ADR-0273 : À la fin de l'évaluation, la fiche est verrouillée

**Statut** : acceptée · 2026-11-24 · révise l'[ADR-0217](0217-validation-par-l-agent.md), l'[ADR-0218](0218-commentaires-du-n2.md) et l'[ADR-0221](0221-transmission-a-la-dch.md)

## Contexte

L'évaluation et la fixation des objectifs deviennent deux campagnes
distinctes (ADR-0272). À la fin de la campagne d'évaluation, l'APIX veut
que plus personne ne modifie son évaluation.

Jusqu'ici, après la date de fin, l'agent et le N+1 ne pouvaient déjà plus
écrire. Mais l'agent validait encore à tout moment (ADR-0217), le N+2
écrivait ses commentaires (ADR-0218) et le N+1 transmettait la fiche à la
DCH (ADR-0221).

## Décision

**Après la date de fin de la période**, la campagne est terminée et plus
personne ne modifie la fiche :

- l'agent ne valide plus son évaluation ;
- le N+2 n'écrit ni ne transmet ses commentaires ;
- le N+1 ne reprend plus la fiche au N+2, ne la renvoie plus au N+2, et ne
  la transmet plus à la DCH.

L'API répond 409, `campagne.evaluation_terminee`, « La campagne
d'évaluation est terminée ». Les vues le disent aussi : `validable` pour
l'agent, `modifiable` pour le N+2, et la phase `terminee` pour les gestes
du N+1.

**Les écrans retirent ces gestes** : « Valider mon évaluation » disparaît
de l'accueil et de « Mon évaluation », la saisie des commentaires chez le
N+2, et la barre vers la DCH chez le N+1. Tout se lit toujours.

**Les dates décident.** Repousser la date de fin dans l'administration
rouvre les fiches.

## Conséquences

- Une évaluation que l'agent n'a pas validée à la date de fin le reste.
  Une fiche que le N+1 n'a pas transmise ne part plus à la DCH : la DCH la
  voit dans « Suivi des évaluations », sans pouvoir la lire en entier.
- L'administration garde ses gestes : les dates, l'évaluateur, la remise à
  zéro.
