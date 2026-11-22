# ADR-0249 : Le titre d'une fenêtre passe à la ligne, il n'est plus coupé

**Statut** : acceptée · 2026-11-22

## Contexte

Le titre d'une fenêtre (la coquille commune des formulaires et des
confirmations) tenait sur une ligne, coupé d'une ellipse s'il était trop
long ; deux fenêtres seulement demandaient leur titre entier. Sur un
téléphone, la confirmation de l'auto-évaluation se lisait « Transmettre
votre auto-évaluatio… ». L'APIX veut le titre entier.

## Décision

Le titre de toute fenêtre passe à la ligne, équilibré sur ses lignes. Un
mot sans coupure possible, comme un nom de fichier, se coupe plutôt que de
déborder. « ? », « ! », « : » et « ; » ne partent pas seuls à la ligne :
une espace insécable les précède. L'option qui demandait le titre entier,
fenêtre par fenêtre, disparaît.

## Conséquences

- Un titre qui tient sur une ligne ne change pas.
- Un titre long prend deux lignes ou plus, surtout sur un téléphone :
  l'en-tête de la fenêtre grandit d'autant.
- Le sous-titre en texte se coupe toujours d'une ellipse.
