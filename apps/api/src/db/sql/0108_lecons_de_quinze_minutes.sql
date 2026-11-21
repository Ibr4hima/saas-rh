-- Une leçon dure désormais quinze minutes au plus (ADR-0072), à une seconde
-- près : un enregistrement arrêté pile à 15:00 dure quelques centièmes de plus
-- une fois encodé. La contrainte s'élargit ; aucune ligne ne change.
ALTER TABLE academy_lessons
  DROP CONSTRAINT academy_lessons_duration_seconds_check,
  ADD CONSTRAINT academy_lessons_duration_seconds_check CHECK (
    duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 901)
  );
