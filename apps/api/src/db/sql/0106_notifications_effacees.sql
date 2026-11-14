-- Vider la boîte, vider les archives : la personne efface ses notifications
-- (ADR-0065).
--
-- Effacée, une notification ne se montre plus nulle part, ni dans la boîte
-- ni dans les archives, et son courriel ou son message WhatsApp, s'il attend
-- encore, ne part pas. La ligne reste pourtant dans la table, comme une
-- notification remplacée (0054) : sa clé (dedupe_key) reste prise, sans quoi
-- un rappel généré (férié, échéance de contrat, pièce qui expire)
-- reviendrait à la prochaine ouverture du panneau.
--
-- Colonne nullable : aucune notification n'est effacée aujourd'hui, aucune
-- rétro-écriture.
SET lock_timeout = '5s';

ALTER TABLE notifications ADD COLUMN effacee_le timestamptz;
