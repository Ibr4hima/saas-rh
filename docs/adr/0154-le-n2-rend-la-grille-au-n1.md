# ADR-0154 : Le N+2 rend la grille au N+1, qui seul l'envoie à la DCH

**Statut** : acceptée · 2026-10-26 · remplace en partie l'[ADR-0149](0149-evaluation-sur-la-grille-de-l-apix.md)

## Contexte

Dans le circuit de la grille d'évaluation (ADR-0149), le N+2 qui validait la
grille l'envoyait du même geste à la DCH. L'APIX veut que la grille repasse
par le N+1 : le N+1 lit les commentaires du N+2, puis l'envoie à la DCH.

## Décision

**Le N+2 valide, la grille revient au N+1.** Elle passe à l'étape « Validée
par le N+2 » (`validee_n2`), avec les commentaires du N+2 et leur date. Le
N+1 reçoit un appel, « Mariama Cissé a validé la grille d'évaluation 2026 de
Moussa Ndiaye », qui prend la place de celui du N+2.

**Seul le N+1 envoie la grille à la DCH** : validée par l'agent, chez le N+2
(sans l'attendre, comme avant), ou validée par le N+2. Une grille validée par
le N+2 ne repart pas au N+2.

**Des textes qui disent qui fait quoi.**

| Où                        | Le texte                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| La confirmation du N+2    | « Vos commentaires seront transmis au N+1. Vous ne pourrez plus les modifier. »                       |
| La même, sans commentaire | « La grille sera renvoyée au N+1 sans commentaire de votre part. Vous ne pourrez plus la commenter. » |
| L'avis au N+2             | « Awa Diop vous a envoyé la grille d'évaluation 2026 de Moussa Ndiaye »                               |
| L'avis à l'agent          | « Awa Diop vous a envoyé votre grille d'évaluation 2026 à valider »                                   |

## Conséquences

- Migration 0124 : la contrainte de `evaluation_grilles.etat` admet
  `validee_n2` ; aucune ligne ne change. Une grille qu'un N+2 a envoyée à la
  DCH avant cette décision y reste.
- Une fois la grille validée, le N+2 la lit encore, sans geste.
- Le paraphe du N+2 (ADR-0151) se pose toujours quand le N+2 valide.
- Un agent qui part avec une grille validée par le N+2 reste dans l'équipe
  du N+1 le temps qu'elle parte à la DCH.
