-- APIX Academy (ADR-0049) : l'évaluation n'a plus de limite de temps, et une
-- formation sans évaluation délivre un certificat à qui en a validé toutes
-- les leçons. Ce certificat n'a pas de score : il atteste une formation
-- suivie en entier, pas une évaluation réussie.
--
-- Les copies laissées ouvertes au-delà de leur heure limite ont compté pour
-- un échec, et l'écran les montrait ainsi : elles le restent, rendues à
-- l'heure où leur temps s'est écoulé. Celles encore dans leur temps restent
-- ouvertes, désormais sans limite.
SET lock_timeout = '5s';

UPDATE academy_quiz_attempts
   SET submitted_at = expires_at, score = 0, passed = false
 WHERE submitted_at IS NULL
   AND expires_at < now() - interval '30 seconds';

-- Une copie n'a plus d'heure limite : les nouvelles laissent la colonne vide.
ALTER TABLE academy_quiz_attempts ALTER COLUMN expires_at DROP NOT NULL;

-- Le certificat d'une formation sans évaluation n'a pas de score.
ALTER TABLE academy_certificates ALTER COLUMN score DROP NOT NULL;
