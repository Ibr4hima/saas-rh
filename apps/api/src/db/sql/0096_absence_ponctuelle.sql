-- L'absence ponctuelle : l'agent demande à s'absenter quelques heures (un
-- rendez-vous), une journée ou deux (un baptême, un décès). Sans
-- justificatif, et pour une durée plafonnée que la DCH règle.
--
-- Un type peut donc se demander à l'heure : la demande garde alors ses
-- heures, sur un seul jour. Et tout type peut plafonner la durée d'une
-- demande, en jours ouvrés.
SET lock_timeout = '5s';

ALTER TABLE absence_types
  -- Se demande aussi à l'heure, sur un jour.
  ADD COLUMN allows_hours boolean NOT NULL DEFAULT false,
  -- Au plus tant de jours ouvrés par demande ; NULL : pas de plafond.
  ADD COLUMN max_days_per_request integer
    CONSTRAINT absence_types_duree_max CHECK (max_days_per_request BETWEEN 1 AND 365),
  -- Les soldes se tiennent en jours : ce qui s'en décompte se prend à la
  -- journée.
  ADD CONSTRAINT absence_types_heures_hors_solde CHECK (NOT (allows_hours AND deducts_balance));

ALTER TABLE absence_requests
  -- À l'heure : de telle heure à telle heure, le même jour. Sans heures, la
  -- demande prend des journées entières.
  ADD COLUMN start_time time,
  ADD COLUMN end_time time,
  ADD CONSTRAINT absence_requests_heures CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL
        AND start_date = end_date AND end_time > start_time)
  );

-- Deux absences ne se chevauchent toujours pas, à l'heure près désormais :
-- un rendez-vous le matin et un autre l'après-midi du même jour tiennent
-- ensemble ; aucun ne tient dans une journée déjà posée.
ALTER TABLE absence_requests DROP CONSTRAINT absence_requests_no_overlap;
ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_no_overlap EXCLUDE USING gist (
  tenant_id WITH =,
  employee_id WITH =,
  tsrange(start_date + coalesce(start_time, time '00:00'),
          coalesce(end_date + end_time, (end_date + 1)::timestamp), '[)') WITH &&
) WHERE (status IN ('pending', 'approved'));

-- Les tenants en service reçoivent le type ; un nouveau le reçoit avec les
-- autres, à la première lecture. Trois jours ouvrés au plus, en attendant
-- que la DCH fixe le sien.
INSERT INTO absence_types
  (id, tenant_id, name, deducts_balance, allowance_days, frequency, requires_document,
   allows_hours, max_days_per_request)
SELECT gen_random_uuid(), tn.id, 'Absence ponctuelle', false, NULL, 'none', false, true, 3
  FROM tenants tn
 WHERE EXISTS (SELECT 1 FROM absence_types a WHERE a.tenant_id = tn.id AND a.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM absence_types a
                    WHERE a.tenant_id = tn.id AND a.deleted_at IS NULL
                      AND lower(a.name) = 'absence ponctuelle');
