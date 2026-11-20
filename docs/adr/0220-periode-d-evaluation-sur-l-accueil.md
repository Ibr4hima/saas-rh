# ADR-0220 : La période d'évaluation annuelle sur l'accueil, ses deux temps expliqués

**Statut** : acceptée · 2026-11-20 · révise l'[ADR-0214](0214-bouton-m-auto-evaluer.md) et l'[ADR-0217](0217-validation-par-l-agent.md)

## Contexte

Sur l'accueil de l'agent, la carte « Mon auto-évaluation » disait sa
période ; une fois l'auto-évaluation transmise, une seconde carte,
« Évaluation du N+1 », s'y ajoutait (ADR-0214, ADR-0217). L'APIX veut une
seule carte qui présente la période de l'année et ses deux temps, avec ce
que chacun demande.

## Décision

**Une carte « Période d'évaluation annuelle · 2026 »** remplace les deux
cartes. Dessous, ses deux temps, côte à côte sur un grand écran, l'un sous
l'autre sur un téléphone :

- « Auto-évaluation », du début de la période à la fin de l'auto-évaluation
  (`du` à `auto_au`) ;
- « Évaluation », du lendemain de la fin de l'auto-évaluation à la fin de
  la période (`auto_au` + 1 à `au`). Sans fin propre à l'auto-évaluation,
  la période entière.

Les dates sont celles que règle l'administration, jamais écrites dans
l'écran : pour 2026, du 15 au 20 décembre, puis du 21 au 30 décembre.

Sous chaque temps, trois puces, au style de la liste des langues d'une
offre, disent ce qu'il demande :

- Auto-évaluation : « Vous faites le bilan de votre année et des
  difficultés rencontrées. », « Vous appréciez l'atteinte de vos objectifs
  de 2026, résultats à l'appui. », « Vous exprimez vos souhaits, puis
  transmettez votre auto-évaluation à votre N+1. »
- Évaluation : « Après l'entretien, votre N+1 apprécie vos résultats et vos
  compétences. », « Votre N+1 fixe vos objectifs et vos besoins de
  formation pour 2027. », « Vous lisez votre évaluation, puis la validez,
  ou la renvoyez à votre N+1 avec un mot. »

La coche bleue suit le titre d'un temps fait : l'auto-évaluation
transmise, l'évaluation validée. Un lien rouvre ce qui se relit, « Relire
mon auto-évaluation » une fois transmise, « Lire mon évaluation » une fois
reçue. Les boutons de l'en-tête ne changent pas.

## Conséquences

- La règle du N+1 ne change pas : l'évaluation s'écrit dès que
  l'auto-évaluation est transmise (ADR-0216), avant même le début affiché
  de l'évaluation.
- Tant que la page d'administration des dates n'existe pas, la fin de
  l'auto-évaluation se règle dans la base.
