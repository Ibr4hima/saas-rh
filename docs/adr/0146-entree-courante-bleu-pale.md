# ADR-0146 : L'entrée courante du menu revient au bleu pâle de la charte

**Statut** : acceptée · 2026-10-20 · précise l'[ADR-0143](0143-fond-bleu-gris.md) et l'[ADR-0145](0145-retour-au-fond-f3f6fa.md)

## Contexte

L'ADR-0143 avait foncé l'entrée courante du menu à #DBE9FC : le bleu pâle
de la charte (#E7F1FE) se fondait dans le fond #EBF1F8. Le fond est revenu
à #F3F6FA (ADR-0145) et l'entrée courante avait gardé #DBE9FC.

## Décision

**L'entrée courante du menu reprend le bleu pâle de la charte**, #E7F1FE,
comme le voulait l'ADR-0118 : son jeton (`--tg-menu-actif`) relit
`--tg-primary-soft`. La nuit ne change pas.

## Conséquences

- Sur le fond #F3F6FA, l'entrée courante se détache comme avant l'ADR-0143
  (1,05:1) ; son mot bleu y garde 7,3:1.
- Les gris des blocs (ADR-0144) ne changent pas.
