-- L'évaluation d'une fiche d'objectifs, semestre par semestre.
--
-- Décision APIX : au bout du semestre, l'agent s'auto-évalue — objectif par
-- objectif (atteint, partiellement, non atteint, et ce qu'il en dit), un
-- commentaire d'ensemble, l'appréciation qu'il se donne (A à D) — puis
-- l'envoie à son n+1. Le n+1 lit cette auto-évaluation, donne la note
-- globale (A à D) et son commentaire, et valide. L'agent en prend
-- connaissance. Chacun rédige au brouillon : rien ne se voit de l'autre
-- côté avant l'envoi ou la validation. Une fiche évaluée ne change plus.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches
  -- L'auto-évaluation de l'agent.
  ADD COLUMN auto_objectifs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(auto_objectifs) = 'array'),
  ADD COLUMN auto_commentaire text NOT NULL DEFAULT ''
    CHECK (length(auto_commentaire) <= 4000),
  ADD COLUMN auto_note text CHECK (auto_note IN ('A', 'B', 'C', 'D')),
  ADD COLUMN auto_modifiee_le timestamptz,
  ADD COLUMN auto_envoyee_le timestamptz,
  -- L'évaluation du n+1.
  ADD COLUMN evaluation_note text CHECK (evaluation_note IN ('A', 'B', 'C', 'D')),
  ADD COLUMN evaluation_commentaire text NOT NULL DEFAULT ''
    CHECK (length(evaluation_commentaire) <= 4000),
  ADD COLUMN evaluation_modifiee_le timestamptz,
  ADD COLUMN evaluee_le timestamptz,
  ADD COLUMN evaluateur_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  -- L'agent en a pris connaissance.
  ADD COLUMN signee_le timestamptz,
  ADD CONSTRAINT objectifs_fiches_envoi_note CHECK (auto_envoyee_le IS NULL OR auto_note IS NOT NULL),
  ADD CONSTRAINT objectifs_fiches_validation_note CHECK (evaluee_le IS NULL OR evaluation_note IS NOT NULL),
  ADD CONSTRAINT objectifs_fiches_signee_apres CHECK (signee_le IS NULL OR evaluee_le IS NOT NULL);
