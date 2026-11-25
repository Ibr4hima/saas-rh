# ADR-0277 : Les moyennes des objectifs s'écrivent sans zéros inutiles

**Statut** : acceptée · 2026-11-24 · révise l'[ADR-0275](0275-notes-des-objectifs-de-0-a-3.md) et l'[ADR-0276](0276-notes-de-1-a-4-et-arrondi-a-2.md)

## Contexte

Le relevé des notes obtenues écrivait chaque moyenne avec deux décimales
(ADR-0275) : « 3,00 / 4 », et « 2,00 / 4 » pour la moyenne retenue
(ADR-0276). L'APIX veut lire « 3 / 4 » et « 2 / 4 » : les zéros après la
virgule n'apportent rien.

## Décision

**Une moyenne s'écrit au centième près, sans zéro inutile** :

- une moyenne entière s'écrit sans virgule : « 3 / 4 », et la moyenne
  retenue « 2 / 4 » ;
- 2,5 reste « 2,5 / 4 » ;
- une moyenne qui ne tombe pas juste s'arrondit au centième : 5/3 donne
  « 1,67 / 4 ».

La règle vaut partout où le relevé s'affiche : l'auto-évaluation, la saisie
du N+1, les lectures (agent, N+2, DCH) et le PDF. Seule l'écriture change :
l'arrondi à 2 se décide toujours sur la moyenne exacte, de 1,5 compris à 2
non compris.

## Conséquences

- Les notes des objectifs restent des entiers, de 1 à 4 ; seules les
  moyennes portent des décimales, quand il y en a.
- La fiche vierge garde « / 4 », à compléter à la main.
- L'ancienne grille (ADR-0149, ADR-0155) ne change pas.
