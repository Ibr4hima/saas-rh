-- Un motif d'absence qui touche à la santé ne regarde que l'agent et la DCH.
--
-- Le N+1 vise les dates d'une demande ; il lisait aussi « Maladie », le motif
-- saisi (« Grippe ») et le nom du certificat, comme le tableau de bord de
-- l'agence. Un type confidentiel se montre à eux comme une absence, sans plus.
SET lock_timeout = '5s';

ALTER TABLE absence_types ADD COLUMN motif_confidentiel boolean NOT NULL DEFAULT false;

UPDATE absence_types SET motif_confidentiel = true WHERE name ILIKE '%maladie%';
