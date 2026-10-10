# ADR-0038 : Ce que devient le responsable remplacé

**Statut** : acceptée · 2026-10-08

## Contexte

La fonction de responsable s'écrit dans les affectations (ADR-0033). Quand
un autre prenait la tête d'une unité, ou qu'on la retirait à son
responsable, celui-ci recevait un nouveau poste, toujours dans la même
unité. Or il peut tout aussi bien quitter l'APIX, changer d'unité ou de
direction, ou prendre la tête d'une autre unité. Faits en deux temps, les
gestes se bloquaient l'un l'autre : on ne désactive pas qui dirige une
unité, on ne mute pas un responsable hors de l'unité qu'il dirige.

## Décision

**Le devenir de l'ancien responsable se décide avec la passation**, depuis
l'organigramme comme depuis une nouvelle affectation à la tête de l'unité,
dans la même opération (`devenirDeLAncien`) :

- il **reste dans l'unité**, au poste qu'on dit, et relève du nouveau, comme
  avant ;
- il **change d'affectation** : une autre unité, de sa direction ou d'une
  autre, au poste qu'on dit. Son n+1 est celui d'office à sa nouvelle place,
  choisi s'il change de direction ;
- il **prend la tête d'une autre unité** : il y est affecté et désigné, avec
  les règles de toute désignation. Celui qu'il y remplace y reste, au poste
  qu'on dit ;
- il **quitte l'APIX** : son dossier devient inactif, avec le motif et son
  dernier jour, au plus tard le jour de la passation et pas avant le début
  de son poste.

**Son équipe passe d'abord au nouveau** (ADR-0035, ADR-0037), puis il part :
elle ne le suit pas. Sans successeur, celle qu'il garde remonte d'un cran, à
son propre n+1, quand elle ne peut pas le suivre.

**Tout ou rien** : un refus (dernier administrateur, date hors de son poste,
unité réservée à l'administrateur) n'écrit ni la passation ni le devenir.
L'aperçu de l'organigramme joue l'ensemble.

## Conséquences

- L'organigramme et la nouvelle affectation, devenue une fenêtre comme le
  nouveau contrat, posent la même question : « Que devient X ? ».
- Celui que l'ancien remplace à la tête d'une autre unité ne reçoit qu'un
  poste dans son unité ; l'envoyer ailleurs est une seconde opération.
- Deux responsables ne s'échangent pas leurs unités en une opération : l'un
  prend la tête de l'unité de l'autre, puis l'autre est désigné depuis sa
  fiche.
