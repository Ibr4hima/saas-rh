# ADR-0285 : « Valider mon évaluation » monte en haut, à gauche de la date, et la mention de la fiche quitte l'écran

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0217](0217-validation-par-l-agent.md) et l'[ADR-0267](0267-validation-sans-renvoi.md), complète l'[ADR-0256](0256-suivi-des-evaluations-dans-la-barre.md)

## Contexte

Sur « Mon évaluation », une barre collée au bas de l'écran portait la
mention de la fiche, « La fiche n'est valable qu'une fois validée par
l'agent. », et le bouton « Valider mon évaluation » (ADR-0217, ADR-0267).
L'APIX retire la mention et veut le bouton en haut, à gauche de la date,
là où se tient déjà « Suivi des évaluations » (ADR-0256).

## Décision

**La barre du bas disparaît**, avec la mention.

**« Valider mon évaluation » se place dans la barre du haut**, à gauche de
la date, tant que l'évaluation attend la validation : en bleu, avec son
icône, à la hauteur de la date. La barre reste collée en haut de l'écran :
le bouton reste à portée pendant toute la lecture de la fiche. Il ouvre la
même confirmation qu'avant. Une fois l'évaluation validée, il disparaît et
« Télécharger » prend le relais dans le bandeau (ADR-0269).

**Sous 1 024 px**, la barre n'a pas la place du libellé : le bouton
descend en tête de la page, à droite, comme « Suivi des évaluations ».
Quand la barre porte aussi « Suivi des évaluations », le bouton ne la
rejoint qu'à partir de 1 280 px, pour que le titre de la campagne reste
entier.

**La coque de la campagne réserve la place** du geste de la page, dans la
barre et en tête de la page ; la page l'y pose par un portail
(`ActionDeLaBarre`), comme les gestes de l'en-tête de la plateforme.

## Conséquences

- La mention reste imprimée sur la fiche en PDF, en section 7,
  « Validation et suivi » : seul l'écran la perd.
- Sur un téléphone et sur une tablette, le bouton ne suit plus la lecture :
  il reste en tête de la page.
- L'API ne change pas.
