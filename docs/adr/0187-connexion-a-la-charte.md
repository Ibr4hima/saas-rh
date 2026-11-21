# ADR-0187 : Les écrans de connexion à la charte de l'APIX, toujours en clair

**Statut** : acceptée · 2026-11-07 · révise l'[ADR-0116](0116-fond-de-l-ecran-de-connexion.md) sur le thème sombre de l'écran de connexion

## Contexte

Le certificat d'APIX Academy (ADR-0185) et les courriels (ADR-0186) suivent
la charte de l'APIX. Les écrans d'avant le compte étaient restés à part :
la connexion, l'activation d'une invitation, le mot de passe oublié, le
nouveau mot de passe et la création d'un compte. Une carte sur un aplat,
aucun motif de la charte, et en thème sombre un dôme bleu qui n'existe pas
dans la charte. La DCH les veut au niveau des autres supports, en Google
Sans comme le reste de l'application, et en clair seulement.

## Décision

**La scène reprend les motifs de la charte.**

- En bas de l'écran, la courbe bleue du papier à en-tête, soulignée
  d'orange, avec ses ondulations, comme au bas du certificat et des
  courriels. Elle porte le pied en blanc : les droits à gauche, « Plateforme
  à usage interne » à droite ; l'un sous l'autre, centrés, sur un téléphone.
- Dans le coin en haut à droite, les ondulations de la charte, à peine
  visibles, qui s'effacent vers le centre. Pas sur un téléphone : elles
  passeraient sous la marque.
- Le titre de la carte est souligné d'un filet orange, comme sur le
  certificat et les courriels.

**La carte prend plus de place.** Le logo passe de 44 à 56 px de haut, les
champs et le bouton à 48 px, la carte de 416 à 432 px de large ; son ombre
s'adoucit, en trois couches. Google Sans reste la police de ces écrans.

**Toujours en clair.** Ces écrans ne suivent plus le thème choisi dans
l'application : le script d'amorçage les pose en clair dès le premier pixel,
comme les pages publiques. On retrouve son thème après la connexion. Le
dôme bleu de nuit, sa trame et ses voiles disparaissent.

**Sur un écran bas** (760 px de haut ou moins), les marges se resserrent, le
logo revient à 48 px, les champs et le bouton à 44 px, et la courbe
s'abaisse : la connexion tient sans défilement à 1280 × 680, comme avant.

## Conséquences

- Le thème choisi se relit dans le navigateur, plus sur la page : en
  quittant un écran toujours en clair, l'application reprend le thème
  choisi, et le menu du compte propose le bon.
- En sortant de l'application en sombre, l'écran de connexion s'affiche
  directement en clair : le thème change avant le premier affichage.
- La courbe est dessinée dans la page, en SVG, d'après les arcs du papier à
  en-tête : aucune image à charger.
- Les variables de thème de la scène (`--login-*`) quittent la feuille de
  style ; il n'y reste que l'entrée en scène.
