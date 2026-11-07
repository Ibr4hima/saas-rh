# ADR-0166 : « Mission » et « Absence ponctuelle » ne sont plus des types d'absence

**Statut** : acceptée · 2026-11-03

## Contexte

L'application posait d'office, dans chaque organisation, « Mission » et
« Absence ponctuelle » parmi les types d'absence (ADR-0032). L'APIX ne veut
pas de ces deux types dans ses listes.

## Décision

**Les deux types ne se posent plus d'office**, et ceux des organisations en
service se retirent (migration 0128), comme la DCH retire un type : les
demandes passées gardent leur intitulé. Un type qu'une demande en attente de
visa porte encore reste en service le temps qu'elle aboutisse ; la DCH le
retire ensuite dans les paramètres des absences.

**Ce qu'ils permettaient reste possible.** La DCH peut créer un type qui se
demande à l'heure, avec un plafond par demande (ADR-0032), ou un type qui
laisse l'agent joignable.

**Le justificatif s'appelle « Justificatif » pour tous les types** : le
formulaire de demande ne parle plus d'ordre de mission.

## Conséquences

- Les types posés d'office sont désormais le congé annuel, la maladie, la
  maternité, le sans solde et la disponibilité.
