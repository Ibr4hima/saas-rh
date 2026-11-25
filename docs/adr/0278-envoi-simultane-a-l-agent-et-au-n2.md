# ADR-0278 : La fiche part à l'agent et, au choix du N+1, au N+2 en même temps

**Statut** : acceptée · 2026-11-24 · révise l'[ADR-0218](0218-commentaires-du-n2.md), l'[ADR-0221](0221-transmission-a-la-dch.md) et l'[ADR-0255](0255-fiches-a-commenter.md)

## Contexte

Jusqu'ici, la fiche arrivait chez le N+2 dès que l'agent avait validé son
évaluation (ADR-0218), sans geste du N+1. Les étapes se suivaient :
l'agent, puis le N+2, puis le N+1, qui transmettait à la DCH. L'APIX veut
que le N+1 décide si la fiche passe par le N+2, et que l'agent et le N+2
travaillent en même temps, pour limiter les attentes.

## Décision

**Le choix se fait à la transmission de l'évaluation.** Dans la fenêtre
« Transmettre l'évaluation ? », sous le texte de l'ADR-0266, une case
« Envoyer aussi la fiche au N+2, [nom] », décochée au départ, et dessous :
« Après la transmission, la fiche ne pourra plus être envoyée au N+2. »
L'agent reçoit toujours l'évaluation : sa validation reste obligatoire.
Sans N+2 (le N+1 au sommet de l'organigramme), la case n'apparaît pas.

C'est le seul moment de cet envoi : la validation de l'agent ne déclenche
plus rien vers le N+2, et le N+1 ne peut plus envoyer la fiche ensuite.

**Envoyée, la fiche arrive chez le N+2 en même temps que chez l'agent.**
Le N+2 la trouve dans « Fiches d'évaluation à commenter » (ADR-0255), la
lit en entier, partie réservée comprise, et transmet ses commentaires au
N+1 (ADR-0218), sans attendre la validation de l'agent. Sur sa page,
l'étape « Évaluation par le N+1 » dit « Transmise le … », puis « Validée
le … » ; l'étape « Commentaires du N+2 », « Fiche reçue le … ».

**Le N+1 suit l'agent et le N+2** sur la barre au bas de la page de
l'agent, sur deux lignes : « Chez l'agent, [nom], depuis le … », puis
« Validée par [nom] le … » ; « Chez le N+2, [nom], depuis le … », puis
« Commentaires du N+2 reçus le … » ou « Reprise au N+2 le … ».

**La reprise au N+2 est définitive.** Tant que le N+2 n'a pas transmis ses
commentaires, le N+1 peut reprendre la fiche, avant comme après la
validation de l'agent : « [nom] ne pourra plus la commenter, mais en
gardera une copie. La reprise est définitive. » Le N+2 ne peut plus la
commenter ni la valider ; la fiche reste sur son accueil (« Reprise par le
N+1 ») et s'ouvre en lecture, sans la zone des commentaires. « Renvoyer au
N+2 » disparaît, avec sa route `POST …/renvoi-n2`.

**La transmission à la DCH** demande la validation de l'agent puis, quand
la fiche a été envoyée au N+2, ses commentaires ou la reprise. Sans envoi
au N+2, le N+1 transmet dès la validation. Le PDF porte la validation en
ligne du N+1 et celle de l'agent, et celle du N+2 seulement quand ses
commentaires ont été transmis. Chez la DCH, l'étape « Commentaires du
N+2 » dit « Reçus le … », « Fiche reprise le … » ou « Fiche non envoyée ».
Dans le suivi, une fiche validée et envoyée au N+2 reste « Chez le N+2 »
jusqu'aux commentaires ou à la reprise.

**L'API** : `POST /v1/campagne/equipe/{agent}/evaluation/transmission`
accepte `envoyerAuN2` (faux par défaut) ; sans N+2, 409
`campagne.sans_n2`. Sans envoi, les commentaires du N+2 se refusent : 409
`campagne.fiche_non_envoyee`, à la place de `campagne.fiche_non_validee`.
La vue du N+1 gagne `envoyeeAuN2Le`, celle du N+2 `envoyeeLe` et
`repriseLe`. Reprise, la fiche se lit toujours chez le N+2 :
`campagne.fiche_reprise` ne refuse plus que l'écriture.

**La migration 0147** ajoute `envoyee_n2_le` à `fiches_entretien`. Les
fiches déjà transmises à l'agent suivent la règle d'avant, qui les
envoyait au N+2 : elles sont envoyées depuis leur transmission. La remise
à zéro (ADR-0270, ADR-0271) efface aussi cette colonne.

## Conséquences

- Une fiche transmise sans envoi au N+2 n'aura pas de commentaires du N+2 :
  la décision revient au N+1, au moment de la transmission.
- Le N+2 peut commenter une évaluation que l'agent n'a pas encore validée.
- Sur la page du N+1, la bande des étapes ne change pas (ADR-0252) : le
  suivi du N+2 se lit sur la barre du bas.
