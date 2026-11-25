# ADR-0170 : La page qui arrive se montre d'un bloc, à largeur constante

**Statut** : acceptée · 2026-11-03 · précise l'[ADR-0167](0167-essayer-en-mode-production.md)

## Contexte

En mode production (ADR-0167), changer de page prend 100 ms environ. Les
données de la page arrivent en 50 à 100 ms : juste assez pour que son
squelette de chargement s'affiche, puis cède la place à une page d'une
autre forme. Sur l'évaluation annuelle, le premier bloc du squelette se
tenait à 254 pixels du haut, celui de la page à 80 ; sur les offres
d'emploi, 363 pixels de squelette devenaient 163 de liste. Mesuré image par
image, rien d'autre ne bougeait : l'œil voyait ce clignotement comme un
saut. Sur une machine qui affiche toujours la barre de défilement, la
largeur changeait aussi de 10 pixels entre une page courte et une page
longue.

## Décision

**La page qui arrive reste invisible tant qu'elle montre un squelette**, 300
ms au plus, puis paraît d'un fondu de 150 ms, dans sa forme finale. Une
page dont les données sont déjà là paraît aussitôt, avant d'être peinte.
Au-delà de 300 ms, le squelette se montre : il dit qu'on attend. L'en-tête,
lui, change de titre tout de suite.

**La place de la barre de défilement reste réservée** dans le panneau qui
défile, et l'en-tête se décale d'autant : une page courte et une page longue
ont la même largeur, et le bord droit des blocs tombe sous celui de
l'en-tête. Quand le système fait flotter la barre, comme sur un Mac sans
souris, rien ne change.

## Conséquences

- `ArriveeDeLaPage` enveloppe chaque page de l'application, sous le panneau
  qui défile ; `Page` y prend `flex-1` pour remplir le panneau comme avant.
- La page se reconnaît en chargement à ses squelettes (`Skeleton`,
  `animate-pulse`). Une page qui attend sans squelette se montre tout de
  suite, comme avant.
- Le fondu ne joue pas quand le système demande moins d'animations.
