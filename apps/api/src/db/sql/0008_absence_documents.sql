-- =============================================================================
-- 0008 — Justificatifs d'absence + ajustements sénégalais.
-- · Un justificatif PDF par demande (attestation médicale, ordre de mission…),
--   exigé quand le type d'absence le requiert et que la demande vient de
--   l'employé lui-même.
-- · Congé annuel : 30 jours par défaut (au lieu de 24).
-- · Mission exige désormais un ordre de mission.
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE absence_documents (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  request_id   uuid NOT NULL UNIQUE REFERENCES absence_requests (id),
  filename     text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE absence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON absence_documents
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- PAS de trigger d'audit : audit_row() copierait les octets du PDF (cf. 0006).

GRANT SELECT, INSERT, DELETE ON absence_documents TO app_user;

-- Ajustements des types existants (les nouveaux tenants héritent des
-- défauts applicatifs mis à jour).
UPDATE absence_types SET default_annual_days = 30
  WHERE name = 'Congé annuel' AND default_annual_days = 24;
UPDATE absence_types SET requires_document = true
  WHERE name = 'Mission' AND requires_document = false;
