# ADR-0053 : Deux dates d'évaluation par an, fixées par la DCH

**Statut** : acceptée · 2026-10-10

## Contexte

Les notes de A à D se donnent deux fois par an, sur les objectifs de chaque
semestre. Rien ne disait encore quand. La page « Évaluation des objectifs »
de l'espace DCH n'annonçait qu'un module à venir.

## Décision

**Deux dates par an, une par semestre.** Par défaut, le 30 juin pour le 1er
semestre et le 31 décembre pour le 2nd. Elles se lisent sur la page
« Évaluation des objectifs », dans la carte de tête de « Poser une
demande » : « Évaluations 2026 », la prochaine évaluation, puis les deux
dates.

**Seule la personne qui dirige la DCH les déplace**, au crayon de la carte,
pour l'année en cours ou la suivante. Les deux dates s'enregistrent
ensemble : le 1er semestre s'évalue avant le 2nd, et l'ordre se juge sur les
nouvelles dates. Une évaluation passée ne bouge plus, une date ne se fixe pas
dans le passé, et chaque date tombe dans son année.

**Une ligne par date déplacée** (`objective_review_dates` : année, semestre,
RLS et journal d'audit). Sans ligne, la date par défaut vaut : changer la
règle par défaut ne demanderait aucune reprise de données.

**La page montre l'année de la prochaine évaluation** : l'année en cours
tant qu'une de ses dates reste à venir, la suivante ensuite.

## Conséquences

- Qui a l'habilitation « Pilotage » sans diriger la DCH (l'administrateur,
  un délégué) voit la page, sans le crayon.
- Les dates ne déclenchent encore rien : ni rappel, ni ouverture des
  évaluations. Les étapes suivantes s'appuieront sur elles.
- Le composant « Module à venir », qui n'habillait plus que cette page, est
  retiré.
