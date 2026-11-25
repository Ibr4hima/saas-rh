# ADR-0043 : Suivi des demandes de documents : en cours, puis traitées

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0042](0042-demandes-effacees-et-consultees.md)

## Contexte

Le suivi de l'agent mêlait dans un seul tableau ce qui attend encore la DCH
et ce qu'elle a fini de traiter. L'espace RH sépare déjà sa file : « Demandes
à traiter », puis « Demandes traitées », pliées par défaut.

## Décision

**Le suivi se lit en deux cartes, comme l'espace RH.** « Demandes en cours »
(reçues, en cours de traitement), puis « Demandes traitées » (prêtes,
remises, refusées), pliée par défaut. Chacune porte son nombre et sa
pagination ; dans chacune, la demande la plus récente vient en tête.

**Chaque carte n'a que les colonnes qui lui servent.** Document, Demandée le
et Statut, de même largeur dans les deux cartes : les colonnes de l'une
tombent sous celles de l'autre. Puis « Annuler » pour une demande en cours,
et « État traitement » pour une demande traitée. Une demande en cours n'a
pas d'état de traitement à dire : la colonne y resterait vide.

**« Consulter » est un bouton sans icône.**

## Conséquences

- Les quatre colonnes de l'ADR-0042 deviennent celles de la carte des
  demandes traitées.
- Un document qui vient d'être déposé se trouve dans la carte pliée : l'avis
  qui l'annonce mène au suivi, où un clic la déplie.
