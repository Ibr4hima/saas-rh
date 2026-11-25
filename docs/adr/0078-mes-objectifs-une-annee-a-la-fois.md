# ADR-0078 : Mes objectifs, une année à la fois

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0052](0052-une-annee-a-la-fois.md), qui laissait la page de
l'agent empiler ses années.

## Contexte

Sur « Mes objectifs », les années s'empilaient, la plus récente d'abord : la
fiche de l'année suivante quand le n+1 l'avait préparée, celle de l'année en
cours, puis celles des années passées. Chez le n+1, la fiche d'un direct se
lit une année à la fois depuis l'ADR-0052.

## Décision

**Une année à la fois, comme chez le n+1.** Le titre « ANNÉE 2026 » devient
la même liste déroulante. Elle propose l'année en cours et les années qui ont
une fiche, la plus récente d'abord : la suivante, quand le n+1 l'a préparée
ou qu'un objectif y est reporté, et les années passées. L'année en cours
s'affiche par défaut. La liste est là même quand elle ne propose qu'une
année : l'agent la trouve toujours au même endroit.

**Ce qui n'est pas une fiche reste sous l'année en cours** : les objectifs de
la direction, les orientations de l'APIX qui sont diffusées, et les objectifs
posés un à un avant les fiches, tant qu'aucune fiche ne les remplace.

**L'adresse garde l'année** (`?annee=2025`), et les avis qui portent sur la
fiche d'une année y mènent : objectifs fixés, mis à jour ou rouverts,
auto-évaluation ouverte, évaluation validée.

## Conséquences

- Une année sans rien à montrer dit « Aucun objectif pour 2026 ».
- Les avis envoyés avant ce changement n'ont pas l'année dans leur lien, ni
  ceux des objectifs de la direction et des orientations de l'APIX : la page
  s'ouvre sur l'année en cours.
- La liste de l'agent n'a pas de pastille orange : chez le n+1, elle marque
  une auto-évaluation qui attend son évaluation.
