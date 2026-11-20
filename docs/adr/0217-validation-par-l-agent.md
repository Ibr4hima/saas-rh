# ADR-0217 : La validation de l'évaluation par l'agent, ou son renvoi au N+1

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0216](0216-evaluation-par-le-n1.md) et l'[ADR-0214](0214-bouton-m-auto-evaluer.md)

## Contexte

Le N+1 transmet son évaluation à l'agent (ADR-0216). La fiche S1/EN05 n'est
valable qu'une fois validée par l'agent (section 7, « Validation et
suivi »). Sur la plateforme de base, l'agent validait la grille, ou, en
désaccord, la renvoyait au N+1 avec un mot ; le N+1 la corrigeait et la
transmettait de nouveau (ADR-0149). La campagne garde ce circuit.

## Décision

**L'agent lit l'évaluation transmise** sur la page « Mon évaluation »
(`/evaluation-annuelle/mon-evaluation`) : la fiche en lecture, dans la
forme que lit le N+1, jusqu'aux préoccupations et souhaits. La partie
strictement réservée à la hiérarchie ne quitte pas l'API : la réponse ne la
contient pas. Le brouillon du N+1 non plus : tant que l'évaluation n'est
pas transmise, l'agent sait seulement qu'elle n'est pas arrivée.

**Deux gestes**, dans une barre collée au bas de l'écran, à côté de la
mention de la fiche, « La fiche n'est valable qu'une fois validée par
l'agent » :

- « Valider mon évaluation », qui se confirme : l'évaluation devient
  définitive, plus personne ne la modifie ni ne la renvoie. Elle se valide
  à tout moment une fois transmise, même après la période ;
- « Renvoyer à mon N+1 », avec un mot obligatoire : l'évaluation redevient
  un brouillon du N+1, qui lit le mot au-dessus de la fiche, la reprend et
  la transmet de nouveau. Le renvoi se fait pendant la période seulement,
  tant que le N+1 peut encore écrire.

La fiche S1/EN05 n'a pas de place pour un commentaire de l'agent à la
validation : le désaccord passe par le mot du renvoi, qui ne s'imprime pas.

**Sur l'accueil de l'agent**, une fois l'auto-évaluation transmise, deux
étapes côte à côte : « Mon auto-évaluation » et « Évaluation du N+1 ». Sous
la seconde : jusqu'à quand le N+1 l'écrit, puis le jour où elle est reçue,
renvoyée ou validée, et la coche bleue une fois validée. Chaque carte
s'ouvre dès qu'il y a quelque chose à y lire : l'auto-évaluation transmise,
l'évaluation reçue. En haut à droite, « Valider mon évaluation » prend la
place de « M'auto-évaluer » tant que l'évaluation attend la validation.

**Chez le N+1**, la carte de l'équipe dit « Renvoyée par l'agent » en
orange, ce qui attend le N+1, « Transmise à l'agent », puis « Validée par
l'agent » en vert, la fin du parcours. Sur la page de l'agent, le badge de
l'étape suit : « Renvoyée le … », « Transmise le … », « Validée le … ».

**L'API** : `GET /v1/campagne/mon-evaluation`, `POST …/validation` et
`POST …/renvoi` (`{ mot }`, 2 000 caractères au plus), sur sa propre fiche.
Avant la transmission : 409, `campagne.evaluation_non_transmise`. Validée :
409, `campagne.evaluation_validee`, pour l'agent comme pour le N+1 qui
voudrait encore l'écrire. Renvoi après la période : 409,
`campagne.evaluation_fermee`. Sans évaluation (au sommet de
l'organigramme, en stage, sans dossier) : 404,
`campagne.sans_auto_evaluation`. L'accueil (`GET /v1/campagne`) dit où en
est son évaluation (`monEvaluation`).

**La migration 0140** ajoute à `fiches_entretien` : `validee_le`, puis
`renvoyee_le` et `renvoi_mot`, le dernier renvoi, qui reste écrit après une
nouvelle transmission.

## Conséquences

- Le jour de la validation alimentera la ligne « Agent (N) » de la section
  7 du PDF, avec la mention « Validation en ligne ».
- Rien ne prévient encore d'une transmission ou d'un renvoi : en mode
  campagne, ni notification ni courriel. L'agent comme le N+1 le voient sur
  leur accueil.
- Après la validation viennent les commentaires du N+2, puis la
  transmission à la DCH.
