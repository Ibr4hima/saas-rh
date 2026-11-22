# ADR-0265 : Le N+1 confirme l'entretien avec l'agent et en donne la date

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0216](0216-evaluation-par-le-n1.md), révise l'[ADR-0221](0221-transmission-a-la-dch.md)

## Contexte

L'évaluation du N+1 suppose un entretien avec l'agent, autour de son
auto-évaluation et de ses objectifs. Rien ne le garantissait : le N+1
pouvait remplir et transmettre la fiche sans avoir reçu l'agent, et la
date de l'entretien ne se saisissait pas pendant la campagne (le PDF la
laissait « À fixer », ADR-0221). L'APIX veut que le N+1 confirme
l'entretien et en donne la date avant de valider et de transmettre.

## Décision

**Au bout de l'évaluation, sous « Observations du N+1 »**, une case à
cocher, obligatoire : « Je confirme avoir eu un entretien avec Awa Diop
pour échanger sur son auto-évaluation et ses objectifs. » Le nom est celui
de l'agent.

**Cochée, elle ouvre « Date de l'entretien »**, obligatoire elle aussi.
La date tombe entre la transmission de l'auto-évaluation et le jour même ;
l'écran ne l'écrit pas, mais une date hors de ces bornes laisse « Valider »
et « Transmettre à l'agent » grisés. Décochée, la case efface la date.

**L'API applique la même règle à la transmission** : sans confirmation,
« À compléter : la confirmation de l'entretien » ; sans date, ou hors des
bornes, « À compléter : la date de l'entretien » (422). La confirmation
et la date s'enregistrent avec l'évaluation, dans le brouillon comme dans
la version transmise ; sans confirmation, le brouillon ne garde pas de
date.

**En lecture**, chez l'agent, le N+1, le N+2 et la DCH, la date de
l'entretien s'affiche au bout de la fiche. **Le PDF** l'imprime dans
l'identification, à la place de « À fixer ».

## Conséquences

- Pas de migration : la confirmation et la date vivent dans l'évaluation
  du N+1, comme ses autres réponses. Une évaluation transmise avant reste
  sans date, et son PDF garde « À fixer ».
- Le calcul de ce qui manque à l'évaluation prend, en option, les bornes
  de la date : l'écran et l'API s'en servent tous deux.
