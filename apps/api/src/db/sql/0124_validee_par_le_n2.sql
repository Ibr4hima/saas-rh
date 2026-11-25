-- La grille que le N+2 valide revient au N+1, qui seul l'envoie à la DCH
-- (ADR-0154) : un état de plus, « validee_n2 ». La contrainte s'élargit ;
-- aucune ligne ne change.
ALTER TABLE evaluation_grilles
  DROP CONSTRAINT evaluation_grilles_etat_check,
  ADD CONSTRAINT evaluation_grilles_etat_check CHECK (
    etat IN ('brouillon', 'chez_agent', 'validee_agent', 'chez_n2', 'validee_n2', 'terminee')
  );
