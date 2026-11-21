# ADR-0141 : L'action de l'écran, à la hauteur apparente du bouton de la date

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0124](0124-action-aux-mesures-de-la-date.md)

## Contexte

L'action de l'écran et le bouton de la date ont les mêmes mesures
(ADR-0124) : 36 px de haut, 12 px de marge, le mot en 12,5 px. L'action
paraît pourtant plus haute. Son aplat bleu, contrasté, va jusqu'au bord de
sa boîte ; la date, de la teinte des blocs, ne se détache du fond que par
son filet. L'œil prête plus de taille à un aplat qu'à un contour.

## Décision

**Le fond de l'action s'arrête dans son filet transparent** : la boîte garde
ses 36 px, l'aplat en montre 34, comme le fond de la date à l'intérieur de
son filet. Les deux boutons paraissent de la même hauteur, en thème clair
comme en sombre.

## Conséquences

- Les gestes que la page pose dans l'en-tête (« Télécharger ») suivent la
  même règle : ils partagent la classe de l'action.
- Sur téléphone, le rond de l'action montre 34 px de bleu dans sa boîte de
  36 px.
