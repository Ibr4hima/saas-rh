# ADR-0136 : La disponibilité dure trois ans au plus : les décisions et l'attestation de reprise

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0133](0133-dates-des-fiches.md)

## Contexte

Une disponibilité dure trois ans au plus, et sa prorogation aussi
(ADR-0135). Les fiches des documents acceptaient pourtant des périodes
plus longues : une décision prenant effet le 10 octobre 2026 avec une
reprise le 10 octobre 2030, une attestation de reprise pour une
disponibilité de quatre ans.

## Décision

**Mise en disponibilité** : la date limite de reprise vient au plus trois
ans après la prise d'effet, le même jour. Prise d'effet le 10 octobre
2026 : reprise le 10 octobre 2029 au plus tard ; à partir d'un
29 février, le 1er mars. Au-delà, « La disponibilité dure trois ans au
plus ».

**Renouvellement** : la prorogation prend effet le lendemain de la
période initiale (ADR-0133) ; la reprise vient au plus trois ans après.
Au-delà, « La prorogation dure trois ans au plus ».

**Reprise après disponibilité** : le dernier jour de la disponibilité
vient au plus tard la veille du même jour, trois ans après le premier :
du 2 janvier 2026 au 1er janvier 2029. Au-delà, « La disponibilité dure
trois ans au plus ».

**À l'écran**, le calendrier de ces dates s'arrête à ce jour, et la règle
enfreinte se dit sous le champ, comme les autres (ADR-0133). Le serveur
applique les mêmes règles.

## Conséquences

- La durée de la prorogation, de un à trente-six mois, donne toujours une
  reprise dans la règle ; seule une reprise corrigée à la main peut la
  dépasser.
- Une disponibilité renouvelée ne s'atteste plus d'un seul tenant au-delà
  de trois ans : l'attestation de reprise porte la dernière période.
- Les règles vivent au contrat, dans les fonctions des dates croisées des
  fiches et des saisies, que l'écran appelle aussi.
