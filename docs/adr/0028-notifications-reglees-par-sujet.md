# ADR-0028 : Les notifications réglées par sujet : plateforme, courriel, WhatsApp

**Statut** : acceptée · 2026-10-07

## Contexte

Toute notification arrivait dans la plateforme et partait par courriel, sans
choix possible. Un agent recevait autant de courriels que de notifications,
un directeur ou un délégué de la DCH bien davantage. Rien ne permettait non
plus de joindre quelqu'un là où il lit vraiment ses messages : WhatsApp.

## Décision

**Une page « Notifications »**, ouverte depuis le menu du compte et depuis
la roue de la cloche, dans tous les espaces. Elle liste les sujets que la
personne reçoit réellement, selon son profil et son poste, en trois cartes :
Mon espace, Mon équipe (qui a une équipe), Gestion RH (selon les
habilitations et la direction de la DCH). Pour chaque sujet, trois cases :
Plateforme, Courriel, WhatsApp. Une case en tête de colonne coche ou décoche
toute la carte.

**Le sujet, pas le type.** Le catalogue des sujets vit dans
`packages/contracts` (`SUJETS`) avec la règle qui dit qui le reçoit. Chaque
appel à `notifier` porte son sujet, obligatoire au typage : une notification
sans sujet ne compile pas. Un rappel hérite du sujet de l'appel qu'il
rappelle. Les notifications passées reçoivent le leur par la migration 0093.

**Par défaut, rien ne change** : plateforme et courriel cochés, WhatsApp
non. Seuls les sujets changés ont une ligne (`notification_preferences`).

**La notification naît toujours.** Décochée de la plateforme, elle existe
quand même (`dans_la_plateforme = false`) : ses clés de doublon, de
remplacement et de rappel continuent de jouer, et le courriel ou le
WhatsApp se demande au départ s'il a encore lieu d'être.

**WhatsApp, sur un numéro vérifié.**

- Le numéro se vérifie par un code à six chiffres envoyé sur WhatsApp :
  valable dix minutes, cinq essais, un code par minute, cinq par jour. Le
  code est haché ; le numéro est chiffré au repos, l'écran n'en montre que le
  début et la fin. Le mobile du dossier est proposé, pas imposé.
- La colonne WhatsApp ne s'ouvre qu'une fois le numéro vérifié. Retirer le
  numéro arrête tout envoi.
- Les messages passent par une file (`outbound_whatsapp`), comme les
  courriels : dans la transaction du geste, puis un expéditeur sous verrou,
  avec des essais espacés. Le numéro ne voyage pas avec le message : il se
  lit au départ.
- Au départ, le message ne part pas si la notification a été lue ou rangée,
  remplacée, si WhatsApp a été décoché pour ce sujet, si l'accès a été coupé,
  ou si la personne est en congé avec la pause.
- Les sujets sensibles (congés, pièces, formations, congés à traiter)
  partent sur WhatsApp avec un texte discret (« Votre demande de congé a du
  nouveau »), jamais le détail : un téléphone se lit par-dessus l'épaule.
- Deux modèles Meta : `notification_rh` (UTILITY) et `code_verification`
  (AUTHENTICATION). En développement, le transport `boite` dépose chaque
  message dans Mailpit ; il est refusé en production.

**Deux réglages pour tous les sujets.**

- Heures calmes, cochées par défaut : pas de WhatsApp le soir, le week-end
  ni les jours fériés. Le message attend le prochain jour ouvré à 8 h
  (Africa/Dakar). Un code de vérification part toujours tout de suite.
- Pendant mes congés, non coché par défaut : en congé, la plateforme
  seulement, ni courriel ni WhatsApp. « En congé » se lit comme pour la DCH :
  une absence approuvée qui éloigne (une mission laisse joignable).

## Conséquences

- Une nouvelle notification sans sujet ne passe pas le typage ; un nouveau
  sujet s'ajoute au catalogue avec la règle de qui le reçoit.
- Le courriel d'une notification porte un lien « Gérer mes notifications ».
- L'effacement définitif d'une personne efface aussi ses réglages, ses
  vérifications et ses messages en file.
- Pour WhatsApp en production : un numéro professionnel dans Meta Business
  Manager, les deux modèles approuvés, `WHATSAPP_TRANSPORT=meta`,
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Sans eux, la carte WhatsApp
  ne s'affiche pas et le reste fonctionne.
