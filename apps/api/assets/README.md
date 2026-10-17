# Ressources des documents générés

Servies au moteur PDF, jamais au web. Ce qui se dépose ici n'est pas versionné :
cela appartient à l'organisation, pas au logiciel.

## `entete-republique.png`

Le bloc de la République qui ouvre les actes, **tel qu'il figure à la charte
graphique** : République, devise, tutelle, secrétariat, nom de l'agence. C'est
une image, on ne la recompose pas — sa fonte et son espacement font partie de
la charte.

Sans elle, l'en-tête est composé au plomb par le générateur, aux mêmes mots.
Ce n'est pas l'en-tête officiel, c'en est la transcription : un document sort
quand même, mais il faut déposer l'image.

Format : PNG ou JPEG (pdfkit ne lit pas le SVG). Largeur utile ~960 px.

## `logo-apix.png`

Le logo, posé à droite de l'en-tête. S'il est absent d'ici, le générateur le
cherche aussi dans `apps/web/public/logo-apix.png` — un seul fichier suffit
donc si le site et l'API sont déployés ensemble. Absent des deux, l'en-tête se
dessine sans lui.

Format : PNG ou JPEG, pour la même raison.

## Arial et Comic Sans MS : `arial*.ttf`, `comic*.ttf`

Les documents de la DCH sont en Arial, certains de ses modèles en Comic Sans
MS. Leur licence (Monotype, Microsoft) interdit de les versionner : le dépôt
porte à leur place Arimo et Comic Relief (`fonts/`), libres et dessinées aux
mêmes chasses. Un document sort donc avec la même mise en page, au caractère
près ; seul le dessin de quelques lettres diffère.

Si l'organisation en a la licence, elle dépose ici les fichiers d'origine, sous
leur nom Windows (la casse ne compte pas), et le générateur les prend à la
place :

| Police        | Romain      | Gras          | Italique     | Gras italique |
| ------------- | ----------- | ------------- | ------------ | ------------- |
| Arial         | `arial.ttf` | `arialbd.ttf` | `ariali.ttf` | `arialbi.ttf` |
| Comic Sans MS | `comic.ttf` | `comicbd.ttf` | `comici.ttf` | `comicz.ttf`  |

Comic Relief n'a pas d'italique : sans `comici.ttf`, l'italique en Comic Sans
MS s'imprime en romain.

## `fonts/`

Google Sans, Arimo et Comic Relief en TTF, chacune avec sa licence OFL,
**générées** par `pnpm --filter @teranga/api fonts:fetch` et versionnées : un
dépôt fraîchement cloné sort des documents à la bonne typographie sans
manipulation. pdfkit ne lit ni woff2 ni SVG, d'où cette copie distincte de
celle du site.
