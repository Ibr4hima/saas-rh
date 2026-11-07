# ADR-0064 : Le Secrétariat général : son titre, et sa place sous le DG

**Statut** : acceptée · 2026-10-12

## Contexte

L'APIX a un Secrétariat général, une unité de rang direction rattachée à la
Direction Générale. ADR-0033 écrit l'intitulé de qui dirige une direction
« Directeur de la … » ou « Directrice de la … » : pour le Secrétariat
général, cela donnait « Directrice de la SG », un titre qui n'existe pas.
La fonction s'appelle secrétaire général ou secrétaire générale.

## Décision

**Le Secrétariat général se reconnaît à son nom** (`estSecretariatGeneral`),
accents et casse mis à part : « Secrétariat général », « Sécrétariat
Général », « SECRETARIAT GENERAL ». Il garde le type direction : son
rattachement, le n+1 de qui le dirige et les règles de la hiérarchie ne
changent pas.

**L'intitulé de qui le dirige** (`posteDeResponsable`, ce qui précise
ADR-0033) : « Secrétaire générale » ou « Secrétaire général », selon le
genre de la fiche. Genre inconnu : « Responsable du SG », comme
« Responsable de la DGT » pour une direction. Il s'écrit dans les
affectations à la désignation, depuis l'organigramme comme depuis une
nouvelle affectation.

**Dans l'organigramme, il se tient à l'aplomb de la Direction Générale**,
au milieu de la rangée, dans le prolongement du trait qui descend du
sommet. Les autres directions se partagent de part et d'autre, dans
l'ordre alphabétique de gauche à droite, coupées là où les deux côtés
pèsent le plus pareil. Deux côtés de même largeur le centrent au pixel
près ; replier une branche ne fait changer personne de côté.

**Objectifs de l'APIX** (espace DG) : « SG : Madame … », « SG : Monsieur … »,
« SG : … » sans genre connu, « SG : Non désigné » quand personne n'est à
sa tête.

**Les phrases qui expliquent la hiérarchie ne disent plus « un directeur »**
pour la personne à la tête d'une direction, Secrétariat général compris :
« dirige une direction : relève du directeur général », « relevait de qui
dirigeait la direction », « Qui dirige une direction relève du directeur
général », badge « n+1 autre que le DG ».

## Conséquences

- Les intitulés déjà écrits ne sont pas réécrits (ADR-0033) : une personne
  désignée avant cette règle garde « Directeur de la SG » jusqu'à la
  prochaine désignation.
- Le nom fait la règle : renommé autrement, le Secrétariat général
  reprend les intitulés et la place d'une direction.
- Quand un côté pèse plus que l'autre, le plus léger garde du vide à son
  bord : c'est le prix du centrage exact.
- Les orientations « Directeurs seulement » atteignent toujours qui dirige
  le Secrétariat général.
