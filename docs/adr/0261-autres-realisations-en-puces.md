# ADR-0261 : « Autres réalisations en dehors des objectifs », en puces

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0238](0238-reponses-oui-non-et-puces.md)

## Contexte

Dans l'évaluation des résultats, l'agent écrit ses « Autres réalisations en
dehors des objectifs » dans une zone de texte libre. Les réponses en liste
de l'auto-évaluation s'écrivent en puces (ADR-0238), comme les points forts
et les axes de développement du N+1 (ADR-0251). L'APIX veut des puces
automatiques pour ce champ aussi.

## Décision

**« Autres réalisations en dehors des objectifs » s'écrit en puces** : une
puce par ligne, la première déjà en place ; Entrée en crée une autre ;
effacer au début d'une puce la joint à la précédente ; un texte collé sur
plusieurs lignes donne une puce par ligne. Le champ reste facultatif.

**En lecture**, chez l'agent, le N+1, le N+2 et la DCH, une puce par ligne.
**Dans le PDF**, une puce par ligne aussi, qu'elle ait été écrite avec un
tiret ou non.

## Conséquences

- Rien ne change dans l'API ni dans la base : chaque puce est une ligne du
  texte.
- Un texte écrit d'un seul tenant avant ce changement se lit en une seule
  puce.
