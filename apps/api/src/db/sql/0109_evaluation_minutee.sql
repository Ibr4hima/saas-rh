-- L'évaluation se compose de nouveau contre la montre (ADR-0073) : qui gère
-- le catalogue en règle la durée, en minutes, formation par formation. Elle
-- part de l'ancienne règle, deux minutes par question posée : vingt minutes
-- pour les dix questions par défaut.
ALTER TABLE academy_courses
  ADD COLUMN quiz_duration_minutes integer NOT NULL DEFAULT 20
    CONSTRAINT academy_courses_quiz_duration_minutes_check
    CHECK (quiz_duration_minutes BETWEEN 1 AND 180);

UPDATE academy_courses
   SET quiz_duration_minutes = 2 * quiz_question_count
 WHERE quiz_question_count <> 10;
