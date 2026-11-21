-- =============================================================================
-- 0006 — Recrutement (lot 1) : offres, candidatures publiques, documents.
--
-- Deux faces :
--  · interne (admin/RH) : CRUD des offres, pipeline de tri des candidatures ;
--  · publique (sans compte) : une offre PUBLIÉE est lisible par quiconque
--    présente son slug (le lien partagé sur LinkedIn/WhatsApp). Le slug est
--    un identifiant public, pas un secret : il est stocké en clair.
--
-- Le dépôt de candidature suit le pattern des invitations (0004) : le slug
-- prouve le tenant, le code pose ensuite app.tenant_id dans la transaction et
-- les écritures passent par la policy tenant standard (audit compris).
--
-- Les fichiers (CV…) vivent en base (bytea) pour le pilote : volumes faibles,
-- RLS et sauvegardes gratuites. La bascule vers un object storage se fera
-- derrière la même interface si les volumes le justifient (expand/contract).
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Offres d'emploi
-- ---------------------------------------------------------------------------
CREATE TABLE job_postings (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  title              text NOT NULL,
  description        text NOT NULL,
  org_unit_id        uuid REFERENCES org_units (id),
  contract_type      text NOT NULL
    CHECK (contract_type IN ('cdi', 'cdd', 'stage', 'consultant', 'detachement')),
  location           text,
  deadline           date,
  required_documents text[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed')),
  public_slug        text NOT NULL UNIQUE,
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_postings_tenant_idx ON job_postings (tenant_id, status, created_at DESC);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_postings
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
-- Page publique : SEULE une offre publiée dont l'appelant présente le slug
-- est visible — jamais de listing, jamais de brouillon ni d'offre clôturée.
CREATE POLICY public_slug_read ON job_postings FOR SELECT
  USING (
    status = 'published'
    AND public_slug = NULLIF(current_setting('app.job_slug', true), '')
  );

CREATE TRIGGER job_postings_audit
  AFTER INSERT OR UPDATE OR DELETE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON job_postings TO app_user;

-- Le nom de l'organisation s'affiche sur la page publique de candidature.
CREATE POLICY job_slug_tenant_read ON tenants FOR SELECT
  USING (
    id IN (
      SELECT j.tenant_id FROM job_postings j
      WHERE j.status = 'published'
        AND j.public_slug = NULLIF(current_setting('app.job_slug', true), '')
    )
  );

-- ---------------------------------------------------------------------------
-- Candidatures
-- ---------------------------------------------------------------------------
CREATE TABLE applications (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  job_posting_id uuid NOT NULL REFERENCES job_postings (id),
  given_name     text NOT NULL,
  family_name    text NOT NULL,
  email          text NOT NULL,
  phone          text,
  message        text,
  stage          text NOT NULL DEFAULT 'received'
    CHECK (stage IN ('received', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX applications_pipeline_idx ON applications (tenant_id, job_posting_id, stage);
-- Une seule candidature par email et par offre (dédoublonnage public).
CREATE UNIQUE INDEX applications_email_uniq ON applications (job_posting_id, lower(email));

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON applications
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER applications_audit
  AFTER INSERT OR UPDATE OR DELETE ON applications
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- DELETE : remédiation RH quand un tiers a squatté l'email d'un candidat via
-- le formulaire public (supprimer la candidature libère l'index unique).
GRANT SELECT, INSERT, UPDATE, DELETE ON applications TO app_user;

-- ---------------------------------------------------------------------------
-- Documents de candidature (CV, lettre, diplômes…)
-- ---------------------------------------------------------------------------
CREATE TABLE application_documents (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  application_id uuid NOT NULL REFERENCES applications (id),
  label          text NOT NULL,
  filename       text NOT NULL,
  content_type   text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data           bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_documents_app_idx ON application_documents (tenant_id, application_id);

ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON application_documents
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- PAS de trigger d'audit ici : audit_row() copie to_jsonb(NEW), ce qui
-- dupliquerait les octets du fichier dans audit_log. Les documents sont
-- immuables (INSERT seul) ; la candidature, elle, est auditée.

GRANT SELECT, INSERT, DELETE ON application_documents TO app_user;
