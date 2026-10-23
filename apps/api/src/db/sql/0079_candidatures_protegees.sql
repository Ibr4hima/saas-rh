-- Les candidatures, gardées comme des données qui ne regardent que la DCH.
--
-- · Au repos : le nom, l'adresse, le téléphone, le message et chaque pièce
--   (nom de fichier compris) se chiffrent dans l'application, liés à leur
--   ligne ; la base ne les voit plus en clair. `cle_version` dit comment une
--   ligne est chiffrée : vide, elle date d'avant et le migrateur la chiffre.
-- · Une adresse ne candidate qu'une fois par offre : l'index unique portait
--   sur l'adresse en clair, il porte désormais sur son empreinte à clé.
--   L'ancien reste le temps d'une version (expand/contract) ; sur des
--   adresses chiffrées il ne refuse plus rien.
-- · Le journal d'audit recopiait la candidature entière à chaque étape. Il
--   ne garde plus que les gestes : quelle candidature, quelle étape, qui,
--   quand. Les pièces y entrent (dépôt, retrait), sans leur contenu ni leur
--   nom.
-- · Chaque consultation se trace : qui a ouvert la liste d'une offre, qui a
--   ouvert quelle pièce. Ce journal-là ne garde aucune donnée du candidat ;
--   il survit à la suppression d'une candidature, et ne se réécrit pas.
SET lock_timeout = '5s';

ALTER TABLE applications
  ADD COLUMN cle_version smallint,
  ADD COLUMN email_index bytea;
CREATE UNIQUE INDEX applications_email_index_uniq
  ON applications (job_posting_id, email_index) WHERE email_index IS NOT NULL;

ALTER TABLE application_documents ADD COLUMN cle_version smallint;

-- Le journal : ce qui se garde d'une ligne, liste fermée. Une colonne ajoutée
-- plus tard n'y entre pas d'elle-même.
CREATE OR REPLACE FUNCTION audit_candidature() RETURNS trigger
LANGUAGE plpgsql AS
$$
DECLARE
  v_ref record;
  v_gardees CONSTANT text[] := ARRAY['id', 'tenant_id', 'job_posting_id', 'application_id',
    'stage', 'label', 'content_type', 'size_bytes', 'cle_version', 'created_at', 'updated_at'];
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN v_ref := OLD; ELSE v_ref := NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT jsonb_object_agg(k, v) INTO v_old FROM jsonb_each(to_jsonb(OLD)) e(k, v)
     WHERE k = ANY (v_gardees);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT jsonb_object_agg(k, v) INTO v_new FROM jsonb_each(to_jsonb(NEW)) e(k, v)
     WHERE k = ANY (v_gardees);
  END IF;
  INSERT INTO audit_log (tenant_id, table_name, row_id, action, actor_user_id, old_data, new_data)
  VALUES (v_ref.tenant_id, TG_TABLE_NAME, v_ref.id, TG_OP, app_user_id(), v_old, v_new);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER applications_audit
  AFTER INSERT OR UPDATE OR DELETE ON applications
  FOR EACH ROW EXECUTE FUNCTION audit_candidature();
CREATE TRIGGER application_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON application_documents
  FOR EACH ROW EXECUTE FUNCTION audit_candidature();

-- Les consultations. Pas de clé étrangère : la trace demeure quand la
-- candidature s'efface, et elle ne porte rien du candidat. Pas de trigger
-- d'audit : ce journal est lui-même append-only (ni UPDATE ni DELETE).
CREATE TABLE application_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  action          text NOT NULL CHECK (action IN ('list', 'document')),
  job_posting_id  uuid,
  application_id  uuid,
  document_id     uuid,
  actor_user_id   uuid NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_access_log_tenant_idx
  ON application_access_log (tenant_id, occurred_at DESC);

ALTER TABLE application_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_access_log FORCE ROW LEVEL SECURITY;
-- Chacun n'écrit que sa propre consultation.
CREATE POLICY tenant_isolation ON application_access_log
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id() AND actor_user_id = app_user_id());
GRANT SELECT, INSERT ON application_access_log TO app_user;
