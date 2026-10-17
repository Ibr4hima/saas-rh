# ADR-0081 : Le suivi des demandes porte aussi les mises à jour d'informations

**Statut** : acceptée · 2026-10-15

Précise l'[ADR-0043](0043-suivi-en-cours-puis-traitees.md) et
l'[ADR-0048](0048-nouvellement-traitees-en-evidence.md).

## Contexte

Une mise à jour d'informations refusée (ADR-0014) ne se lisait nulle part
chez l'agent : l'avis « Votre demande de mise à jour est refusée » menait à
la fiche, qui ne dit pas le motif. Sans lui, l'agent ne sait pas quoi
corriger. Validée, la mise à jour se voit sur la fiche : rien ne manque.

## Décision

**« Suivi de mes demandes » réunit les demandes de documents et les mises à
jour d'informations.** Les deux cartes restent : « Demandes en cours », puis
« Demandes traitées », la plus récente en tête. La première colonne devient
« Demande » : le document demandé, ou « Mise à jour d'infos » suivi de ce
qui change, avant et après.

**Refusée, une mise à jour dit son motif**, sous la demande, comme une
demande de documents refusée. En cours, elle s'annule d'un clic. Annulée,
elle n'y figure plus.

**L'avis d'un refus mène au suivi, sur la demande.** Comme pour une demande
de documents traitée (ADR-0048), « Demandes traitées » s'ouvre sur elle, en
évidence. L'avis d'une mise à jour validée mène toujours à la fiche.

## Conséquences

- L'en-tête de la première colonne du suivi passe de « Document » à
  « Demande ».
- Un avis de refus envoyé avant cette décision mène encore à la fiche ; la
  demande et son motif se lisent dans « Demandes traitées ».
