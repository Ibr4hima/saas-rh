# ADR-0172 : La disponibilité dure deux ans au plus, renouvelable

**Statut** : acceptée · 2026-11-03 · précise l'[ADR-0135](0135-disponibilite.md) et l'[ADR-0136](0136-reprise-au-plus-trois-ans.md)

## Contexte

La disponibilité durait trois ans au plus, renouvelable (ADR-0135). Les
décisions de mise en disponibilité et de renouvellement, comme
l'attestation de reprise, tenaient la même borne (ADR-0136). L'APIX accorde
la disponibilité pour deux ans au plus, toujours renouvelable.

## Décision

**Deux ans au plus par demande, renouvelable.** Le type « Disponibilité »
se pose avec deux ans dans une nouvelle organisation. La migration 0130 le
passe de trois à deux ans dans les organisations existantes, là où il a
gardé les trois ans posés par la migration 0120 ; une durée que la DCH a
changée reste la sienne. Le tableau des types écrit « 2 ans
renouvelable », et l'agent demande le renouvellement pour un an ou deux.

**Les documents suivent la même borne.** Mise en disponibilité : la date
limite de reprise vient au plus deux ans après la prise d'effet, le même
jour ; prise d'effet le 10 octobre 2026, reprise le 10 octobre 2028 au
plus tard. Renouvellement : la prorogation va de un à vingt-quatre mois, et
la reprise vient au plus deux ans après le lendemain de la période
initiale. Reprise après disponibilité : le dernier jour vient au plus tard
la veille du même jour, deux ans après le premier, du 2 janvier 2026 au
1er janvier 2028. Au-delà, la fiche dit « La disponibilité ne peut pas
dépasser deux ans », ou « La prorogation ne peut pas dépasser deux ans ».

## Conséquences

- `DISPONIBILITE_ANS_MAX` (contrat) passe à 2 : le type posé d'office, les
  règles des fiches et l'attestation de reprise le lisent.
- Les demandes déjà faites ne bougent pas : une disponibilité de trois ans
  déjà accordée va à son terme, et son renouvellement se demande pour deux
  ans au plus. L'attestation de reprise, elle, ne porte plus que deux ans.
- La DCH règle toujours la durée du type dans « Paramètres des absences »,
  de un à dix ans ; les documents gardent la borne de deux ans, comme ils
  gardaient celle de trois.
