-- La transmission de la fiche d'entretien à la DCH (ADR-0221) : le moment
-- où le N+1 reprend la fiche au N+2 qui ne l'a pas encore commentée, puis
-- le moment de sa transmission à la DCH, et qui l'a transmise. Transmise,
-- la fiche ne change plus.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN reprise_n2_le timestamptz,
  ADD COLUMN transmise_dch_le timestamptz,
  ADD COLUMN transmise_dch_par uuid REFERENCES employees (id) ON DELETE SET NULL;
