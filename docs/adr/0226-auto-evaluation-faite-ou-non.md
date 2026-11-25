# ADR-0226 : L'auto-évaluation faite ou non faite, un point vert ou rouge sur les cartes

**Statut** : acceptée · 2026-11-21 · révise les ADR [0211](0211-mode-campagne-et-accueil.md), [0214](0214-bouton-m-auto-evaluer.md), [0216](0216-evaluation-par-le-n1.md), [0218](0218-commentaires-du-n2.md) et [0221](0221-transmission-a-la-dch.md)

## Contexte

L'auto-évaluation d'un agent avait trois états à l'écran : « Non
commencée », « En cours », « Faite le 18 déc. ». On les lisait en badge sur
les cartes de « Mon équipe » (ADR-0211, ADR-0216) et sur la page de l'agent
chez le N+1 (ADR-0214) ; les cartes du N+2 disaient « Auto-évaluation en
attente » (ADR-0218) ; le suivi de la DCH en faisait deux étapes,
« Auto-évaluation non commencée » et « Auto-évaluation en cours »
(ADR-0221).

L'APIX n'en veut que deux : faite, ou non faite. Qu'un agent ait ouvert un
brouillon n'intéresse ni son N+1, ni son N+2, ni la DCH.

## Décision

**Une auto-évaluation est faite quand elle est transmise au N+1.** Sinon,
brouillon compris, elle n'est pas faite.

**Sur les cartes de l'accueil**, « Mon équipe » et « Commentaires du N+2 »,
un point en haut à droite de la carte : vert, l'auto-évaluation est faite ;
rouge, elle ne l'est pas. Les badges « Non commencée », « En cours » et
« Auto-évaluation en attente » disparaissent : la carte d'un agent dont
l'auto-évaluation n'est pas faite n'a plus de badge. Une fois
l'auto-évaluation faite, le badge suit la fiche comme avant (« À évaluer »,
« Transmise à l'agent », « Chez le N+2 »… pour le N+1 ; « Chez le N+1 »,
« À commenter »… pour le N+2). La flèche des cartes qui s'ouvrent descend
au milieu de la carte, pour laisser le coin au point.

Dans « Mon équipe », le second groupe s'appelle « Auto-évaluation non
faite », au lieu de « Auto-évaluation en attente ».

**Sur la page de l'agent**, chez le N+1 comme chez le N+2, l'étape
« Auto-évaluation » dit « Faite le 18 déc. », en vert, ou « Non faite », en
rouge.

**Dans le suivi de la DCH**, les étapes « Auto-évaluation non commencée » et
« Auto-évaluation en cours » n'en font plus qu'une, « Auto-évaluation non
faite », en rouge. Dans l'API, l'étape `auto_non_faite` remplace
`auto_a_faire` et `auto_en_cours` ; le filtre par étape suit.

## Conséquences

- Le rouge, gardé jusqu'ici pour les erreurs, dit aussi une auto-évaluation
  non faite, à la demande de l'APIX.
- Le point ne porte pas seul l'information : il a son libellé
  (« Auto-évaluation faite », « Auto-évaluation non faite »), lu par les
  lecteurs d'écran et affiché au survol, et dans « Mon équipe », le groupe
  de la carte dit la même chose.
- Côté agent, rien ne change : son formulaire garde l'état `en_cours` de
  son brouillon. L'API envoie encore cet état au N+1 et au N+2 ; aucun
  écran ne l'affiche plus.
