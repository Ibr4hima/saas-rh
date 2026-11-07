# ADR-0195 : Le lecteur PDF peint une page à la fois et ne bouge rien pendant le défilement

**Statut** : acceptée · 2026-11-07

## Contexte

L'aperçu des fichiers saccadait au défilement : lettres scannées, pièces des
dossiers, CV, documents générés. Le lecteur peignait plusieurs pages en même
temps sur le fil principal, celui qui fait aussi défiler l'écran. À chaque
image du défilement, il recalait les pages au demi-pixel et mesurait toutes
les pages pour suivre le numéro de page. Au zoom, et à chaque nouvel aperçu
d'un document généré, les pages repassaient par le blanc avant de se
redessiner.

## Décision

**Une page à la fois, la plus proche de l'écran d'abord.** Le lecteur peint
les pages à moins d'un écran de ce qu'on voit. Une page qui s'éloigne avant
d'être finie cède la place.

**Une page apparaît d'un coup.** Elle se peint dans une toile à part, qui
remplace l'ancienne une fois finie. Au zoom, au redimensionnement et à
chaque nouvel aperçu, l'ancienne image tient la place : plus de page
blanche.

**Rien ne se mesure ni ne se déplace pendant le défilement.** Le numéro de
page se calcule à partir de la position. Le calage au pixel attend que le
défilement s'arrête.

**La mémoire reste bornée.** Au-delà d'une centaine de mégaoctets de pages
peintes, les plus éloignées rendent leur toile ; elles se repeignent en
approchant.

**L'aperçu en largeur suit les mêmes règles** (« Générer des documents »,
grille d'évaluation), et attend que la fenêtre ait fini de changer de taille
pour repeindre.

## Conséquences

- Un seul peintre sert les deux lecteurs (`PdfViewer`, `PdfEnLargeur`).
- La zone qui défile a un fond opaque : le navigateur peut la faire défiler
  à part, même sur un écran ordinaire.
- La fenêtre d'aperçu recharge le fichier quand son adresse change, plus à
  chaque rendu de la page qui l'ouvre.
