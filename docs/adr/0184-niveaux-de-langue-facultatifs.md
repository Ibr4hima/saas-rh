# ADR-0184 : Les niveaux de langue d'une offre : sans « Notions », et facultatifs

**Statut** : acceptée · 2026-11-07 · remplace en partie l'[ADR-0182](0182-profil-de-l-offre.md)

## Contexte

L'ADR-0182 demandait, pour chaque langue cochée en plus du français, son
niveau à l'oral, à l'écrit et en compréhension, parmi Notions,
Intermédiaire, Courant et Bilingue, les trois obligatoires. La DCH retire
« Notions », et ne veut pas d'obligation de préciser les niveaux.

## Décision

**Les niveaux proposés sont Intermédiaire, Courant et Bilingue.**

**Chaque niveau se précise ou non.** Une langue cochée peut n'en porter
aucun, ou seulement ceux qui comptent pour le poste. « Choisir » se reprend
dans la liste pour retirer un niveau. L'offre et la page publique montrent
les niveaux précisés, et la langue seule quand aucun ne l'est.

Le reste de l'ADR-0182 tient : le français d'office, l'expérience pour le
poste.

## Conséquences

- Dans l'API, les trois niveaux d'une langue sont facultatifs ; « Notions »
  est refusé.
- Une offre enregistrée avec « Notions » le lit comme non précisé, sans
  migration : ses autres niveaux restent.
