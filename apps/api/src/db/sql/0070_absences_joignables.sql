-- Une absence qui laisse l'agent joignable : en mission, on vise encore ses
-- demandes depuis le portail. Pendant ces absences-là, le N+1 garde la main
-- sur les congés de son équipe, et un membre de la DCH sur ce qu'il traite.
SET lock_timeout = '5s';

ALTER TABLE absence_types ADD COLUMN reste_joignable boolean NOT NULL DEFAULT false;

UPDATE absence_types SET reste_joignable = true WHERE lower(btrim(name)) = 'mission';
