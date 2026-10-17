-- La remise en ligne d'un document demandé : qui traite la demande y dépose
-- le document, et l'agent le télécharge depuis son espace. Plus besoin de
-- passer au bureau, en télétravail ou en déplacement.
--
-- Un fichier tient à sa demande : déposé tant qu'elle est ouverte, il
-- n'apparaît à l'agent qu'une fois la demande prête. Il s'en va avec elle.
--
-- Chiffré au repos, comme les pièces des dossiers (0090) : le nom et le
-- contenu, pour SA place. Le journal garde le dépôt, le retrait et leur
-- auteur, sans le contenu (audit_piece, 0069).
SET lock_timeout = '5s';

CREATE TABLE document_request_files (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  request_id          uuid NOT NULL REFERENCES document_requests (id) ON DELETE CASCADE,
  filename            text NOT NULL,
  content_type        text NOT NULL
    CONSTRAINT document_request_files_type
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes          integer NOT NULL
    CONSTRAINT document_request_files_taille
    CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data                bytea NOT NULL,
  cle_version         smallint NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_request_files_request_idx ON document_request_files (request_id);

ALTER TABLE document_request_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_request_files
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER document_request_files_audit
  AFTER INSERT OR UPDATE OR DELETE ON document_request_files
  FOR EACH ROW EXECUTE FUNCTION audit_piece();

GRANT SELECT, INSERT, DELETE ON document_request_files TO app_user;
