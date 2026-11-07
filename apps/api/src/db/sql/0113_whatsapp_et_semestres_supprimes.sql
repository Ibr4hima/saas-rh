-- Destructif : supprime ce qui restait de WhatsApp (tables, colonnes, fonction, et les numéros recopiés dans le journal d'audit) et des semestres (fiches d'avant 0111, colonne du semestre, jours et dates par semestre), comme prévu par les ADR-0074 et ADR-0075.
--
-- WhatsApp a quitté les notifications à la 0110, les semestres les
-- objectifs à la 0111 : depuis, l'application ne lit ni n'écrit plus rien de
-- ce qui part ici. Ces livraisons l'avaient gardé le temps d'une version
-- (ADR-0010). Irréversible : faire la sauvegarde avant.
SET lock_timeout = '5s';

-- WhatsApp : la fonction de l'expéditeur, la file des messages, les numéros
-- en cours de vérification et leurs codes.
DROP FUNCTION outbound_whatsapp_tenants();
DROP TABLE outbound_whatsapp;
DROP TABLE whatsapp_verifications;

-- La case WhatsApp de chaque sujet ; le numéro de chaque personne (chiffré,
-- et sa forme masquée), sa vérification, ses heures calmes. Leurs
-- contraintes partent avec elles.
ALTER TABLE notification_preferences DROP COLUMN whatsapp;
ALTER TABLE notification_reglages
  DROP COLUMN whatsapp_numero_chiffre,
  DROP COLUMN whatsapp_numero_masque,
  DROP COLUMN whatsapp_verifie_le,
  DROP COLUMN heures_calmes;

-- Le journal avait recopié les numéros à chaque réglage : ils s'en vont
-- aussi. Les gestes restent (quel réglage, qui, quand).
UPDATE audit_log
   SET old_data = old_data - ARRAY['whatsapp_numero_chiffre', 'whatsapp_numero_masque', 'whatsapp_verifie_le'],
       new_data = new_data - ARRAY['whatsapp_numero_chiffre', 'whatsapp_numero_masque', 'whatsapp_verifie_le']
 WHERE table_name = 'notification_reglages'
   AND (old_data ?| ARRAY['whatsapp_numero_chiffre', 'whatsapp_numero_masque', 'whatsapp_verifie_le']
        OR new_data ?| ARRAY['whatsapp_numero_chiffre', 'whatsapp_numero_masque', 'whatsapp_verifie_le']);

-- Les semestres : les fiches telles qu'elles étaient avant 0111, gardées à
-- part ; la colonne du semestre (et la contrainte d'une fiche par semestre) ;
-- les jours des deux semestres (0104) ; les dates par année et par semestre
-- qui les avaient précédés (0103).
DROP TABLE objectifs_fiches_semestres;
ALTER TABLE objectifs_fiches DROP COLUMN semestre;
ALTER TABLE objective_review_schedule
  DROP COLUMN s1_month,
  DROP COLUMN s1_day,
  DROP COLUMN s2_month,
  DROP COLUMN s2_day;
DROP TABLE objective_review_dates;
