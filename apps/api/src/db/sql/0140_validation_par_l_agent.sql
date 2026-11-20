-- La validation de l'évaluation par l'agent (ADR-0217) : le moment où
-- l'agent la valide ; ou, en désaccord, le moment où l'agent la renvoie au
-- N+1, avec son mot. Le dernier renvoi reste écrit, même une fois
-- l'évaluation transmise à nouveau.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN validee_le timestamptz,
  ADD COLUMN renvoyee_le timestamptz,
  ADD COLUMN renvoi_mot text;
