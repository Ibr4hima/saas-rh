# ADR-0252 : La bande des étapes : sans les commentaires du N+2 chez le N+1, l'état en bleu

**Statut** : acceptée · 2026-11-22 · révise les ADR [0218](0218-commentaires-du-n2.md) et [0226](0226-auto-evaluation-faite-ou-non.md)

## Contexte

En tête de la page d'un agent, une bande numérote les étapes de sa fiche.
Chez le N+1, elle en comptait quatre : « Auto-évaluation », « Évaluation
du N+1 », « Commentaires du N+2 » avec le nom du N+2 (ADR-0218), et
« Transmission à la DCH ». Où en était chaque étape se lisait dans une
pastille de couleur : « Faite le 22 nov. » en vert, « En cours » en bleu,
« Non faite » en rouge (ADR-0226). L'APIX veut retirer l'étape des
commentaires du N+2 chez le N+1, et l'état en simple texte bleu.

## Décision

**Chez le N+1, trois étapes** : « Auto-évaluation », « Évaluation du N+1 »,
« Transmission à la DCH ». Les commentaires du N+2 se lisent toujours sur
la fiche, et la barre au bas de la page dit toujours ce qui attend le N+2.

**L'état de chaque étape s'écrit en bleu, sans pastille**, sous le titre de
l'étape : « Faite le 22 nov. », « En cours », « Validée le 20 nov. »…, et
« Non faite » aussi. Sur toutes les pages qui ont cette bande : celle du
N+1, celle du N+2 et celle de la DCH.

Les pages du N+2 et de la DCH gardent leur étape « Commentaires du N+2 » :
chez le N+2, c'est la sienne ; chez la DCH, elle dit si les commentaires
ont été reçus.

## Conséquences

- Sur ces pages, la couleur ne dit plus l'état : le texte le dit.
