# ADR-0033 : La fonction de responsable s'écrit dans les affectations

**Statut** : acceptée · 2026-10-08

## Contexte

Désigner le responsable d'une unité ne changeait que l'organigramme. La
fiche de l'agent continuait de dire son ancien poste (« Chargé d'études,
Département Études, depuis le 1er juin 2023 ») alors que l'agent
dirigeait l'unité, et la personne remplacée gardait son intitulé. ADR-0013 pose
« d'abord l'affectation, ensuite la hiérarchie » : il fallait muter
l'agent, puis le désigner, en deux gestes.

## Décision

**La désignation s'écrit dans les affectations.** À la tête d'une unité,
l'agent y prend le poste de responsable à compter de sa prise de fonction.
Si ce jour est celui où commence son affectation en cours, elle est
remplacée : la fonction commence avec l'affectation. Sinon, elle s'arrête
la veille et l'affectation de responsable commence ce jour-là. Le jour se
choisit entre le début de son affectation en cours et aujourd'hui ;
aujourd'hui par défaut.

**L'intitulé s'écrit tout seul** (`posteDeResponsable`) : « Directeur de la
DGT » ou « Directrice de la DGT » pour une direction, « Directeur général »
ou « Directrice générale » au sommet, « Chef du département Études » ou
« Cheffe du service Comptabilité » plus bas. Genre inconnu : « Responsable
de la DGT ».

**La personne remplacée reçoit son nouveau poste, le même jour,** dans son
unité. La passation ne se date pas avant le début de son affectation en
cours. Retirer le responsable sans successeur suit la même règle. Une
personne partie, ou dont le contrat est arrivé à terme, ne reçoit rien :
ses affectations restent telles quelles.

**Une nouvelle affectation peut désigner le responsable.** L'unité se
choisit d'abord ; la case « Désigner comme responsable » remplace le poste
saisi par celui de responsable. La mutation et la désignation ne font
qu'un geste, avec les règles et les cascades de l'organigramme. Elle se
date au plus tard aujourd'hui, demande l'habilitation de l'organigramme
(la DCH reste à l'administrateur) et refuse qui dirige déjà une autre
unité. Le n+1 d'un futur directeur ne se choisit pas : c'est le DG.

**L'affectation de responsable est marquée** (`assignments.responsable`,
migration 0097). Tant que l'agent dirige l'unité, elle ne s'annule pas :
on désigne d'abord une autre personne à sa place.

**Une affectation déjà programmée bloque la désignation** : elle ferait
quitter le poste de responsable à sa date, sans personne pour le reprendre.

## Conséquences

- Les affectations d'avant la règle ne sont pas marquées : les responsables
  en place gardent leur intitulé, et la prochaine passation demande leur
  nouveau poste. Leur redonner le même, dans la même unité, ne change rien.
- La date ne vaut que pour les affectations : le responsable de l'unité,
  les n+1 et le circuit des demandes changent le jour de l'enregistrement,
  comme avant.
- Un changement de type d'unité, un départ, un nouveau contrat ou une
  dissolution ne réécrivent pas les intitulés.
