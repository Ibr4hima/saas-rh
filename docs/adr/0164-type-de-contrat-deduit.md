# ADR-0164 : Un type de contrat vide se déduit de la date de fin

**Statut** : acceptée · 2026-11-02

## Contexte

L'import ne créait de contrat que pour une ligne qui en donnait le type
(ADR-0159). Un fichier dont la colonne « Type de contrat » est vide donnait
donc des fiches sans contrat. Or l'ancienneté se compte sur le contrat en
cours (ADR-0083) : le tableau de bord affichait « Aucune » et les fiches
restaient sans ancienneté. Les documents réservés aux CDI et aux CDD ne
trouvaient personne non plus.

## Décision

**Un type de contrat vide se déduit de la date de fin.** La DCH ne tient
que des CDI et des CDD (ADR-0159), et la colonne « Date de fin (si CDD) » ne
se remplit que pour un CDD. Avec une date de fin, la ligne reçoit un CDD
jusqu'à cette date ; sans date de fin, un CDI depuis la date d'entrée.
L'aperçu montre la déduction sur la ligne (« Type de contrat : case vide →
CDI, sans date de fin »).

**Le réimport donne son contrat à une fiche qui n'en a pas**, comme avant
(ADR-0159) : relancer le fichier après un import sans contrats complète
les fiches, et l'aperçu liste « Contrat : CDI » sur chacune.

## Conséquences

- Un type que l'import ne prend pas (stage, consultant) reste signalé sur
  sa ligne, et la fiche reste sans contrat, comme avant.
- L'ancienneté apparaît sur la fiche et au tableau de bord dès que le
  contrat existe.
