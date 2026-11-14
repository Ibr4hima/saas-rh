# ADR-0059 : Le champ du report dit « au S1 de 2027 »

**Statut** : acceptée · 2026-10-12

Remplace la dernière conséquence de
l'[ADR-0058](0058-formations-encadrees.md).

## Contexte

L'ADR-0058 a fait dire « S2 » à la phrase de la fenêtre « Confirmer cette
échéance ? », et la puce d'un objectif reporté dit « S1 ». Le champ du
report disait encore « Nouvelle échéance, au semestre 1 de 2027 ».

## Décision

**Le champ du report dit « Nouvelle échéance, au S1 de 2027 »**, comme la
phrase et la puce.

## Conséquences

- La fenêtre parle des semestres d'une seule façon : « S1 », « S2 ».
- Ce que lit un lecteur d'écran garde « semestre » en toutes lettres
  (« Échéance de l'objectif 2, reporté au semestre 1 de 2027 ») : « S1 » ne
  s'y entend pas.
