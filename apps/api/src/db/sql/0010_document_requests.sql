-- =============================================================================
-- 0010 — Demandes de documents administratifs (circuit « mains propres »).
--
-- Procédure sénégalaise (arbitrage Direction du Capital Humain, ADR-0012) :
-- un document officiel n'est jamais téléchargé par l'employé. Il le DEMANDE,
-- la RH le génère, l'imprime, le cachette et le signe, puis l'employé vient
-- le retirer. Le circuit tracé ici est donc :
--
--   received → processing → ready → delivered
--                    ↘ rejected (avec motif)
--
-- Une demande porte 1..N types de documents (tableau doc_types) : l'employé
-- coche ce dont il a besoin en une fois, la RH traite le lot.
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE document_requests (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  employee_id         uuid NOT NULL REFERENCES employees (id),
  /* Types demandés : attestation_travail, contrat_travail, bulletin_salaire,
     attestation_salaire, certificat_travail, autre. Contrôlé côté Zod ; en
     base, on garde un tableau texte non vide (les types évoluent avec la
     convention collective, pas avec un ALTER TABLE). */
  doc_types           text[] NOT NULL CHECK (cardinality(doc_types) > 0),
  /* Précision libre de l'employé : période du bulletin, motif (banque, visa…). */
  note                text,
  status              text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'ready', 'delivered', 'rejected')),
  requested_by_user_id uuid NOT NULL REFERENCES users (id),
  handled_by_user_id  uuid REFERENCES users (id),
  /* Nom affiché à l'employé pour le retrait (« Mme Fatou Sall, DCH »). */
  pickup_contact      text,
  /* Message libre de la RH joint à la mise à disposition ou au refus. */
  hr_message          text,
  processing_at       timestamptz,
  ready_at            timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_requests_queue_idx
  ON document_requests (tenant_id, status, created_at DESC);
CREATE INDEX document_requests_employee_idx
  ON document_requests (tenant_id, employee_id, created_at DESC);

ALTER TABLE document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_requests
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Pas de bytea ici (les documents sont remis en main propre) : l'audit
-- complet est donc sans risque de volume.
CREATE TRIGGER document_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON document_requests
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON document_requests TO app_user;
