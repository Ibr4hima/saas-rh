-- La vérification des documents officiels se délègue par familles, qui se
-- vérifient ensemble : la CNI et le passeport, les diplômes et les
-- certifications, les attestations de travail et de stage, le CV.
--
-- Une délégation d'avant, sur un seul type d'une famille, s'étend à l'autre :
-- le membre vérifiait déjà l'un, il vérifie désormais les deux.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
SELECT gen_random_uuid(), h.tenant_id, f.autre, h.employee_id, h.accordee_par_employee_id
  FROM habilitations h
  JOIN (VALUES
         ('demandes.pieces.cni', 'demandes.pieces.passeport'),
         ('demandes.pieces.passeport', 'demandes.pieces.cni'),
         ('demandes.pieces.diplome', 'demandes.pieces.certification'),
         ('demandes.pieces.certification', 'demandes.pieces.diplome'),
         ('demandes.pieces.attestation_travail', 'demandes.pieces.attestation_stage'),
         ('demandes.pieces.attestation_stage', 'demandes.pieces.attestation_travail')
       ) AS f (capacite, autre) ON f.capacite = h.capacite
 WHERE h.fin_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM habilitations x
          WHERE x.tenant_id = h.tenant_id AND x.employee_id = h.employee_id
            AND x.capacite = f.autre AND x.fin_at IS NULL)
ON CONFLICT DO NOTHING;
