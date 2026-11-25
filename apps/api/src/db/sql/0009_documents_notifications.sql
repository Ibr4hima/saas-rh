-- =============================================================================
-- 0009 — Pièces justificatives du dossier employé + notifications in-app.
--
-- · employee_documents : CNI/passeport, diplômes, attestations… déposés par
--   l'employé OU par la RH. La partie qui n'a PAS déposé vérifie la
--   conformité puis valide (validation croisée) : le document ne rejoint le
--   dossier qu'au statut « approved ».
-- · notifications : matérialisées PAR DESTINATAIRE (fan-out à l'écriture,
--   une ligne par utilisateur — pas de lecture partagée à arbitrer).
--   dedupe_key rend la génération idempotente (échéances de contrats
--   recalculées à chaque consultation sans jamais dupliquer).
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE employee_documents (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  employee_id         uuid NOT NULL REFERENCES employees (id),
  category            text NOT NULL
    CHECK (category IN ('piece_identite', 'diplome', 'attestation_travail', 'autre')),
  label               text NOT NULL,
  filename            text NOT NULL,
  content_type        text NOT NULL,
  size_bytes          integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data                bytea NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  uploaded_by_user_id uuid NOT NULL REFERENCES users (id),
  uploaded_by_side    text NOT NULL CHECK (uploaded_by_side IN ('employee', 'hr')),
  reviewed_by_user_id uuid REFERENCES users (id),
  reviewed_at         timestamptz,
  review_comment      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_documents_employee_idx
  ON employee_documents (tenant_id, employee_id, status, created_at DESC);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_documents
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- PAS de trigger d'audit : audit_row() copierait les octets du fichier
-- (cf. 0006/0008). Le cycle de vie est porté par status/reviewed_*.

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_documents TO app_user;

CREATE TABLE notifications (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  recipient_user_id uuid NOT NULL REFERENCES users (id),
  type              text NOT NULL,
  title             text NOT NULL,
  body              text,
  link              text,
  dedupe_key        text,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx
  ON notifications (tenant_id, recipient_user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uniq
  ON notifications (tenant_id, recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER notifications_audit
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON notifications TO app_user;
