# ADR-0183 : Les badges aux coins de 8 px

**Statut** : acceptée · 2026-11-07 · remplace en partie les [ADR-0108](0108-boutons-aux-coins-d-e-voting.md) et [ADR-0110](0110-blocs-aux-coins-des-boutons.md)

## Contexte

Les boutons, les champs et les blocs ont pris 8 px de rayon (ADR-0108,
ADR-0110). Les badges restaient ronds, comme dans e-Voting, et le badge
d'une formation était arrondi d'une demi-ligne. La DCH veut les badges aux
mêmes coins que le reste.

## Décision

**Tout badge prend 8 px de rayon** : le composant commun des badges, quel
que soit son ton, et ce qui en tient lieu ailleurs : les étiquettes d'une
offre d'emploi, le badge d'une formation, la catégorie d'une formation sur
sa carte, « Nouveau », le minuteur d'une évaluation, l'échéance d'un
objectif, le thème d'une formation à gérer, l'année de la frise des jours
fériés, le numéro d'un certificat à vérifier.

**Restent ronds** les compteurs posés à côté d'un titre et les pastilles
d'alerte, les avatars, les boutons d'icône seule et la case d'un choix
exclusif.

## Conséquences

- Un badge prend `rounded-controle` ; plus de `rounded-full` sur un badge.
