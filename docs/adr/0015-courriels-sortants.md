# ADR-0015 : Courriels sortants, file dédiée, Mailpit en développement, Microsoft 365 en production

**Statut** : acceptée · 2026-10-06

## Contexte

La plateforme n'envoyait aucun courriel : la DCH copiait le lien d'invitation
au portail et le transmettait elle-même. Le premier courriel à partir est
donc l'invitation, et il porte un lien à usage unique qui ouvre un compte.

L'APIX utilise Microsoft 365 (Outlook). Il faut pouvoir tester sans rien
envoyer au dehors avant d'y brancher la production.

L'architecture (§5.1 du chapitre 02, ADR-0001) prévoit une outbox Postgres
relayée par pg-boss. pg-boss n'est pas encore installé, et aucun autre
événement de domaine ne passe encore par l'outbox.

## Décision

**Une file dédiée, `outbound_emails`, remplie dans la transaction du geste.**
Le geste annulé, rien ne part ; le geste validé, le courriel attend son envoi
même si l'API s'arrête. C'est l'outbox de §5.1, restreinte aux courriels.

**Le corps est chiffré** (AES-256-GCM, lié à sa ligne et à son organisation)
**et s'efface** dès que le courriel est parti, abandonné ou annulé. Restent le
destinataire, le sujet, les dates et l'issue. Pas de déclencheur d'audit : le
journal garderait le lien pour toujours, et la ligne est elle-même la trace.
L'effacement définitif d'un dossier emporte ses courriels.

**Un expéditeur dans l'API, en attendant pg-boss.** Il passe juste après le
geste puis toutes les 30 secondes ; il prend ses courriels sous verrou
(`FOR UPDATE SKIP LOCKED`, réservation de dix minutes), si bien que plusieurs
instances ne s'en disputent aucun. Un échec réessaie de plus en plus espacé
(1, 2, 4… minutes, au plus 6 heures), puis on y renonce au huitième. Un
courriel qui n'a plus lieu d'être (invitation remplacée, close ou acceptée)
est annulé au moment de partir. Un courriel peut arriver deux fois si une
instance tombe en plein envoi ; il ne se perd jamais.

**Deux transports, choisis par `MAIL_TRANSPORT`.**

- `smtp` : en développement, Mailpit (`pnpm mail:up`, lecture sur
  http://localhost:8025) garde tout dans une boîte de test. C'est le défaut
  en développement.
- `graph` : Microsoft 365 par l'API Microsoft Graph (`sendMail`), au nom
  d'une application enregistrée dans Entra ID, avec la permission
  d'application `Mail.Send` limitée à la seule boîte qui envoie
  (`rh@apix.sn`) par une stratégie d'accès Exchange. Pas de mot de passe de
  boîte dans la plateforme : un secret d'application, révocable, à durée
  limitée. Plutôt que SMTP AUTH, que Microsoft retire progressivement
  d'Exchange Online pour l'authentification par mot de passe.
- Sans configuration, en production : rien ne part, et l'écran revient au
  lien à transmettre à la main. Les tests n'envoient jamais rien.

## Conséquences

- L'écran « Accès au portail » dit si l'invitation est partie, en cours
  d'envoi, ou si l'envoi a échoué ; le lien reste copiable dans tous les cas.
- À l'arrivée de pg-boss, l'expéditeur devient un job : la table, le
  chiffrement, l'annulation et les transports ne changent pas.
- Les autres courriels (réinitialisation du mot de passe, ADR-0009 ;
  notifications) passeront par la même file, chacun avec son gabarit et sa
  règle d'annulation.
