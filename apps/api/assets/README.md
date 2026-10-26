# Ressources des documents générés

Servies au moteur PDF, jamais au web. Ce qui se dépose ici n'est pas versionné :
cela appartient à l'organisation, pas au logiciel.

Ce qui est propre à l'APIX sur ses documents ne se dépose pas : le bloc de la
République, en tête, et les mentions du pied de page sont composés en code
(`src/modules/documents/entete.ts`, ADR-0086), comme dans apix-e-voting.

## `logo-apix.png`

Le logo, posé dans le pied de page des documents de la DCH, à gauche de la
barre bleue, et sur les certificats de l'Academy. S'il est absent d'ici, le
générateur le cherche aussi dans `apps/web/public/logo-apix.png` : un seul
fichier suffit donc si le site et l'API sont déployés ensemble. Absent des
deux, le pied de page se dessine sans lui.

Format : PNG ou JPEG (pdfkit ne lit pas le SVG). Un logo détouré, sans marge
transparente, tombe juste contre la barre.

## Arial, Times New Roman, Comic Sans MS et Gill Sans MT : `arial*.ttf`, `times*.ttf`, `comic*.ttf`, `GIL*.TTF`

Les documents de la DCH sont en Arial (ADR-0090), ses contrats de travail en
Times New Roman (ADR-0098) ; certains modèles de l'APIX écrivent une ligne en
Comic Sans MS (le timbre des attestations) ; les grilles d'évaluation sont en
Gill Sans MT (ADR-0149). Leur licence (Monotype, Microsoft) interdit de les
versionner. Le générateur les prend là où la machine les a, dans cet ordre :

1. ici, déposées sous leur nom Windows (la casse ne compte pas) :

   | Police          | Romain         | Gras           | Italique       | Gras italique  |
   | --------------- | -------------- | -------------- | -------------- | -------------- |
   | Arial           | `arial.ttf`    | `arialbd.ttf`  | `ariali.ttf`   | `arialbi.ttf`  |
   | Times New Roman | `times.ttf`    | `timesbd.ttf`  | `timesi.ttf`   | `timesbi.ttf`  |
   | Comic Sans MS   | `comic.ttf`    | `comicbd.ttf`  | `comici.ttf`   | `comicz.ttf`   |
   | Gill Sans MT    | `GIL_____.TTF` | `GILB____.TTF` | `GILI____.TTF` | `GILBI___.TTF` |

2. sur le système : `C:\Windows\Fonts` sous Windows,
   `/System/Library/Fonts/Supplemental` sous macOS ; sous Debian ou Ubuntu,
   après `sudo apt install ttf-mscorefonts-installer`, le paquet officiel qui
   les télécharge chez Microsoft et en fait accepter la licence.

Sans elles, Arimo, Tinos et Comic Relief (`fonts/`), libres et dessinées aux
mêmes chasses, prennent leur place : un document sort avec la même mise en page, au
caractère près ; seul le dessin de quelques lettres diffère. Gill Sans MT n'a
pas d'équivalent libre aux mêmes chasses : Cabin, de la même famille
humaniste, la remplace, et la grille tient dans ses cases avec l'une comme
avec l'autre.

Comic Relief n'a pas d'italique : sans `comici.ttf`, l'italique en Comic Sans
MS s'imprime en romain.

## `fonts/`

Arimo, Tinos, Comic Relief, Cabin et Google Sans (la police du certificat
d'APIX Academy) en TTF, chacune avec sa licence OFL, **générées** par
`pnpm --filter @teranga/api fonts:fetch` et versionnées : un dépôt fraîchement
cloné sort des documents à la bonne typographie sans manipulation. pdfkit ne
lit ni woff2 ni SVG, d'où cette copie distincte de celle du site.
