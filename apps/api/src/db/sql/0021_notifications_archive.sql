-- Archiver une notification sans la perdre.
--
-- La boîte est plafonnée à 30 lignes : passé ce seuil, une nouvelle
-- notification pousse la plus ancienne HORS de l'écran, sans que personne
-- l'ait décidé. Supprimer serait la seule échappatoire aujourd'hui, et une
-- suppression ne se rattrape pas — un rappel d'échéance de contrat rangé trop
-- vite disparaîtrait avec sa preuve.
--
-- `archived_at` sépare donc DEUX gestes qui étaient confondus : ranger (la
-- ligne quitte la boîte, reste consultable, reste restaurable) et supprimer
-- (elle n'existe plus). La colonne est nullable : toutes les notifications
-- existantes restent dans la boîte, aucune rétro-écriture.
--
-- L'index reprend `notifications_inbox_idx` en le RESTREIGNANT aux lignes non
-- archivées : c'est la lecture faite à chaque ouverture du panneau, et elle ne
-- doit pas se traîner l'historique rangé. Les archives, elles, se lisent
-- rarement et par un index dédié, plus étroit.
SET lock_timeout = '5s';

ALTER TABLE notifications ADD COLUMN archived_at timestamptz;

DROP INDEX IF EXISTS notifications_inbox_idx;
CREATE INDEX notifications_inbox_idx
  ON notifications (tenant_id, recipient_user_id, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX notifications_archive_idx
  ON notifications (tenant_id, recipient_user_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;
