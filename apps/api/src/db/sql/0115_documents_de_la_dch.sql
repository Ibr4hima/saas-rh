-- La liste des documents à demander est celle de la DCH (ADR-0084).
--
-- Le contrat de travail, le bulletin de salaire et l'attestation de salaire
-- ne se demandent plus. Leurs demandes anciennes restent lisibles et se
-- traitent comme avant, par qui dirige la DCH.

-- Qui traitait les copies de contrat de travail traite les contrats qui le
-- remplacent : à durée déterminée, à durée indéterminée, de stage.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
SELECT gen_random_uuid(), h.tenant_id, 'demandes.documents.' || d.doc, h.employee_id,
       h.accordee_par_employee_id
  FROM habilitations h
 CROSS JOIN unnest(ARRAY['contrat_cdd', 'contrat_cdi', 'contrat_stage']) AS d(doc)
 WHERE h.capacite = 'demandes.documents.contrat_travail' AND h.fin_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM habilitations x
          WHERE x.tenant_id = h.tenant_id AND x.employee_id = h.employee_id
            AND x.capacite = 'demandes.documents.' || d.doc AND x.fin_at IS NULL);

-- Les délégations des documents retirés se closent, et restent dans
-- l'historique : leurs demandes encore ouvertes reviennent à qui dirige la
-- DCH, qui les traite toujours.
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite IN ('demandes.documents.contrat_travail',
                    'demandes.documents.bulletin_salaire',
                    'demandes.documents.attestation_salaire')
   AND fin_at IS NULL;
