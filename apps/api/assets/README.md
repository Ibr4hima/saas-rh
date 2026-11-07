# Ressources des documents générés

Servies au moteur PDF, jamais au web. Ce qui se dépose ici n'est pas versionné :
cela appartient à l'organisation, pas au logiciel.

Ce qui est propre à l'APIX sur ses documents ne se dépose pas : le papier de
sa charte graphique, le drapeau et le bloc de la République en tête, la
courbe bleue et les mentions du pied de page, est composé en code
(`src/modules/documents/entete.ts`, ADR-0086, ADR-0173).

## `logo-apix.png`

Le logo, en haut à droite des documents de la DCH, et sur les certificats de
l'Academy. S'il est absent d'ici, le générateur le cherche aussi dans
`apps/web/public/logo-apix.png` : un seul fichier suffit donc si le site et
l'API sont déployés ensemble. Absent des deux, l'en-tête se dessine sans lui.

Format : PNG ou JPEG (pdfkit ne lit pas le SVG). Le générateur aligne le
fichier tel qu'il est, marges transparentes comprises : son bord droit sur
la marge du texte, son milieu sur celui du bloc de la République. Un logo
détouré, ou aux marges égales tout autour, tombe donc juste.

## Arial, Times New Roman et Gill Sans MT : `arial*.ttf`, `times*.ttf`, `GIL*.TTF`

Les documents de la DCH suivent la charte de l'APIX, en Raleway, Anton et
Exo : libres, elles sont versionnées dans `fonts/` et ne se déposent pas
(ADR-0173). La déclaration de mouvement est en Times New Roman, les grilles
d'évaluation en Gill Sans MT (ADR-0149), avec des lignes en Arial et en
Times New Roman. Leur licence (Monotype, Microsoft) interdit de les
versionner. Le générateur les prend là où la machine les a, dans cet ordre :

1. ici, déposées sous leur nom Windows (la casse ne compte pas) :

   | Police          | Romain         | Gras           | Italique       | Gras italique  |
   | --------------- | -------------- | -------------- | -------------- | -------------- |
   | Arial           | `arial.ttf`    | `arialbd.ttf`  | `ariali.ttf`   | `arialbi.ttf`  |
   | Times New Roman | `times.ttf`    | `timesbd.ttf`  | `timesi.ttf`   | `timesbi.ttf`  |
   | Gill Sans MT    | `GIL_____.TTF` | `GILB____.TTF` | `GILI____.TTF` | `GILBI___.TTF` |

2. sur le système : `C:\Windows\Fonts` sous Windows,
   `/System/Library/Fonts/Supplemental` sous macOS ; sous Debian ou Ubuntu,
   après `sudo apt install ttf-mscorefonts-installer`, le paquet officiel qui
   les télécharge chez Microsoft et en fait accepter la licence.

Sans elles, Arimo et Tinos (`fonts/`), libres et dessinées aux mêmes
chasses, prennent leur place : un document sort avec la même mise en page, au
caractère près ; seul le dessin de quelques lettres diffère. Gill Sans MT n'a
pas d'équivalent libre aux mêmes chasses : Cabin, de la même famille
humaniste, la remplace, et la grille tient dans ses cases avec l'une comme
avec l'autre.

## `fonts/`

Raleway, Anton et Exo (la charte de l'APIX, que suit aussi le certificat
d'APIX Academy), Arimo, Tinos, Cabin, Allura et Google Sans (celle des
vidéos de démonstration d'APIX Academy) en TTF, chacune avec sa licence
OFL, et les pictogrammes du pied de page (Material Symbols, licence
Apache 2.0), **générés** par `pnpm --filter @teranga/api fonts:fetch` et
versionnés : un dépôt fraîchement cloné sort des documents à la bonne
typographie sans manipulation. pdfkit ne lit ni woff2 ni SVG, d'où cette
copie distincte de celle du site.
