# ADR-0244 : La fiche sans objectif, la mention seule, sans l'échelle

**Statut** : acceptée · 2026-11-22 · révise l'[ADR-0205](0205-fiche-d-entretien-annuel.md)

## Contexte

Sur la fiche en PDF, la partie 2.2.1 « Les objectifs fixés » se termine par
l'échelle des quatre niveaux d'atteinte (ADR-0205). Quand aucun objectif
n'a été fixé pour l'année, la fiche imprimait « Aucun objectif n'a été fixé
pour cette année. », puis l'échelle quand même, sans rien à noter. L'APIX ne
veut plus l'échelle dans ce cas.

## Décision

Sans objectif, la partie 2.2.1 ne porte que la mention « Aucun objectif n'a
été fixé pour cette année. ». L'échelle revient dès qu'il y a un objectif,
sous le dernier. La règle vaut pour la fiche remplie sous toutes ses
formes : la partie de l'agent (ADR-0241) comme la fiche complète. La fiche
vierge a ses blocs d'objectifs à remplir : elle garde son échelle.

## Conséquences

- Sans objectif, « Autres réalisations en dehors des objectifs » (2.2.2)
  suit directement la mention.
