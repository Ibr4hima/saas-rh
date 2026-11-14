-- La continuité du service (ADR-0129) : une demande d'absence qui laisserait
-- une délégation de demandes sans personne porte une alerte, et la DCH
-- l'apprécie. Chaque type d'absence dit s'il y est soumis : toujours (le
-- congé annuel), au-delà d'un jour (l'absence ponctuelle), ou jamais (la
-- maladie, la maternité, la mission…).
SET lock_timeout = '5s';

ALTER TABLE absence_types ADD COLUMN continuite text NOT NULL DEFAULT 'jamais'
  CHECK (continuite IN ('jamais', 'toujours', 'au_dela_d_un_jour'));

-- Les types en place : ce qui se décompte d'un solde y est toujours soumis,
-- ce qui se demande aussi à l'heure au-delà d'un jour.
UPDATE absence_types SET continuite = 'toujours' WHERE deducts_balance;
UPDATE absence_types SET continuite = 'au_dela_d_un_jour'
 WHERE allows_hours AND NOT deducts_balance;
