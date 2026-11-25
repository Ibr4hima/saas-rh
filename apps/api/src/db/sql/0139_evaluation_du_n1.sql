-- L'évaluation du N+1 sur la fiche d'entretien (ADR-0216) : ce que le N+1
-- écrit après l'auto-évaluation de l'agent, la partie strictement réservée
-- à la hiérarchie à part, que l'agent ne lit jamais. Puis qui l'a écrite,
-- et le moment de sa transmission à l'agent.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN evaluation jsonb,
  ADD COLUMN reservee jsonb,
  ADD COLUMN evaluation_par_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN evaluation_transmise_le timestamptz;
