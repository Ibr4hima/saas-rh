# ADR-0178 : Les services se rangent sous un département ; le N+1 d'office est le chef de l'unité

**Statut** : acceptée · 2026-11-06 · précise les [ADR-0034](0034-n-plus-un-des-chefs-d-unite.md) et [ADR-0159](0159-l-import-lit-le-fichier-de-la-dch.md), remplace en partie l'[ADR-0035](0035-releve-d-un-chef-et-stagiaires.md)

## Contexte

L'import du fichier du personnel construit l'organigramme à partir des
postes (ADR-0159) : « Chef de service X » crée le service sous le département
que nomme la ligne, sinon sous la direction. Le fichier de la DCH ne nomme
pas le département d'un chef de service : dans une direction qui compte des
départements, les services se retrouvaient à côté d'eux, sous la direction,
et leurs chefs relevaient du directeur.

Le N+1 d'office restait le directeur (ADR-0035) : sans N+1, un agent relevait
du responsable de sa direction, même dans un service qui a son chef. À
l'APIX, un agent relève d'abord du chef de son unité.

## Décision

**Dans une direction qui compte des départements, un service se range sous
l'un d'eux.** L'import retient le département que nomme la ligne, sinon le
seul que compte la direction. Avec deux départements ou plus, l'aperçu
demande sous lequel ranger chaque service, et « Importer » attend la
réponse. Une direction sans département garde ses services. Au réimport, un
service qu'un import précédent a laissé sous la direction se range de la
même façon ; un service créé à la main reste où la DCH l'a mis. Le chef du
service relève alors du chef du département (ADR-0034) : un autre N+1 écrit
dans le fichier est corrigé, et l'aperçu le montre.

**Le N+1 d'office est le responsable de son unité.** Sans N+1, un agent
relève du chef de son service, sinon du chef du département au-dessus,
sinon du directeur, et du DG à la Direction Générale. La fiche le propose à
la création, l'import et les cascades l'appliquent. L'import ne place que
les chefs dans les services : la DCH y affecte ensuite les membres.

**Un N+1 d'office suit l'organigramme ; un N+1 choisi reste.** L'agent qui
relevait de son N+1 d'office, de personne, ou du DG en attendant une tête,
prend le nouveau N+1 d'office quand un chef est désigné sur son unité, quand
son unité est rattachée ailleurs, ou quand une mutation le change d'unité,
même dans sa direction (motif `responsable_de_son_unite`). Un chef retiré
sans successeur garde son équipe (ADR-0035).

## Conséquences

- L'aperçu de l'import gagne « Services à rattacher », une question par
  service, et « Services à déplacer », ceux de l'organigramme qu'il range
  sous un département. `POST /employees/import` reçoit le paramètre
  `rattachements`.
- Les rattachements en place ne changent pas d'eux-mêmes : un membre de
  service qui relève aujourd'hui du directeur le garde, et la DCH le change
  sur sa fiche.
- Une unité déplacée vers une autre direction emmène le N+1 d'office de ses
  agents ; un N+1 choisi dans l'ancienne direction reste à revoir, et
  l'aperçu le dit.
