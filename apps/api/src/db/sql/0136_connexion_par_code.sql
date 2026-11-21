-- La connexion par code (ADR-0204) : le nom de famille et l'adresse
-- professionnelle, puis un code de six caractères reçu par courriel.
--
-- Tables globales, comme `sessions` et `password_resets` : la connexion se
-- suit avant qu'aucune organisation ne soit connue. Rien n'y est gardé en
-- clair : le jeton du navigateur est haché (SHA-256), le code et le couple
-- nom et adresse ne sont gardés qu'en empreinte HMAC. Pas d'audit : la
-- ligne ne dit rien d'autre que « un code a été demandé ».
SET lock_timeout = '5s';

-- La connexion en cours, le temps de saisir le code : une heure au plus.
-- `compteur` : l'empreinte du couple nom et adresse saisi ; les codes s'y
-- rattachent. `user_id` et `tenant_id` restent vides si le couple ne
-- correspond à aucun compte qui se connecte : rien ne le dit à l'écran.
CREATE TABLE connexions_en_attente (
  id            uuid PRIMARY KEY,
  jeton_hash    text NOT NULL UNIQUE,
  compteur      text NOT NULL,
  email_masque  text NOT NULL,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  tenant_id     uuid REFERENCES tenants (id) ON DELETE CASCADE,
  essais        integer NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connexions_en_attente_expiry_idx ON connexions_en_attente (expires_at);

-- Les codes envoyés à un couple nom et adresse. Un code vaut tant que dure
-- la connexion qui l'a demandé ; l'un d'eux sert, tous tombent.
CREATE TABLE codes_de_connexion (
  id          uuid PRIMARY KEY,
  compteur    text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codes_de_connexion_compteur_idx ON codes_de_connexion (compteur, created_at);
CREATE INDEX codes_de_connexion_created_idx ON codes_de_connexion (created_at);

-- DELETE : les connexions et les codes passés s'en vont.
GRANT SELECT, INSERT, UPDATE, DELETE ON connexions_en_attente TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON codes_de_connexion TO app_user;
