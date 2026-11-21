# ADR-0218 : Les commentaires du N+2, sur la fiche validée par l'agent

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0217](0217-validation-par-l-agent.md)

## Contexte

La fiche S1/EN05 réserve au N+2 une place dans la partie strictement
réservée à la hiérarchie (8.3, « Commentaires du N+2 »), validée en ligne.
Sur la plateforme de base, le N+2 recevait la grille validée par l'agent, la
commentait s'il y avait lieu, puis la rendait au N+1 (ADR-0154), avec des
textes que l'APIX avait validés.

## Décision

**Le N+2 est l'évaluateur du N+1** pour la campagne : l'évaluateur que
l'administration a choisi pour le N+1, sinon le N+1 du N+1 dans
l'organigramme. Quand le N+1 est au sommet de l'organigramme, l'agent n'a
pas de N+2 : la fiche s'arrête à la validation de l'agent.

**La fiche arrive chez le N+2 dès que l'agent l'a validée**, sans geste du
N+1. Sur son accueil, une section « Commentaires du N+2 » réunit les agents
des équipes de ses N+1, rangés par N+1, en deux groupes : les fiches
validées par l'agent, qui s'ouvrent (« À commenter » en orange, puis
« Commentaires transmis »), et les autres, avec l'étape où elles en sont
(« Auto-évaluation en attente », « Chez le N+1 », « Chez l'agent »). Chaque
carte dit le N+1 de l'agent.

**Le N+2 lit la fiche entière**, partie réservée comprise, sur la page de
l'agent (`/evaluation-annuelle/n2/{agent}`), sous l'en-tête de l'agent et
ses trois étapes : l'auto-évaluation, l'évaluation du N+1, les commentaires
du N+2. Ses commentaires ferment la partie réservée, après les observations
du N+1. Ils s'enregistrent seuls, et la barre collée au bas de l'écran porte
« Transmettre au N+1 ». Le commentaire est facultatif ; la confirmation
reprend les textes de la plateforme de base :

- « Vos commentaires seront transmis au N+1. Vous ne pourrez plus les
  modifier. »
- sans commentaire : « La fiche sera renvoyée au N+1 sans commentaire de
  votre part. Vous ne pourrez plus la commenter. »

**Chez le N+1**, une troisième étape, « Commentaires du N+2 », avec le nom
du N+2 : « Chez le N+2 », puis « Reçus le … ». Transmis, les commentaires
ferment la partie réservée, avec le nom du N+2 et le jour ; sans
commentaire, « Néant ». Sur la carte de l'équipe : « Chez le N+2 », puis
« Validée par le N+2 » ; sans N+2, la carte reste à « Validée par
l'agent ». Avec les commentaires du N+2, la partie réservée a deux auteurs :
elle ne porte plus « Rempli par le N+1 », chaque partie dit le sien.

**L'agent ne les lit jamais** : ils restent dans la partie réservée, que sa
page ne reçoit pas.

**L'API** : `GET /v1/campagne/n2/{agent}`, `PUT …/commentaires` (le
brouillon) et `POST …/commentaires/transmission`, avec `{ commentaires }`
(2 000 caractères au plus, vide accepté). L'accès est réservé au N+2 de
l'agent (sinon 404, `campagne.agent_hors_perimetre`), une fois la fiche
validée par l'agent (409, `campagne.fiche_non_validee`) et tant que les
commentaires ne sont pas transmis (409, `campagne.commentaires_transmis`).
Aucune période ne les borne : la fiche arrive au N+2 quand l'agent la
valide, même après la fin de la période. L'accueil rend la section du N+2
(`aCommenter`) ; la fiche que lit le N+1, le N+2 et ses commentaires une
fois transmis.

**La migration 0141** ajoute à `fiches_entretien` : `commentaires_n2`,
`commentaires_n2_par`, qui les a écrits, et `commentaires_n2_transmis_le`.

## Conséquences

- Le PDF complet portera ces commentaires en 8.3, avec la mention
  « Validation en ligne » et le jour.
- Un N+2 sans réponse garde la fiche : la transmission à la DCH dira qui
  peut la reprendre, comme le N+1 le pouvait sur la plateforme de base
  (ADR-0156).
