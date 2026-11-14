-- La disponibilité (ADR-0135) : l'agent s'éloigne du service pour des
-- années, sans solde à décompter, et renouvelle sa période avant qu'elle
-- prenne fin. Une demande en jours ouvrés ne la dit pas : la durée max d'un
-- type se donne désormais en jours ouvrés ou en années, l'un ou l'autre.
SET lock_timeout = '5s';

ALTER TABLE absence_types
  -- Au plus tant d'années par demande ; NULL : pas de plafond en années.
  ADD COLUMN max_years_per_request integer
    CONSTRAINT absence_types_duree_max_en_annees CHECK (max_years_per_request BETWEEN 1 AND 10),
  ADD CONSTRAINT absence_types_une_duree_max
    CHECK (max_days_per_request IS NULL OR max_years_per_request IS NULL),
  -- Renouvelable : l'agent demande, pendant sa période, la suivante, qui
  -- commence le lendemain de la fin. Elle se compte en années, comme elle.
  ADD COLUMN renouvelable boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT absence_types_renouvelable_en_annees
    CHECK (NOT renouvelable OR max_years_per_request IS NOT NULL);

ALTER TABLE absence_requests
  -- La demande que celle-ci renouvelle ; NULL : une demande comme une autre.
  ADD COLUMN renouvelle_id uuid REFERENCES absence_requests(id);

-- Les tenants en service reçoivent le type, sans quota, trois ans au plus,
-- renouvelable ; un nouveau le reçoit avec les autres, à la première
-- lecture. Un tenant qui l'a déjà, ou qui l'a retiré, est laissé tel quel.
INSERT INTO absence_types
  (id, tenant_id, name, deducts_balance, allowance_days, frequency, requires_document,
   max_years_per_request, renouvelable)
SELECT gen_random_uuid(), tn.id, 'Disponibilité', false, NULL, 'none', false, 3, true
  FROM tenants tn
 WHERE EXISTS (SELECT 1 FROM absence_types a WHERE a.tenant_id = tn.id AND a.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM absence_types a
                    WHERE a.tenant_id = tn.id AND lower(a.name) = 'disponibilité');
