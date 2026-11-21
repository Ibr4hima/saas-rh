-- Les documents officiels se vérifient type par type.
--
-- Décision APIX : comme les documents demandés, le directeur du Capital
-- Humain confie la vérification des diplômes à l'un, des pièces d'identité à
-- l'autre. Chaque dépôt va à qui vérifie ce type-là.
--
-- Qui vérifiait « les pièces » vérifie désormais chaque type : rien ne change
-- pour lui, et le directeur affine s'il le veut. Les délégations closes
-- restent telles qu'elles ont été.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT gen_random_uuid(), h.tenant_id, 'demandes.pieces.' || d.categorie, h.employee_id,
       h.accordee_par_employee_id, h.created_at
  FROM habilitations h
 CROSS JOIN unnest(ARRAY['passeport', 'diplome', 'certification', 'attestation_travail',
                         'attestation_stage', 'cv', 'autre']) AS d(categorie)
 WHERE h.capacite = 'demandes.pieces' AND h.fin_at IS NULL;

UPDATE habilitations SET capacite = 'demandes.pieces.cni'
 WHERE capacite = 'demandes.pieces' AND fin_at IS NULL;
