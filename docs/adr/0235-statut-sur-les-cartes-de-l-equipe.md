# ADR-0235 : Le statut à droite de l'email, sur les cartes de « Mon équipe »

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0234](0234-cartes-des-agents.md)

## Contexte

Sous le filet des cartes des agents, l'email professionnel restait seul tant
que l'auto-évaluation n'était pas faite (ADR-0234). L'APIX veut, dans « Mon
équipe », le statut de l'agent à droite de l'email.

## Décision

**Sur les cartes de « Mon équipe »**, le statut du dossier, « Cadre » ou
« Non-cadre », les mots de l'en-tête de l'agent (ADR-0223), à droite de
l'email professionnel : deux colonnes égales, comme la date et le lieu d'une
carte d'événement, sur un téléphone aussi. Sans statut au dossier, « Non
renseigné ». Une fois l'auto-évaluation faite, « Fiche » passe dessous, sous
l'email.

Les cartes de « Commentaires du N+2 » ne changent pas : l'email, et la fiche
à sa droite s'il y a lieu.

**L'accueil renvoie le statut** de chaque agent de l'équipe, celui du
dossier.

## Conséquences

- Pas de migration : le statut est déjà au dossier.
- L'email n'a plus que la moitié de la carte : une adresse trop longue
  s'arrête sur « … », le survol la donne en entier.
