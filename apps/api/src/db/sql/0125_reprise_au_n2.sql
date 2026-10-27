-- Chez le N+2, la grille ne part plus à la DCH : le N+1 attend l'avis du
-- N+2, ou reprend la grille (ADR-0156). La grille revient alors à l'étape
-- « validée par l'agent » ; le jour de la reprise se garde, pour le circuit.
-- Aucune ligne ne change.
SET lock_timeout = '5s';

ALTER TABLE evaluation_grilles ADD COLUMN reprise_n2_le timestamptz;
