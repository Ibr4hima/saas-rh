-- Une disponibilité dure deux ans au plus, renouvelable (ADR-0172), et non
-- plus trois. La migration 0120 avait posé le type « Disponibilité » avec
-- trois ans dans chaque organisation : il passe à deux ans là où il les a
-- gardés. Une durée que la DCH a changée reste la sienne, et les demandes
-- déjà faites ne bougent pas.
SET lock_timeout = '5s';

UPDATE absence_types SET max_years_per_request = 2, updated_at = now()
 WHERE lower(name) = 'disponibilité' AND max_years_per_request = 3 AND deleted_at IS NULL;
