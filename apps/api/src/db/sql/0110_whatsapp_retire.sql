-- WhatsApp quitte les notifications (ADR-0074) : elles se lisent dans la
-- plateforme ou par courriel. L'application n'écrit plus la colonne whatsapp
-- des sujets réglés ; elle prend désormais faux d'elle-même.
--
-- Les tables et colonnes de WhatsApp restent jusqu'à une livraison suivante,
-- qui les supprimera, numéros chiffrés compris, dans un fichier déclaré
-- destructif (ADR-0010).
ALTER TABLE notification_preferences ALTER COLUMN whatsapp SET DEFAULT false;

-- Un sujet qu'une personne ne recevait plus que sur WhatsApp ne doit pas se
-- taire : il revient dans la plateforme.
UPDATE notification_preferences
   SET plateforme = true, updated_at = now()
 WHERE whatsapp AND NOT plateforme AND NOT courriel;

-- Ce qui attendait de partir sur WhatsApp ne partira plus.
UPDATE outbound_whatsapp SET status = 'cancelled' WHERE status = 'pending';
