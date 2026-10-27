-- Les courriels qui partent de la plateforme.
--
-- Un courriel se met en file dans la transaction du geste qui l'appelle
-- (une invitation au portail) : le geste annulé, rien ne part ; le geste
-- validé, l'expéditeur l'envoie après coup, et réessaie si le serveur de
-- courrier ne répond pas (cf. l'outbox, architecture §5.1).
--
-- Le corps porte un lien à usage unique : il est chiffré, et s'efface dès que
-- le courriel est parti, qu'on y renonce, ou qu'il n'a plus lieu d'être (une
-- invitation remplacée, close ou acceptée avant l'envoi). Restent la trace (à qui, quel
-- sujet, quand) et l'issue. Pas de déclencheur d'audit pour cette raison : le
-- journal garderait le lien pour toujours ; la ligne elle-même est la trace.
SET lock_timeout = '5s';

CREATE TABLE outbound_emails (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  -- Ce qui l'a fait partir : 'invitation', et ce dont il parle (l'invitation).
  kind             text NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  subject_id       uuid,
  recipient        text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 320),
  subject          text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body_encrypted   text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  -- Parti, abandonné ou annulé, le corps n'est plus gardé.
  CONSTRAINT outbound_emails_corps_en_attente CHECK (status = 'pending' OR body_encrypted IS NULL),
  CONSTRAINT outbound_emails_envoye_date CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX outbound_emails_a_envoyer ON outbound_emails (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX outbound_emails_objet ON outbound_emails (tenant_id, subject_id);

ALTER TABLE outbound_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_emails FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbound_emails
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
-- DELETE : l'effacement définitif d'un dossier emporte ses courriels, qui
-- portent son adresse.
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_emails TO app_user;

-- L'expéditeur passe d'une organisation à l'autre : il apprend lesquelles
-- ont un courriel à envoyer, et rien d'autre. Il lit et envoie ensuite dans
-- le contexte de chacune, sous la RLS.
CREATE OR REPLACE FUNCTION outbound_email_tenants() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT DISTINCT tenant_id FROM outbound_emails
   WHERE status = 'pending' AND next_attempt_at <= now()
$$;
REVOKE ALL ON FUNCTION outbound_email_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbound_email_tenants() TO app_user;
