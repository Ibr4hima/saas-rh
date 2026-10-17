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

## Comic Sans MS : `comic*.ttf`

Certains modèles de l'APIX écrivent une ligne en Comic Sans MS (le timbre de
l'attestation de travail). Sa licence (Microsoft) interdit de la versionner :
le dépôt porte à sa place Comic Relief (`fonts/`), libre et dessinée aux mêmes
chasses.

Si l'organisation en a la licence, elle dépose ici les fichiers d'origine, sous
leur nom Windows (la casse ne compte pas), et le générateur les prend à la
place :

| Romain      | Gras          | Italique     | Gras italique |
| ----------- | ------------- | ------------ | ------------- |
| `comic.ttf` | `comicbd.ttf` | `comici.ttf` | `comicz.ttf`  |

Comic Relief n'a pas d'italique : sans `comici.ttf`, l'italique en Comic Sans
MS s'imprime en romain.

## `fonts/`

Google Sans et Comic Relief en TTF, chacune avec sa licence OFL, **générées**
par `pnpm --filter @teranga/api fonts:fetch` et versionnées : un dépôt
fraîchement cloné sort des documents à la bonne typographie sans manipulation.
pdfkit ne lit ni woff2 ni SVG, d'où cette copie distincte de celle du site.
