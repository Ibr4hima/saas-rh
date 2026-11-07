-- Les documents officiels d'un agent : la liste des types qu'il dépose.
--
-- Décision APIX : Carte Nationale d'Identité, Passeport, Diplôme,
-- Certification, Attestation de travail, Attestation de stage, Curriculum
-- Vitæ. La « pièce d'identité » d'hier était, à l'APIX, la carte nationale ;
-- « autre » reste lisible sur les dépôts anciens, mais ne se dépose plus.
SET lock_timeout = '5s';

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;

UPDATE employee_documents SET category = 'cni' WHERE category = 'piece_identite';

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_category_check CHECK (category IN (
    'cni', 'passeport', 'diplome', 'certification',
    'attestation_travail', 'attestation_stage', 'cv', 'autre'));
