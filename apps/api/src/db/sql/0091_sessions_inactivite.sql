-- La session se ferme après trois jours sans activité.
--
-- Jusqu'ici, une session durait douze heures, qu'on s'en serve ou non. Elle
-- dure désormais tant qu'on s'en sert : chaque geste de l'agent la
-- prolonge, et trois jours sans geste la ferment. Une limite absolue
-- demeure (trente jours) : il faut alors se reconnecter. Les relevés
-- automatiques de la page (la cloche, les compteurs) ne comptent pas comme
-- une activité : un onglet resté ouvert ne garde pas la session en vie.
SET lock_timeout = '5s';

ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
