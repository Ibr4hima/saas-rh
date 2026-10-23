# ADR-0108 : Les boutons et les champs aux coins d'e-Voting

**Statut** : acceptée · 2026-10-18

## Contexte

Les boutons de l'application étaient des pilules, au rayon entier : le
bouton des pages de connexion, ceux des fiches et des fenêtres, les onglets,
la pagination. Les champs de saisie et les listes de choix avaient rejoint
la même forme. Dans apix-e-voting, les boutons sont des rectangles aux coins
à peine adoucis, avec une ombre fine dessous. L'APIX les trouve plus
professionnels et plus simples, et demande la même forme ici : sur les pages
de connexion, dans les fiches de remplissage, partout, sauf sur la bande
bleue du haut, qui reste arrondie.

## Décision

**Les contrôles prennent les coins d'e-Voting**, rangés dans les jetons
(`packages/ui/tokens.css`) :

- 8 px pour un bouton, un champ, une liste de choix, une option à cocher ;
- 7 px pour un petit bouton (30 px de haut) et pour les éléments d'un
  groupe : un onglet, une page de la pagination ;
- 10 px pour le cadre d'un groupe d'onglets, 12 px pour la barre de
  pagination.

**Un bouton plein porte une ombre fine** : un trait sous le bord, un reflet
dessus. Un bouton bordé n'en a presque pas. Quand on appuie, l'ombre passe
dedans. Au survol, la couleur fonce ; le bouton ne se soulève plus.

**Le bouton des pages de connexion suit celui d'e-Voting** : pleine largeur,
46 px de haut, coins de 8 px, le mot seul, sans flèche.

**La bande bleue du haut reste arrondie** : ses pastilles de verre (la date
du jour, « Télécharger », la recherche de l'Academy, les boutons d'icône) et
les onglets qui s'y posent, avec la pastille de leur nombre. Sur téléphone,
ces onglets descendent dans une carte, et y prennent les coins des
contrôles.

**Hors de la bande, le nombre d'un onglet s'écrit en clair**, sans pastille,
à la couleur de l'onglet, comme dans les segments d'e-Voting.

**Ce qui n'est pas un bouton à libellé reste rond**, comme dans e-Voting :
les badges, le nombre posé à côté d'un titre, les avatars, les pastilles
d'alerte, les boutons d'icône seule (fermer, flèches, crayon), la case d'un
choix exclusif, les étiquettes d'une offre d'emploi, les puces de fichier.

**Les grandes cartes de choix gardent leurs 12 px**, comme les choix du
bulletin d'e-Voting : elles se lisent comme des cartes, pas comme des
boutons.

## Conséquences

- Une forme de contrôle se prend dans les jetons (`rounded-controle`,
  `rounded-controle-sm`, `rounded-groupe`, `rounded-barre`, `shadow-bouton`,
  `shadow-bouton-borde`, `shadow-bouton-enfonce`), pas en valeur libre.
- Le même contrôle d'onglets a deux formes : arrondie sur la bande bleue,
  aux coins des contrôles dans une carte.
- Les squelettes de chargement suivent la forme de ce qu'ils annoncent :
  celui des onglets de l'Academy prend le cadre d'un groupe d'onglets.
