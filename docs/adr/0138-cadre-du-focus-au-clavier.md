# ADR-0138 : Le cadre du focus ne paraît qu'à la navigation au clavier

**Statut** : acceptée · 2026-10-19

## Contexte

Le cadre du focus montre, à la navigation au clavier, l'élément qui reçoit
les touches. Le navigateur le dessine (`:focus-visible`) dès qu'une touche
part, quelle qu'elle soit. Un clic sur « Afficher la suite », puis Maj : le
bouton s'entoure d'un cadre. Une fiche ouverte d'un clic sur une direction,
fermée par Échap : le focus revient à la ligne de la direction, cadre
compris. À l'écran, une partie de la page paraît sélectionnée.

## Décision

**Le cadre suit la touche Tab, pas la dernière touche frappée.** Tab, avec ou
sans Maj, pose `data-clavier` sur la page ; le premier clic ou toucher
l'ôte. Les styles du focus ne s'appliquent que sous cet attribut : après un
clic, ni Maj, ni Échap, ni Entrée, ni les flèches ne font paraître de cadre.

**Un champ de saisie garde son cadre au clic** : on y tape, il faut voir où.
Les boutons, les liens, les cases à cocher et les glissières suivent la
règle.

**Le cadre du navigateur suit la même règle**, sur les éléments qui n'en
dessinent pas.

## Conséquences

- L'attribut se pose dans un script du `<head>`, comme le thème, avant que la
  page ne s'hydrate.
- La variante `focus-visible` de Tailwind est redéfinie dans `globals.css` :
  les classes des composants ne changent pas.
- Au clavier, le cadre paraît dès la première tabulation ; une fiche ouverte
  au clavier et fermée par Échap rend le focus avec son cadre.
