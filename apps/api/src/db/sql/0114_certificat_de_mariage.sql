-- Le certificat de mariage (ADR-0080) : passer à « Marié(e) » se signale
-- avec lui, celui que délivre la mairie.
--
-- Joint à la demande de mise à jour, il attend la décision de qui vérifie
-- les mises à jour d'informations, qui s'y fie pour valider ou non. Validée,
-- la demande le verse au dossier, parmi les pièces vérifiées ; refusée ou
-- annulée, elle l'emporte. Il ne passe pas par la file des pièces.
--
-- Chiffré au repos, comme les pièces des dossiers (0090) : le nom et le
-- contenu, pour SA place. Le journal garde le dépôt et le retrait, et leur
-- auteur, sans le contenu (audit_piece, 0069).
SET lock_timeout = '5s';

-- Un type de pièce de plus au dossier : la contrainte s'élargit, rien ne se perd.
ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;
ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_category_check CHECK (category IN (
    'cni', 'passeport', 'diplome', 'certification',
    'attestation_travail', 'attestation_stage', 'cv', 'autre', 'certificat_mariage'));

CREATE TABLE profile_change_documents (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  request_id          uuid NOT NULL REFERENCES profile_change_requests (id) ON DELETE CASCADE,
  category            text NOT NULL
    CONSTRAINT profile_change_documents_category CHECK (category = 'certificat_mariage'),
  filename            text NOT NULL,
  content_type        text NOT NULL
    CONSTRAINT profile_change_documents_type CHECK (content_type = 'application/pdf'),
  size_bytes          integer NOT NULL
    CONSTRAINT profile_change_documents_taille
    CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data                bytea NOT NULL,
  cle_version         smallint NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Un certificat par demande.
  CONSTRAINT profile_change_documents_un_par_demande UNIQUE (request_id, category)
);

ALTER TABLE profile_change_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profile_change_documents
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER profile_change_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON profile_change_documents
  FOR EACH ROW EXECUTE FUNCTION audit_piece();

GRANT SELECT, INSERT, DELETE ON profile_change_documents TO app_user;
