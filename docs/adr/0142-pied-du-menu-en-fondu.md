# ADR-0142 : Le pied du menu, sans filet : la liste s'efface au-dessus du compte

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Au pied du menu, la personne connectée se tient sous un filet (ADR-0115).
Quand la liste dépasse, ses entrées s'arrêtent net sur ce trait, coupées à
mi-hauteur. L'APIX veut le pied du menu de PayFit : la liste s'y efface en
fondu, sans trait.

## Décision

**Plus de filet au-dessus du compte.**

**Tant que la liste dépasse et qu'il reste des entrées plus bas, elle
s'efface en fondu** sur ses 48 derniers pixels, au-dessus du compte, comme
une rangée d'onglets trop longue s'efface à son bord. Rien quand tout tient,
ni une fois arrivé au bout : la dernière entrée se lit alors en entier.

## Conséquences

- Le fondu est un masque sur la liste : il vaut pour les deux thèmes, sans
  couleur à accorder au fond.
- La liste se mesure quand elle défile ou change de hauteur, quand une
  rubrique s'ouvre ou se ferme.
