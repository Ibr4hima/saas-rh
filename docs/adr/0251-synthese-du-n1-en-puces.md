# ADR-0251 : Les points forts et les axes de développement du N+1, en puces

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0238](0238-reponses-oui-non-et-puces.md)

## Contexte

Dans la synthèse de l'évaluation, le N+1 écrit le bilan global : « Points
forts » et « Axes de développement » (ADR-0216). Ces deux champs étaient
des zones de texte libres. L'auto-évaluation, elle, s'écrit en puces pour
ses réponses en liste (ADR-0238). L'APIX veut les mêmes puces automatiques
pour ces deux champs.

## Décision

**« Points forts » et « Axes de développement » s'écrivent en puces**,
comme les réponses en puces de l'auto-évaluation : une puce par ligne, la
première déjà en place ; Entrée en crée une autre ; effacer au début d'une
puce la joint à la précédente ; un texte collé sur plusieurs lignes donne
une puce par ligne. Les deux champs restent obligatoires.

**En lecture**, chez l'agent, le N+2 et la DCH, une puce par ligne. **Dans
le PDF**, une puce par ligne aussi, qu'elle ait été écrite avec un tiret ou
non.

## Conséquences

- Rien ne change dans l'API ni dans la base : chaque puce est une ligne du
  texte, comme pour l'auto-évaluation.
- Un texte écrit d'un seul tenant avant ce changement se lit en une seule
  puce.
