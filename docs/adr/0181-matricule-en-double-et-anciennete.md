# ADR-0181 : Un matricule en double : 50A et 50B, la lettre selon l'ancienneté

**Statut** : acceptée · 2026-11-07 · précise l'[ADR-0159](0159-l-import-lit-le-fichier-de-la-dch.md)

## Contexte

Le fichier de la DCH donne parfois le même matricule à deux personnes.
L'import leur attribue un matricule provisoire, 50-A et 50-B (ADR-0158,
ADR-0159), dans l'ordre des lignes du fichier. La DCH veut que la lettre
dise qui est entré le premier, et des matricules écrits sans tiret.

## Décision

**La lettre suit l'ancienneté : A pour la personne entrée la première**,
puis B, C. L'ancienneté se lit à la date d'entrée, ou au mois que donne
l'ancienneté quand le fichier n'a pas la date. À la même date d'entrée,
l'ordre du fichier départage.

**Le matricule provisoire s'écrit sans tiret : 50A, 50B.** Une lettre qui
donnerait le matricule d'une autre personne, sur la plateforme ou dans le
fichier, est sautée.

Au réimport, une fiche provisoire garde sa lettre ; une nouvelle ligne au
même matricule prend la lettre libre suivante.

## Conséquences

- La migration 0131 réécrit les matricules provisoires déjà importés : 50-A
  devient 50A, et les lettres d'un même matricule passent dans l'ordre de
  l'ancienneté. Quand 50A est déjà le matricule d'une autre personne, ce
  matricule garde ses fiches telles quelles, à corriger sur la fiche.
- Le réimport reconnaît encore une fiche provisoire écrite 50-A.
