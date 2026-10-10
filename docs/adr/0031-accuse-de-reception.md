# ADR-0031 : L'accusé de réception d'une candidature, et des courriels sans réponse

**Statut** : acceptée · 2026-10-07

## Contexte

Un candidat qui postulait ne recevait rien : seul l'écran lui disait que
son dossier était arrivé. Les courriels de la plateforme, eux, pouvaient
recevoir des réponses que personne ne lit : un candidat qui répond à son
refus, une absence du bureau renvoyée à chaque notification.

## Décision

**Déposer, c'est recevoir un accusé de réception.** Le dépôt met en file,
dans sa transaction, un courriel « Nous avons bien reçu votre candidature
au poste de … » : le dossier est arrivé, il sera étudié, la réponse viendra
par courriel. Signé de la Direction du Capital Humain, au nom d'APIX S.A,
avec la référence de l'offre. Comme le refus (0029), il ne recopie pas
l'adresse du candidat (migration 0095) ; la candidature supprimée avant
son départ, il ne part pas. Un dépôt refusé n'accuse rien.

**Aucune réponse automatique.** Chaque courriel porte
`Auto-Submitted: auto-generated` et `X-Auto-Response-Suppress: All`
(Microsoft Graph n'accepte que le second) : ni absence du bureau ni accusé
de lecture ne reviennent. Chaque courriel finit par « Message automatique,
merci de ne pas y répondre. »

**Une réponse écrite à la main ne s'empêche pas.** Aucun en-tête ni aucune
messagerie ne retire le bouton « Répondre » chez le destinataire. Pour
qu'elle échoue aussitôt plutôt que de se perdre, l'adresse d'envoi
(`MAIL_FROM`, ou la boîte Microsoft 365) doit être une boîte « ne pas
répondre » qui refuse le courrier entrant : l'expéditeur reçoit alors tout
de suite un avis de non-remise. C'est un réglage de la messagerie de
l'APIX, pas de la plateforme.

## Conséquences

- Le pied de tous les courriels change (une ligne de plus).
- Au déploiement : créer la boîte « ne pas répondre » et sa règle de refus,
  puis la déclarer dans `MAIL_FROM` (et `GRAPH_SENDER` pour Microsoft 365).
