# ADR-0076 : Évaluation annuelle, la coche de l'agent et l'atteinte retenue par le n+1

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0075](0075-objectifs-annuels.md) : la fiche reste une par an ;
ce qui change, c'est ce que chacun y fait au fil de l'année, puis à
l'évaluation.

## Contexte

L'agent disait où en était chaque objectif (atteint, partiellement, non
atteint) dans un panneau « Auto-évaluation » ouvert toute l'année, et
l'envoyait au moment de son choix ; envoyée, la fiche ne bougeait plus. Le n+1
commentait, puis donnait une note de A à D, seule trace de son jugement.
Avec une fiche par an, une auto-évaluation envoyée en mars figerait
l'année ; et une note donnée sans dire ce qui est atteint ne se justifie
pas.

## Décision

**En cours d'année, l'agent coche.** Un objectif terminé se coche d'un clic,
sur la fiche même ; décoché, il redevient à faire. Le n+1 voit la coche et
en reçoit l'avis, retiré si l'agent décoche.

**Le n+1 rouvre un objectif en changeant son échéance.** Devant des
manques, le n+1 donne une autre échéance à l'objectif coché, ou la retire : la
coche s'en va, ce que l'agent en a écrit reste, et l'agent est prévenu, avec
la nouvelle date. Le commentaire de la fiche dit ce qui manque. Une fois le
jour de l'évaluation passé, les échéances ne changent plus (ADR-0075).

**L'auto-évaluation s'ouvre deux semaines avant le jour de l'évaluation**,
le 1er décembre pour le 15. Avant, l'agent ne fait que cocher, et la fiche
dit le jour de l'ouverture ; ce jour-là, chaque agent qui a des objectifs
en est prévenu. Ouverte, l'auto-évaluation se fait comme avant : pour chaque
objectif, atteint, partiellement ou non atteint, et un commentaire ; une
coche y vaut « atteint ». Elle reste obligatoire avant l'évaluation du n+1.
Déplacer le jour de l'évaluation déplace l'ouverture.

**Le n+1 marque chaque objectif** : atteint, partiellement ou non atteint, à
côté de ce qu'en dit l'agent. Une formation à suivre garde le statut que
lui donne l'APIX Academy. L'évaluation ne se valide pas tant qu'un objectif
n'est pas marqué.

**Reporter à l'année suivante.** Un objectif partiellement ou non atteint
peut être reporté : à la validation, il est recopié dans la fiche de
l'année suivante, sans échéance ; le n+1 lui en donne une s'il le faut. Non
reporté, il reste non atteint dans l'année évaluée. Un agent parti n'a rien
à reporter.

**La note se lit avec l'atteinte.** La note de A à D reste au choix du n+1,
sans plafond, mais ne s'affiche jamais seule : chez le n+1, chez l'agent et
dans le dossier que lit la DCH, chaque objectif apparaît avec son atteinte,
l'auto-évaluation de l'agent et son report éventuel, avec le décompte
(« 3 atteints », « 1 partiellement atteint »).

## Conséquences

- Migration 0112 : l'atteinte retenue par le n+1 (`atteintes_n1`) et les
  reports (`reports_n1`) sur chaque fiche. Une évaluation validée avant n'a
  pas d'atteinte par objectif : le dossier en montre les objectifs et
  l'auto-évaluation de l'agent, sans décompte.
- Avant l'ouverture, « partiellement » et « non atteint » se refusent, comme
  l'envoi de l'auto-évaluation. Une auto-évaluation envoyée avant ce
  changement le reste.
- Le sujet de notification du n+1 devient « Objectifs et auto-évaluations de
  mon équipe » : il porte aussi les objectifs cochés.
- Un objectif reporté garde son texte tel qu'écrit : une date qui y figure
  (« pour le 15 déc. 2026 ») y reste, au n+1 de la reprendre dans la fiche
  suivante.
