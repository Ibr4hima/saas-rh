-- La maladie n'est plus un motif réservé à la DCH (ADR-0171) : le N+1 qui
-- vise la demande y lit « Maladie », comme le type de toute autre absence.
-- La migration 0076 l'avait réservée dans chaque organisation. La case reste
-- dans la fenêtre d'un type : un autre motif réservé le reste.
SET lock_timeout = '5s';

UPDATE absence_types SET motif_confidentiel = false
 WHERE name ILIKE '%maladie%' AND motif_confidentiel;
