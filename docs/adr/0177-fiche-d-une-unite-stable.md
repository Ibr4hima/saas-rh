# ADR-0177 : La fiche d'une unité s'ouvre entière, et les fenêtres se posent sans flou

**Statut** : acceptée · 2026-11-06

## Contexte

Un clic sur un bloc de l'organigramme ouvre la fiche de l'unité. La fenêtre
s'ouvrait avant d'avoir ses membres : centrée, elle grandissait ensuite d'un
coup (de 455 à 828 px pour un département de quarante agents) et son haut
remontait de près de 200 px. Ouvrir « Modifier » ou une confirmation la
faisait encore sauter. Le défilement de la fiche ouverte saccadait : le voile
de toutes les fenêtres floutait la page derrière, un flou recalculé à chaque
image (mesuré : 7 images lentes sur 115 avec le flou, aucune sans).

Sous le nom de l'unité, une étiquette répétait son type (« Direction »,
« Département », « Service ») que le nom dit déjà.

## Décision

**La fiche se charge dès qu'on approche du bloc** (survol, appui, clavier) et
ne s'ouvre qu'une fois ses membres connus, au plus 300 ms après le clic : elle
apparaît entière. Chargée depuis moins de trente secondes, elle ne se recharge
pas à l'ouverture. Une autre unité choisie entre-temps l'emporte.

**Elle se pose en haut de l'écran**, à 6 % de sa hauteur : quand son contenu
change sur place, seul son bas bouge. Les autres fenêtres restent centrées.

**Les fenêtres se posent sur un voile sans flou**, qui se lève en 160 ms ;
la fenêtre monte de 10 px en 200 ms, vite puis en douceur. Seules l'opacité et
la transformation s'animent.

**Plus d'étiquette de type** : sous le nom, le sigle et le rattachement, un
point entre les deux.

## Conséquences

- Mesuré à 1440 px, au premier clic : la fiche s'ouvre à sa hauteur finale,
  son haut ne bouge que des 16 px de son entrée, et le défilement tient
  60 images par seconde.
- Le panneau des notifications garde son flou (ADR-0115).
