# ADR-0082 : Validée, une mise à jour d'informations ne figure pas au suivi

**Statut** : acceptée · 2026-10-15

Précise l'[ADR-0081](0081-suivi-des-mises-a-jour.md).

## Contexte

Le suivi des demandes réunit les demandes de documents et les mises à jour
d'informations (ADR-0081). Une mise à jour validée y restait, parmi les
demandes traitées, alors que la fiche porte déjà le changement : la ligne
n'apprend rien à l'agent.

## Décision

**D'une mise à jour d'informations, le suivi ne garde que l'attente et le
refus.** En attente, elle figure dans « Demandes en cours », et s'annule
d'un clic. Refusée, elle figure dans « Demandes traitées », avec son motif.
Validée ou annulée, elle n'y figure pas.

## Conséquences

- « Demandes traitées » ne compte, pour les mises à jour, que les refus.
- Les demandes de documents ne changent pas : traitées, prêtes, remises ou
  refusées, elles restent au suivi.
