# ADR-0145 : Le fond de l'application revient à #F3F6FA

**Statut** : acceptée · 2026-10-20 · précise l'[ADR-0143](0143-fond-bleu-gris.md)

## Contexte

L'ADR-0143 a passé le fond clair de #F3F6FA à #EBF1F8, un bleu-gris plus
soutenu. Les gris des blocs ont ensuite pris la teinte du fond (ADR-0144).
À l'usage, l'APIX préfère le fond d'avant, et seulement lui.

## Décision

**Le fond clair revient à #F3F6FA**, celui de l'écran de connexion
(ADR-0116). Rien d'autre ne revient en arrière : l'entrée courante du menu
garde #DBE9FC (ADR-0143), et les gris des blocs gardent la teinte bleu-gris
de l'ADR-0144.

## Conséquences

- Le texte secondaire retrouve 5,8:1 sur le fond.
- L'entrée courante du menu se détache plus nettement qu'avant
  l'ADR-0143 : 1,14:1 sur le fond, contre 1,05:1 avec le bleu pâle de la
  charte.
- La page publique d'une offre d'emploi et les courriels ont de nouveau le
  fond de l'application.
