# ADR-0140 : Le retour à la page précédente, sans cadre, comme la cloche du menu

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0139](0139-retour-a-gauche-du-titre.md)

## Contexte

L'ADR-0139 pose le retour dans un rond blanc cerclé d'un filet, comme les
commandes de droite de l'en-tête. À gauche du titre, ce cadre pèse plus que
le geste qu'il porte.

## Décision

**Le retour se pose à même le fond, comme la cloche du menu** : le chevron
gris, sans cadre ni fond, dans un rond de 36 px qui prend le voile d'encre
des rangées du menu au survol. La cloche et le retour partagent ce style
(`COMMANDE_SUR_LE_FOND`).

**Le chevron s'aligne sur le bord des blocs de la page** : son rond déborde
à gauche, et le titre le suit de près.

## Conséquences

- Le reste de l'ADR-0139 tient : la place, la destination, le nom pour les
  lecteurs d'écran, le téléphone.
