# ADR-0074 : Notifications, la plateforme et le courriel, sans WhatsApp

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0028](0028-notifications-reglees-par-sujet.md) : WhatsApp en
est retiré ; le réglage sujet par sujet et la pause pendant les congés ne
changent pas.

## Contexte

L'ADR-0028 offrait trois canaux : la plateforme, le courriel et WhatsApp,
sur un numéro vérifié par un code. Finalement, les notifications ne passent
pas par WhatsApp : la plateforme et le courriel suffisent.

## Décision

**Deux canaux.** Chaque sujet se règle dans la plateforme et par courriel,
cochés tous deux sans réglage. La page « Notifications » perd la carte
WhatsApp (le numéro, son code, les heures calmes) et la colonne WhatsApp ;
« Pendant mes congés » dit désormais : dans la plateforme seulement, sans
courriel.

**Plus rien ne part sur WhatsApp.** L'expéditeur, ses transports (Meta, la
boîte de développement), les routes du numéro et du code, les réglages
`WHATSAPP_*` et les mots neutres des sujets sensibles sont retirés. Un écran
resté ouvert qui enverrait encore une case WhatsApp la voit ignorée.

**Rien ne se tait.** Un sujet qu'une personne ne recevait plus que sur
WhatsApp revient dans la plateforme. Les messages qui attendaient de partir
sont annulés.

**Les données suivent la règle des migrations (ADR-0010).** Les tables et
colonnes de WhatsApp (`whatsapp_verifications`, `outbound_whatsapp`, les
colonnes du numéro et des heures calmes, la case WhatsApp des sujets)
restent dans la base, inertes, le temps d'une livraison : la suivante les
supprime, numéros chiffrés compris, dans un fichier déclaré destructif.
D'ici là, l'effacement définitif d'une personne y retire encore ses lignes.

## Conséquences

- Migration 0110 : la case WhatsApp des sujets prend faux d'elle-même ; les
  sujets qui n'étaient plus que sur WhatsApp reviennent dans la plateforme ;
  les messages en attente sont annulés.
- Une configuration qui garde des variables `WHATSAPP_*` ne gêne pas : elles
  sont ignorées.
- À la livraison suivante, une migration destructive supprime ce qui reste
  de WhatsApp (tables, colonnes, fonction `outbound_whatsapp_tenants`) ; elle
  s'applique avec `MIGRATIONS_DESTRUCTIVES`.
