# ADR-0123 : Les décisions de disponibilité proposent les sessions du conseil d'administration

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0100](0100-decisions-de-disponibilite.md)

## Contexte

Les deux décisions de disponibilité visent les procès-verbaux des sessions du
conseil d'administration qui ont nommé à la direction générale et à la
direction générale adjointe. Depuis l'ADR-0100, la DCH en saisit les deux
dates à chaque décision, alors qu'elles ne changent qu'à une nouvelle
nomination. L'APIX demande qu'elles soient proposées, aux dates en vigueur :
le 7 mai 2024 pour la direction générale, le 13 décembre 2024 pour la
direction générale adjointe.

## Décision

**La fiche propose les deux dates, la DCH les corrige.** Elles se posent dans
les champs de « Renseigner les sessions du conseil d'administration » dès que
la fiche s'ouvre, et restent obligatoires. La fiche passe d'une décision à
l'autre : une date corrigée le reste.

**Ces dates appartiennent à l'organisation, pas à la page.** Elles rejoignent
ce que l'API sait de l'APIX, à côté de l'en-tête de ses documents
(ADR-0086) : une constante, mise à jour à chaque nomination. La page les lit
à l'API, `GET /v1/documents/generer/:type/preremplissage`, avec les droits de
la génération ; elle ne connaît aucune organisation. Le jour où une seconde
organisation arrive, la constante devient une donnée du tenant, et la page ne
change pas.

## Conséquences

- Un document sans agent peut dire ce que sa fiche sait d'avance ; seules les
  décisions de disponibilité le font.
- Une nouvelle nomination demande de mettre à jour la constante
  (`SESSIONS_DU_CONSEIL`, `apps/api/src/modules/documents/entete.ts`) ; d'ici
  là, la DCH corrige la date dans la fiche.
