# ADR-0152 : Les mises à jour d'informations se décident dans leur file, plus sur la fiche

**Statut** : acceptée · 2026-10-26 · remplace en partie l'[ADR-0080](0080-certificat-de-mariage.md)

## Contexte

Les changements qu'un agent signale (ADR-0014) se décident dans la file
« Mise à jour d'infos », où mène l'avis de chaque signalement. La fiche de
l'agent, dans la gestion du personnel, les montrait aussi, dans la carte
« Changements signalés » : en cours et traités, avec de quoi les confirmer
ou les refuser, et le certificat de mariage à ouvrir (ADR-0080).
Une même demande se décidait à deux endroits. L'APIX retire la carte de la
fiche.

## Décision

**La fiche d'un agent ne montre plus ses mises à jour d'informations**, ni
en cours ni traitées.

**Elles se décident dans la file « Mise à jour d'infos », et là seulement.**
Le certificat de mariage s'ouvre depuis la demande, dans cette file.

**Traitée, une mise à jour se lit ailleurs.** Validée, elle est au dossier,
et l'historique de la fiche garde la trace de l'état civil modifié ;
refusée, son motif se lit dans le suivi de l'agent (ADR-0081).

## Conséquences

- Qui consulte les dossiers sans traiter la file ne voit plus les mises à
  jour en attente, ni leur certificat ; validées, elles sont au dossier, et
  le certificat parmi ses pièces.
- L'API garde la lecture des demandes d'un agent par qui consulte les
  dossiers (`GET /v1/profile-changes?employeeId=`), et celle du certificat
  par qui voit les données sensibles : plus aucun écran ne s'en sert.
