-- L'attestation de stage se demande comme l'attestation de travail, et se
-- délègue avec elle : qui traitait les attestations de travail traite
-- désormais aussi celles de stage.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
SELECT gen_random_uuid(), h.tenant_id, 'demandes.documents.attestation_stage', h.employee_id,
       h.accordee_par_employee_id
  FROM habilitations h
 WHERE h.capacite = 'demandes.documents.attestation_travail' AND h.fin_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM habilitations x
          WHERE x.tenant_id = h.tenant_id AND x.employee_id = h.employee_id
            AND x.capacite = 'demandes.documents.attestation_stage' AND x.fin_at IS NULL)
ON CONFLICT DO NOTHING;
