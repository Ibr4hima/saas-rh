# ADR-0047 : Plus de « Se déconnecter partout » ; un signalement part sans précision

**Statut** : acceptée · 2026-10-09

## Contexte

Le menu du compte proposait « Se déconnecter partout » : fermer d'un geste
toutes ses sessions, sur tous ses appareils. La fenêtre « Signaler un
changement » portait un champ « Précision », facultatif, comme la demande
de document avant l'ADR-0044.

## Décision

**« Se déconnecter partout » quitte le menu du compte**, ainsi que la route
qui le servait (`POST /v1/auth/deconnecter-partout`) : plus aucun écran ne
l'appelait. Toutes les sessions d'un compte se ferment encore d'un coup
quand on coupe l'accès depuis la fiche de l'agent, et quand un nouveau mot
de passe est choisi par « Mot de passe oublié ». Une session se ferme aussi
seule après trois jours sans activité.

**Un signalement part sans précision.** « Signaler un changement » ne garde
que les quatre informations, et ce qui change se relit avant l'envoi.

## Conséquences

- Un appareil perdu se déconnecte en changeant de mot de passe par « Mot de
  passe oublié », ou en faisant couper puis rétablir l'accès.
- Les signalements faits avant gardent leur précision, lisible par la DCH.
- L'API accepte encore une précision ; l'écran n'en envoie plus.
