# ADR-0126 : Le DGA se désigne à côté du DG ; son poste s'écrit au genre

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0033](0033-fonction-de-responsable.md), l'[ADR-0038](0038-devenir-de-l-ancien-responsable.md) et l'[ADR-0100](0100-decisions-de-disponibilite.md)

## Contexte

L'organigramme ne connaissait que le responsable de chaque unité ; au
sommet, le DG. La direction générale adjointe n'existait nulle part : ni
comme poste, ni dans la fiche de la Direction Générale, qui montrait
l'effectif et le responsable comme toute unité. Les décisions de
disponibilité visent pourtant la nomination de l'un et de l'autre. L'APIX
demande le poste de DGA, au genre, et une fiche de la Direction Générale
qui porte les deux places, chacune avec sa désignation.

## Décision

**La Direction Générale a sa place de DGA**
(`org_units.adjoint_employee_id`, migration 0117), au sommet seulement :
une contrainte la refuse à toute autre unité, et au DG.

**La fiche de la Direction Générale porte les deux places** : « Directeur
Général » ou « Directrice Générale », « Directeur Général Adjoint » ou
« Directrice Générale Adjointe », au genre de qui les occupe, à la place de
l'effectif et du responsable. Dessous, côte à côte, « Désigner un DG » et
« Désigner un DGA ». Une désignation à la fois : quand l'une change,
l'autre attend.

**Le DGA se désigne comme le DG** : un agent en activité, hors stage,
affecté à la Direction Générale, qui n'est pas le DG et ne dirige aucune
unité. La désignation s'écrit dans les affectations (ADR-0033) : son poste,
« Directeur général adjoint » ou « Directrice générale adjointe » (genre
inconnu : « Responsable adjoint·e de la DG »), à compter de sa prise de
fonction. La personne remplacée, ou retirée sans successeur, reste à la
Direction Générale à un poste qu'on dit, change d'affectation, prend une
autre responsabilité ou quitte l'APIX, comme un responsable remplacé
(ADR-0038). Le DGA relève du DG ; l'équipe de la personne remplacée passe
au nouveau DGA.

**Le DGA en place est en activité et affecté à la Direction Générale** :
parti, ou muté ailleurs, sa place est vacante, sans autre geste. Le DGA qui
prend la tête du sommet la libère.

**Les décisions de disponibilité accordent le visa de sa nomination** au
genre du DGA en place : « qui a nommé la Directrice Générale Adjointe
d'APIX-SA ». Vacante, la place garde le texte du modèle.

## Conséquences

- Le DGA se désigne depuis l'organigramme seulement : une nouvelle
  affectation à la Direction Générale ne le désigne pas.
- Les dates des sessions du conseil d'administration restent celles que
  propose l'ADR-0123 : la prise de fonction n'est pas la session qui nomme.
- Deux motifs de rattachement s'ajoutent : « prend la direction générale
  adjointe » et « relevait de qui occupait la direction générale adjointe ».
