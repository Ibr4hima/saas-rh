# Ressources des documents générés

Servies au moteur PDF, jamais au web. Deux fichiers à déposer ici — aucun n'est
versionné : ils appartiennent à l'organisation, pas au logiciel.

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

## `fonts/`

Google Sans en TTF, **générée** par `pnpm --filter @teranga/api fonts:fetch` et
versionnée : un dépôt fraîchement cloné sort des documents à la bonne
typographie sans manipulation. pdfkit ne lit ni woff2 ni SVG, d'où cette copie
distincte de celle du site.
