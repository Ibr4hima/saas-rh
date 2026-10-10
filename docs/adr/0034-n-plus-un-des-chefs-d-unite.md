# ADR-0034 : Le chef d'un département ou d'un service relève de l'unité au-dessus

**Statut** : acceptée · 2026-10-08

## Contexte

La règle de direction (ADR-0013) laisse choisir le n+1 de tout agent parmi
les personnes de sa direction. Dans l'organisation réelle, un agent peut
relever d'une personne d'un autre service ou d'un autre département de la
même direction : cette souplesse reste. Mais rien ne tenait la chaîne des
responsables : nommé chef d'un département, un agent gardait le n+1 qu'il
avait, parfois la personne qu'il remplaçait.

## Décision

**Le n+1 d'un chef ne se choisit pas.** Le responsable d'un département
relève du directeur de sa direction, celui d'un service rattaché à la
direction aussi. Celui d'un service rattaché à un département relève du
chef de ce département. Une unité au-dessus sans responsable renvoie au
niveau suivant, et le DG couvre une direction qui attend sa tête, comme pour
ses agents.

**La règle s'applique d'elle-même quand l'organigramme bouge.** Une
désignation, un responsable retiré, une unité rattachée ailleurs, un
responsable qui reprend son unité à son retour : chaque chef dont le
supérieur change passe sous le nouveau, et l'opération l'annonce avec les
autres rattachements (motif `chef_d_unite`). Un chef désigné par une
nouvelle affectation n'a pas de n+1 à choisir.

**Elle se vérifie partout.** La fiche refuse un autre n+1 pour un chef
(`people.chef_mal_rattache`) et ne propose que le bon. Le contrôle de la
chaîne signale un chef mal rattaché (`chef_mal_rattache`), sans bloquer
l'évaluation.

**Les autres agents restent libres** dans leur direction, ce que la règle
de direction garantit déjà. Un directeur relève du DG, le DG de personne.

## Conséquences

- La personne remplacée à la tête d'une unité garde son n+1, et son équipe
  le sien : tous restent libres dans la direction.
- Un rattachement faux d'avant la règle, que l'opération ne touche pas,
  n'est pas corrigé en silence : le contrôle le signale.
- Le n+1 d'office d'un agent qui n'en a pas reste le responsable de sa
  direction ; pour un chef, c'est le responsable de l'unité au-dessus.
