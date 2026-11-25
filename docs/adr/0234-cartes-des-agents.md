# ADR-0234 : Les cartes des agents, comme celles des événements de la plateforme

**Statut** : acceptée · 2026-11-21 · révise les ADR [0226](0226-auto-evaluation-faite-ou-non.md) et [0227](0227-accueil-a-la-charte.md)

## Contexte

Sur l'accueil de la campagne, « Mon équipe » et « Commentaires du N+2 »
présentent chaque agent sur une carte : ses initiales dans un rond, son nom,
son poste, le point de son auto-évaluation et, une fois celle-ci faite, un
badge qui dit où en est sa fiche (ADR-0226, ADR-0227). L'APIX n'aime pas
leur style et les veut comme les cartes de la page Événements de sa
plateforme : un titre, une ligne dessous, un filet, puis quelques repères en
petites capitales. Elle veut aussi y lire l'email professionnel de l'agent.

## Décision

**La carte d'un agent** prend la forme d'une carte d'événement :

- en haut, le nom en gras et le poste dessous, sur deux lignes au plus ;
  pour le N+2, la ligne « N+1 : … » en plus. À hauteur du nom, à droite, le
  point de l'auto-évaluation, vert ou rouge, comme avant ;
- sous un filet, les repères, le libellé en petites capitales et la valeur
  en gras : « Email professionnel », puis, l'auto-évaluation faite,
  « Fiche », avec ce que disait le badge (« À évaluer », « Chez le N+2 »,
  « À commenter »…). Côte à côte quand la carte est assez large, l'un sous
  l'autre sur un téléphone. Une adresse trop longue s'arrête sur « … » et le
  survol la donne en entier ; sans adresse au dossier, « Non renseigné ».

Les initiales, le badge et la flèche disparaissent. Une carte qui s'ouvre se
soulève au survol et son contour passe au bleu, comme sur la plateforme. Les
cartes s'élargissent : trois par ligne sur un grand écran, au lieu de
quatre.

**L'accueil renvoie l'adresse professionnelle** de chaque agent de l'équipe
et de chaque agent dont la personne connectée est le N+2 : celle du dossier,
déjà lue pour l'en-tête de l'agent (ADR-0224).

## Conséquences

- Pas de migration : l'adresse est déjà au dossier.
- Sans la flèche, une carte qui s'ouvre ne se distingue plus des autres
  qu'au survol et par le groupe où elle se range (« Auto-évaluation faite »,
  « Évaluation validée par l'agent »).
