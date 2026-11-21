# ADR-0150 : Les champs de la grille d'évaluation en texte mis en forme, leurs échéances et les formations de l'APIX Academy

**Statut** : acceptée · 2026-10-26 · remplace en partie l'ADR-0149

## Contexte

La grille du personnel cadre (ADR-0149) se remplissait en texte brut : des
zones de texte, un « Délai » écrit librement pour chaque objectif à venir,
trois formations écrites à la main. Le N+1 veut écrire comme dans l'éditeur
des anciennes fiches d'objectifs : du gras, de l'italique, des listes ; fixer
une échéance à chaque objectif à venir ; choisir les formations dans le
catalogue de l'APIX Academy.

## Décision

**Un texte mis en forme, gardé dans un format à nous.** Les champs longs de
la grille s'écrivent dans BlockNote, restreint : du gras et de l'italique ;
des puces et des numéros là où le champ les admet, deux crans d'imbrication
au plus. Ni titre, ni lien, ni souligné, ni couleur, ni image : un collage
n'en garde rien. La base ne garde pas le document de BlockNote, mais le
« texte riche » des contrats (`texte-riche.ts`) : des blocs (paragraphe,
puce, numéro), leur niveau, et leurs segments en gras ou en italique. Le PDF
imprime ce format et l'écran le relit : l'éditeur peut changer sans toucher
aux grilles déjà remplies. Une grille d'avant, en texte brut, se relit :
chaque ligne y devient un paragraphe.

| Champ                                                                   | Puces et numéros |
| ----------------------------------------------------------------------- | ---------------- |
| Les trois objectifs de l'année écoulée                                  | non, texte seul  |
| Les raisons, les points forts et faibles, les actions, les observations | oui              |

**La case de l'objectif.** À gauche de chaque objectif de l'année écoulée,
une case. Elle ne se coche pas : le niveau donné à l'objectif la remplit, à
sa couleur.

**Les couleurs des niveaux, à l'écran seulement.** A vert, B jaune tirant sur
le vert, C orange tirant sur le jaune, D rouge, en teintes claires, de jour
comme de nuit (jetons `niveau-a` à `niveau-d`). Le PDF reste en noir.

**Les objectifs à venir.** Une liste à puces, comme celle des anciennes
fiches : chaque objectif sur une ligne, avec son échéance, facultative,
choisie d'aujourd'hui au 31 décembre de l'année qui suit la grille. La liste
se range par échéance, la plus proche en tête. Quatre objectifs au plus : les
quatre lignes du modèle. Le PDF imprime l'échéance en lettres, sous
« ÉCHÉANCES » au lieu de « DÉLAIS ».

**Les besoins de formation.** Ils se choisissent d'un clic dans le catalogue
de l'APIX Academy : les formations publiées, sans celles que l'agent a
terminées ou obtenues, ni celles que l'agent anime. Trois au plus : les trois
lignes du modèle. La grille garde le titre de chaque formation demandée : le
PDF l'imprime tel quel, même si la formation quitte le catalogue.

**« Contenu et justification » disparaît** des actions pour améliorer les
performances, à l'écran comme sur le PDF : le champ reste seul sous son
titre.

## Conséquences

- BlockNote revient sur le site, que l'ADR-0149 lui avait fait quitter :
  chargé à la demande, sur la page où le N+1 remplit la grille.
- Pas de migration : la grille reste un document JSON
  (`evaluation_grilles.contenu`), lu par le schéma des contrats, qui accepte
  l'ancien format. Une formation écrite à la main dans une grille d'avant ne
  se garde pas.
- Chaque champ garde sa longueur maximale, retours à la ligne compris.
  L'écran la compte ; au-delà, le champ passe au rouge et la grille ne
  s'enregistre pas. Sur le PDF, un texte long s'imprime plus petit, et une
  liste plus longue que ses lignes s'y resserre.
