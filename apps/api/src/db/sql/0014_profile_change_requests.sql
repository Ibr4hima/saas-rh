-- =============================================================================
-- 0014 — Demandes de mise à jour des informations personnelles.
--
-- Même principe que les demandes de documents : l'employé est le mieux placé
-- pour savoir qu'il a déménagé, qu'il s'est marié ou qu'il a changé de numéro.
-- La RH ne peut pas le deviner. Il propose donc la correction, la RH la
-- confirme, et le dossier se met à jour tout seul.
--
-- Seuls les champs de la VIE PRIVÉE sont concernés (situation matrimoniale,
-- adresse, courriel personnel, téléphone, contact d'urgence). L'identité, les
-- pièces d'identité et tout ce qui relève du contrat restent la main de la RH :
-- ils s'appuient sur un document, pas sur une déclaration.
--
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE profile_change_requests (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  employee_id          uuid NOT NULL REFERENCES employees (id),
  /* Champs proposés : { "city": "Thiès", "maritalStatus": "married" }.
     La liste des clés autorisées vit dans les contrats Zod et est REVALIDÉE
     à l'application — on n'injecte jamais un jsonb brut dans un UPDATE. */
  changes              jsonb NOT NULL,
  /* Valeurs au moment de la demande : permet à la RH de voir « avant → après »
     et de repérer qu'un champ a bougé entre-temps. */
  previous             jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* Mot de l'employé : « déménagement », « mariage le 12 juin »… */
  note                 text,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by_user_id uuid NOT NULL REFERENCES users (id),
  handled_by_user_id   uuid REFERENCES users (id),
  /* Motif obligatoire en cas de refus. */
  hr_message           text,
  handled_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_change_requests_queue_idx
  ON profile_change_requests (tenant_id, status, created_at DESC);
CREATE INDEX profile_change_requests_employee_idx
  ON profile_change_requests (tenant_id, employee_id, created_at DESC);

-- Une seule demande en attente par employé : deux demandes concurrentes se
-- contrediraient sans que la RH puisse trancher laquelle prime.
CREATE UNIQUE INDEX profile_change_requests_one_pending
  ON profile_change_requests (tenant_id, employee_id)
  WHERE status = 'pending';

ALTER TABLE profile_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profile_change_requests
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER profile_change_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON profile_change_requests TO app_user;
