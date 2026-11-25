# ADR-0072 : Academy, des leçons de quinze minutes au plus

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0069](0069-envois-lourds-delai-par-route.md), qui éprouvait
la limite de douze minutes.

## Contexte

Une leçon d'APIX Academy était une vidéo de douze minutes au plus, à une
seconde près : l'écran de la RH refusait un fichier plus long avant de
l'envoyer, le serveur relisait la durée dans le fichier, et la base la
bornait à 721 secondes. La DCH porte la limite à quinze minutes.

## Décision

**Une leçon dure quinze minutes au plus**, avec la même seconde de marge :
900 secondes, 901 au plus en base. La règle reste écrite une seule fois,
dans les contrats partagés ; les messages de l'écran et du serveur la
lisent là.

La migration 0108 élargit la contrainte de la table des leçons ; aucune
ligne ne change.

## Conséquences

- Une vidéo de treize ou quatorze minutes, refusée jusqu'ici, s'accepte ;
  au-delà de 15 min 01 s, le refus dit la durée et invite à découper.
- Le plafond de 2 Go du stockage local ne change pas : quinze minutes en
  1080p à 15 Mbit/s font 1,7 Go.
- Les leçons déjà en ligne ne bougent pas.
