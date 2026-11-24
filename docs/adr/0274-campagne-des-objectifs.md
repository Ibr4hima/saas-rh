# ADR-0274 : La fixation des objectifs, une campagne à part, en début d'année

**Statut** : acceptée · 2026-11-24 · complète l'[ADR-0222](0222-administration-de-la-campagne.md) et l'[ADR-0272](0272-evaluation-sans-objectifs-a-venir.md), révise l'[ADR-0262](0262-aide-a-la-redaction-des-objectifs.md)

## Contexte

L'APIX sépare l'évaluation, en fin d'année, de la fixation des objectifs,
en début d'année suivante (ADR-0272). À la fin de l'évaluation, les fiches
sont verrouillées (ADR-0273). Ensuite s'ouvre la fixation des objectifs :
toute personne qui a une équipe fixe les objectifs de chaque agent sous sa
responsabilité, et chaque agent retrouve dans son portail son évaluation et
ses objectifs. Pendant l'évaluation, rien n'annonce cette seconde
campagne.

Les choix de l'APIX : les dates font passer d'une campagne à l'autre ; le
N+1 de l'organigramme fixe les objectifs, pas l'évaluateur choisi pour
l'évaluation ; l'agent lit ses objectifs une fois transmis, jamais le
brouillon.

## Décision

**L'année des objectifs suit celle de l'évaluation.** Avec
`CAMPAGNE_D_EVALUATION=2026`, c'est la fixation des objectifs de 2027.

**Ses dates se fixent dans l'administration**, sous celles de
l'évaluation : « Dates de la fixation des objectifs 2027 », le début et la
fin de la période (`PUT /v1/campagne/administration/dates-des-objectifs`,
table `objectifs_periodes`, migration 0145). La période commence en 2027
(422, `campagne.dates_hors_annee`) et après la fin de l'évaluation de 2026
(422, `campagne.objectifs_avant_la_fin`). À l'inverse, l'évaluation ne peut
plus finir après le début de la fixation des objectifs (422,
`campagne.evaluation_apres_les_objectifs`).

**Avant le début de la période, rien.** L'accueil n'en dit rien
(`objectifs` à `null`) et la page des objectifs d'un agent répond 404,
`campagne.objectifs_introuvables`.

**La période ouverte, l'accueil** place deux sections devant celles de
l'évaluation :

- « Mes objectifs 2027 », pour tout agent de la campagne qui a un N+1
  dans l'organigramme : les objectifs transmis, en lecture (objectif,
  indicateur de réussite, échéance), avec le nom du N+1 et le jour de la
  transmission.
  Avant : « Vos objectifs ne vous ont pas encore été transmis. » La période
  finie sans transmission : « Aucun objectif ne vous a été transmis. »
- « Objectifs 2027 de mon équipe », pour qui a une équipe dans
  l'organigramme : une carte par agent de la campagne (ni le sommet de
  l'organigramme, ni les stages), en deux groupes comme « Mon équipe »
  (ADR-0253) : « Objectifs à fixer », point rouge, puis « Objectifs
  transmis », point vert. Le repère « Objectifs » de la carte dit « À
  fixer », « En cours » ou « Transmis le 12 janv. ».

**La page des objectifs d'un agent**, `/evaluation-annuelle/objectifs/{agent}`,
ne s'ouvre qu'au N+1 de l'agent dans l'organigramme (404,
`campagne.agent_hors_equipe`). Sous le bandeau de l'agent, « Objectifs
2027 » : de trois à cinq lignes (ADR-0239), chacune avec l'objectif,
l'indicateur de réussite et l'échéance, dans l'année, les trois
obligatoires. À côté du titre, l'aide « Comment définir des objectifs ? »
(ADR-0262) ; à droite, la période. Chaque modification s'enregistre en
brouillon (`PUT /v1/campagne/objectifs/equipe/:employeeId`). « Transmettre
à l'agent » s'active une fois tout rempli, et la fenêtre de confirmation
dit : « Les objectifs 2027 seront transmis à [agent]. Ils ne pourront plus
être modifiés. » (`POST …/transmission`). Incomplets, ils ne partent pas :
422, `campagne.objectifs_incomplets`, avec ce qui manque.

**Transmis, ils deviennent les objectifs de la fiche de 2027**, avec leur
échéance : la fiche que l'évaluation de fin 2027 reprendra. Ils ne changent
plus (409, `campagne.objectifs_transmis`). La fiche garde aussi le
brouillon du N+1 (`objectifs_brouillon`), son auteur et le moment de la
transmission.

**Après la fin de la période**, tout se lit et rien ne s'écrit (409,
`campagne.objectifs_fermes`). Repousser la date de fin rouvre la saisie.

## Conséquences

- Le N+1 qui fixe les objectifs peut différer de l'évaluateur choisi pour
  l'évaluation : quand l'administration a confié l'évaluation d'un agent à
  une autre personne, les objectifs viennent toujours du N+1.
- Des objectifs non transmis à la fin de la période restent au brouillon du
  N+1, que l'agent ne lit pas.
- Passer `CAMPAGNE_D_EVALUATION` à 2027 ouvre l'évaluation de 2027 : ses
  fiches portent les objectifs transmis, et la fixation suivante sera celle
  de 2028.
- La règle des trois à cinq objectifs (ADR-0239) et l'aide à leur rédaction
  (ADR-0262), retirées de l'évaluation (ADR-0272), servent ici.
