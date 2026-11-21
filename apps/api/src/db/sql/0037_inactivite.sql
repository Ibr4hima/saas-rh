-- Actifs et inactifs.
--
-- Décision APIX : un agent devient inactif quand son contrat arrive à terme
-- (CDD, stage), quand il quitte l'APIX, est licencié, part à la retraite ou
-- décède. Le motif se garde : c'est lui qu'on lit dans la liste des
-- inactifs. La fin de contrat se pose d'elle-même, le lendemain du dernier
-- jour ; les autres, la DCH les choisit en désactivant le dossier.
--
-- Les dossiers désactivés avant la règle gardent un motif vide : on ne
-- l'invente pas.
ALTER TABLE employees
  ADD COLUMN inactivite_motif text
    CHECK (inactivite_motif IN ('fin_de_contrat', 'demission', 'licenciement', 'retraite', 'deces'));

-- Un dossier actif n'a pas de motif d'inactivité.
ALTER TABLE employees
  ADD CONSTRAINT employees_motif_si_inactif
    CHECK (status = 'archived' OR inactivite_motif IS NULL);
