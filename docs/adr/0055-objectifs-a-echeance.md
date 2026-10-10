# ADR-0055 : Objectifs à échéance, rangés dans l'évaluation où ils comptent

**Statut** : acceptée · 2026-10-10

## Contexte

Le n+1 fixait les objectifs d'un semestre choisi dans un menu (Semestre 1,
Semestre 2), sans échéance (ADR-0026, ADR-0051). Un objectif ponctuel a
pourtant sa date, et c'est elle qui dit à quelle évaluation il compte. La
DCH fixe les deux jours d'évaluation de l'année (ADR-0054).

## Décision

**L'échéance range l'objectif.** Chaque objectif a une échéance,
obligatoire. Il compte pour la première évaluation qui tombe le jour de son
échéance ou après : avec les jours par défaut, une échéance entre le
1er janvier et le 30 juin compte pour l'évaluation du 30 juin (S1), une
échéance entre le 1er juillet et le 31 décembre pour celle du 31 décembre
(S2). Une échéance après la dernière évaluation de l'année compte pour le
S1 de l'année suivante. Le n+1 ne choisit plus le semestre.

**Un objectif atteint en avance compte pour l'évaluation de son échéance.**
Pas de rubrique « En avance » : l'agent donne son statut à tout moment, la
période de l'objectif ne bouge pas.

**La règle se lit là où l'on fixe une échéance**, en avertissement, avec
les jours que la DCH a fixés : dans la fenêtre « Fixer des objectifs » et
dans une fiche ouverte au crayon.

**« Fixer des objectifs » ouvre une fenêtre** : une ligne par objectif, son
texte et son échéance. Entrée ouvre une ligne dessous, à la même échéance.
Le serveur range chaque objectif dans la fiche de son évaluation, et
prévient l'agent pour chaque fiche qui en reçoit.

**Les objectifs d'une fiche se lisent par échéance**, de la plus proche à
la plus lointaine ; à échéance égale, dans l'ordre où ils ont été fixés. Un
objectif fixé après les autres passe devant s'il arrive plus tôt.

**Dans une fiche ouverte au crayon**, chaque objectif a son texte et son
échéance. Une échéance changée pour une autre période fait partir
l'objectif dans la fiche de sa nouvelle évaluation, avec son statut et ce
que l'agent et le n+1 en ont dit ; vers une autre année, la fiche le dit.

**Bornes.** Une échéance nouvelle ou changée ne se fixe pas dans le passé,
ni au-delà de la dernière évaluation de l'année suivante. Une fiche dont
l'auto-évaluation est envoyée ne reçoit plus rien. Une fois sa date
d'évaluation passée, les échéances de ses objectifs ne changent plus : on
ne repousse pas une échéance pour sortir un objectif de l'évaluation. Le
texte se corrige encore, tant que l'auto-évaluation n'est pas envoyée.

**La DCH déplace une date : les objectifs à venir suivent.** Chaque
objectif dont l'échéance n'est pas passée rejoint la fiche de l'évaluation
où il compte désormais, avec son statut et ses commentaires. Ce qui est
passé reste où il est ; une fiche envoyée ne perd ni ne reçoit rien.
Personne n'est prévenu : aucun objectif ne change.

**Sans migration.** Les fiches restent dans `objectifs_fiches`. L'échéance
est dans le bloc de l'objectif (`props.echeance`, date ISO). Une case fixée
avant les échéances n'en a pas à elle : elle vaut la date d'évaluation de
sa fiche, et la suit si la DCH la déplace. La coche ne se garde plus dans
le bloc : c'est le statut donné par l'agent qui la pose, à la lecture.

## Conséquences

- L'API ajoute `POST /objectifs/equipe/:employeeId/objectifs` ;
  l'enregistrement d'une fiche rend les fiches qu'il a écrites. Les
  lectures portent les jours d'évaluation (`joursEvaluation`).
- Le menu Semestre 1 / Semestre 2 disparaît (ADR-0051). La liste des
  objectifs n'est plus un éditeur BlockNote ; le commentaire le reste
  (ADR-0026).
- Les objectifs fixés pendant qu'une fiche est ouverte au crayon s'ajoutent
  à son enregistrement, sans se perdre.
- Restent à venir : l'ouverture de l'auto-évaluation peu avant la date
  d'évaluation, les échéances des formations à suivre, les rappels, et des
  raccourcis de date (fin de mois, fin de trimestre, prochaine évaluation).
