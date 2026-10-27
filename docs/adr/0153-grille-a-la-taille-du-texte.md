# ADR-0153 : La grille à la taille de ce qui s'y écrit : objectifs et besoins en nombre libre

**Statut** : acceptée · 2026-10-26 · remplace en partie l'[ADR-0149](0149-evaluation-sur-la-grille-de-l-apix.md) et l'[ADR-0150](0150-grille-en-texte-mis-en-forme.md)

## Contexte

La grille du personnel cadre reprenait les lignes du modèle de l'APIX : trois
objectifs de l'année écoulée, trois formations prises au seul catalogue de
l'APIX Academy (ADR-0150), et un PDF de six pages qui gardait les pointillés
de chaque ligne, même remplie (ADR-0149). L'APIX veut une grille qui suive ce
que le N+1 écrit : autant d'objectifs et de besoins qu'il en faut, un PDF
taillé à ce qui est rempli, bien aéré.

## Décision

**Les objectifs de l'année écoulée, en nombre libre.** La grille s'ouvre sur
« Objectif 1 » ; « Ajouter un objectif » en ajoute un autre, dix au plus.
Chacun se retire, sauf le seul qui reste ; un objectif resté vide ne se
garde pas. Une grille neuve reprend autant d'objectifs que la précédente
fixait d'objectifs à venir.

**Les besoins de formation, au catalogue ou non.** « Ajouter un besoin »
ouvre un champ qui propose les formations de l'APIX Academy (ADR-0150) et
prend aussi, telle qu'elle s'écrit, une formation hors du catalogue. Dix au
plus. Le titre de la section s'accorde : « Besoin de formation identifié »
quand il n'y en a qu'un. Une formation écrite à la main dans une grille
d'avant le catalogue devient un besoin.

**Des puces seulement** pour les points forts, les points faibles et les
actions pour améliorer les performances. Vide, le champ montre une puce
grisée, qui ne s'enlève pas ; chaque ligne en est une. Un paragraphe ou un
numéro y devient une puce.

**Les objectifs de travail pour la période à venir sont obligatoires** : un
au moins pour envoyer la grille à l'agent. À l'écran, une case devant
chacun, qui ne se coche pas ; sur le PDF, une puce.

**Le bouton d'ajout.** Un cadre en pointillés sur toute la largeur, comme
celui de plateforme-apix, pour les objectifs de l'année écoulée, les
objectifs à venir et les besoins de formation.

**Le PDF à la taille de ce qui est écrit.**

| Partie                   | Sur le PDF                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Le rappel des objectifs  | Une ligne de la grille A à D par objectif, haute de son texte ; une page de suite, sous le même titre, s'il le faut |
| Les raisons              | Sous les objectifs, s'il y en a à donner                                                                            |
| Les besoins de formation | Une ligne chacun ; la ratification les suit                                                                         |
| Les objectifs à venir    | Une puce chacun, l'échéance en face                                                                                 |

Un champ rempli s'imprime sans pointillés ; un champ vide garde les siens, à
remplir à la main. Les pages se numérotent sur leur total : « Page 3 sur 7 ».

## Conséquences

- Pas de migration : la grille reste un document JSON
  (`evaluation_grilles.contenu`). Une grille déjà enregistrée se relit : ses
  objectifs vides tombent, ses points forts et faibles et ses actions passent
  en puces.
- Le PDF n'a plus toujours six pages : dix objectifs longs en demandent une
  septième.
- Un besoin hors du catalogue n'a pas de formation de l'Academy
  (`courseId` nul) : il se lit, il ne s'ouvre pas.
- Les objectifs à venir restent quatre au plus, les quatre lignes du modèle.
