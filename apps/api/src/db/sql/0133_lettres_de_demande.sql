-- La lettre de demande (ADR-0189) : une mise en disponibilité, son
-- renouvellement et une domiciliation bancaire se demandent par lettre.
-- L'agent la joint à sa demande ; qui traite la demande la lit avant
-- d'établir le document.
--
-- Une lettre par demande, qui s'en va avec elle. Pour une décision de
-- disponibilité, la date écrite sur la lettre l'accompagne : la décision la
-- cite (« par lettre en date du … »). La domiciliation reprend le jour de
-- l'envoi, celui de la demande.
--
-- Chiffrée au repos, comme les pièces des dossiers (0090) : le nom et le
-- contenu, pour SA place. Le journal garde le dépôt, le retrait et leur
-- auteur, sans le contenu (audit_piece, 0069).
SET lock_timeout = '5s';

CREATE TABLE document_request_lettres (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  request_id          uuid NOT NULL REFERENCES document_requests (id) ON DELETE CASCADE,
  filename            text NOT NULL,
  content_type        text NOT NULL
    CONSTRAINT document_request_lettres_type CHECK (content_type = 'application/pdf'),
  size_bytes          integer NOT NULL
    CONSTRAINT document_request_lettres_taille
    CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data                bytea NOT NULL,
  cle_version         smallint NOT NULL,
  -- La date écrite sur la lettre : pour une décision de disponibilité.
  datee               date,
  uploaded_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Une lettre par demande.
  CONSTRAINT document_request_lettres_une_par_demande UNIQUE (request_id)
);

ALTER TABLE document_request_lettres ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_lettres FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_request_lettres
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER document_request_lettres_audit
  AFTER INSERT OR UPDATE OR DELETE ON document_request_lettres
  FOR EACH ROW EXECUTE FUNCTION audit_piece();

GRANT SELECT, INSERT, DELETE ON document_request_lettres TO app_user;
