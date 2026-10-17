-- Les notifications, réglées par chacun.
--
-- Jusqu'ici, toute notification arrivait dans la plateforme et partait par
-- courriel. Chacun choisit désormais, sujet par sujet, où elle le trouve :
-- dans la plateforme, par courriel, sur WhatsApp. Sans réglage, rien ne
-- change : plateforme et courriel, pas de WhatsApp.
--
-- Une notification qu'on ne veut que par courriel ou WhatsApp naît quand
-- même : le courriel se compose d'elle, et elle dit s'il a encore lieu
-- d'être. Elle ne se montre simplement pas dans la plateforme.
SET lock_timeout = '5s';

ALTER TABLE notifications ADD COLUMN dans_la_plateforme boolean NOT NULL DEFAULT true;

-- Le sujet de la notification, celui que la personne règle. Toute nouvelle
-- notification le porte ; les anciennes le reçoivent ici, d'après leur type
-- et leur clé (un rappel suit l'appel qu'il rappelle). Il reste facultatif
-- tant qu'une version précédente de l'API peut encore écrire.
ALTER TABLE notifications ADD COLUMN sujet text CHECK (sujet ~ '^[a-z][a-z_.]{1,59}$');
UPDATE notifications SET sujet = CASE
  WHEN dedupe_key ~ '^conge:[^:]+:(appel|rappel):n1$' THEN 'equipe.conges'
  WHEN dedupe_key ~ '^reprise:[^:]+:(appel|rappel):n1$' THEN 'equipe.conges'
  WHEN dedupe_key ~ '^(conge|reprise):[^:]+:(appel|rappel):' THEN 'dch.conges'
  WHEN dedupe_key ~ '^objectifs:.*:(appel|rappel):' THEN 'equipe.objectifs'
  WHEN dedupe_key ~ ':(appel|rappel):a-confier$' THEN 'dch.delegations'
  WHEN dedupe_key ~ '^document:[^:]+:(appel|rappel):' THEN 'dch.documents'
  WHEN dedupe_key ~ '^information:[^:]+:(appel|rappel):' THEN 'dch.informations'
  WHEN dedupe_key ~ '^piece:[^:]+:(appel|rappel):' THEN 'dch.pieces'
  WHEN type IN ('conge_approuve', 'conge_refuse', 'conge_annule', 'conge_saisi') THEN 'conges'
  WHEN type LIKE 'document_request_%' AND type <> 'document_request_cancelled' THEN 'documents'
  WHEN type = 'document_request_cancelled' THEN 'dch.documents'
  WHEN type = 'document_reviewed' THEN 'pieces'
  WHEN type = 'document_expiry' THEN 'pieces.expiration'
  WHEN type LIKE 'profile_change_%' THEN 'informations'
  WHEN type IN ('academy_lecon_a_revoir', 'certificat_revoque', 'certificat_reemis') THEN 'academy'
  WHEN type = 'holiday_reminder' THEN 'feries'
  WHEN type IN ('contract_deadline', 'contract_ended') THEN 'dch.contrats'
  WHEN type IN ('delegation', 'delegation_rompue', 'demande_a_confier') THEN 'dch.delegations'
  WHEN type = 'dch_vacante' THEN 'admin.dch'
  WHEN type = 'objectif' AND (title LIKE '%de votre direction%' OR title LIKE '%orientations%') THEN 'objectifs.apix'
  WHEN type = 'objectif' THEN 'objectifs'
END;

-- Un sujet réglé par une personne : seuls les sujets qu'elle a changés ont
-- leur ligne. Le sujet est une clé du catalogue (packages/contracts).
CREATE TABLE notification_preferences (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sujet       text NOT NULL CHECK (sujet ~ '^[a-z][a-z_.]{1,59}$'),
  plateforme  boolean NOT NULL,
  courriel    boolean NOT NULL,
  whatsapp    boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_une_par_sujet UNIQUE (tenant_id, user_id, sujet)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER notification_preferences_audit
  AFTER INSERT OR UPDATE OR DELETE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO app_user;

-- Ce qui vaut pour tous les sujets d'une personne : son numéro WhatsApp
-- (chiffré ; l'écran n'en montre que le début et la fin), vérifié par un
-- code, ses heures calmes, la pause pendant ses congés.
CREATE TABLE notification_reglages (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants (id),
  user_id                  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  whatsapp_numero_chiffre  text,
  whatsapp_numero_masque   text CHECK (length(whatsapp_numero_masque) <= 40),
  whatsapp_verifie_le      timestamptz,
  -- Pas de WhatsApp le soir, le week-end ni les jours fériés : il attend.
  heures_calmes            boolean NOT NULL DEFAULT true,
  -- En congé : la plateforme seulement, ni courriel ni WhatsApp.
  pause_conges             boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_reglages_un_par_personne UNIQUE (tenant_id, user_id),
  CONSTRAINT notification_reglages_numero_entier
    CHECK ((whatsapp_numero_chiffre IS NULL) = (whatsapp_numero_masque IS NULL)),
  CONSTRAINT notification_reglages_verifie_avec_numero
    CHECK (whatsapp_verifie_le IS NULL OR whatsapp_numero_chiffre IS NOT NULL)
);

ALTER TABLE notification_reglages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reglages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_reglages
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER notification_reglages_audit
  AFTER INSERT OR UPDATE OR DELETE ON notification_reglages
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_reglages TO app_user;

-- Un numéro en cours de vérification : le code envoyé par WhatsApp, haché,
-- valable dix minutes, cinq essais. Le code en clair ne reste que le temps
-- de partir. Pas d'audit (comme le mot de passe oublié) : le journal
-- garderait de quoi retrouver un code ; la ligne elle-même est la trace.
CREATE TABLE whatsapp_verifications (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  numero_chiffre  text NOT NULL,
  numero_masque   text NOT NULL CHECK (length(numero_masque) <= 40),
  code_hash       text NOT NULL,
  code_chiffre    text,
  essais          integer NOT NULL DEFAULT 0 CHECK (essais >= 0),
  expire_le       timestamptz NOT NULL,
  utilisee_le     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_verifications_personne ON whatsapp_verifications (tenant_id, user_id, created_at);

ALTER TABLE whatsapp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_verifications
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_verifications TO app_user;

-- Les messages WhatsApp qui partent : une notification, ou un code. Comme
-- les courriels, ils se mettent en file dans la transaction du geste et
-- partent après, avec des essais de plus en plus espacés. Le numéro n'y est
-- pas : il se lit au départ (le numéro vérifié du jour, ou celui qu'on
-- vérifie), et un numéro retiré entre-temps annule l'envoi.
CREATE TABLE outbound_whatsapp (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  kind             text NOT NULL CHECK (kind IN ('notification', 'code')),
  -- La notification, ou la vérification dont il porte le code.
  subject_id       uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  CONSTRAINT outbound_whatsapp_envoye_date CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX outbound_whatsapp_a_envoyer ON outbound_whatsapp (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX outbound_whatsapp_objet ON outbound_whatsapp (tenant_id, subject_id);

ALTER TABLE outbound_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbound_whatsapp
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_whatsapp TO app_user;

-- L'expéditeur passe d'une organisation à l'autre : il apprend lesquelles
-- ont un message à envoyer, et rien d'autre.
CREATE OR REPLACE FUNCTION outbound_whatsapp_tenants() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT DISTINCT tenant_id FROM outbound_whatsapp
   WHERE status = 'pending' AND next_attempt_at <= now()
$$;
REVOKE ALL ON FUNCTION outbound_whatsapp_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbound_whatsapp_tenants() TO app_user;
