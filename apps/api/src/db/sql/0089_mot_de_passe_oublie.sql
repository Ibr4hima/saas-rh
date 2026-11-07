-- Mot de passe oublié : un lien par courriel, valable une heure, qui sert
-- une fois.
--
-- Table globale, comme `sessions` : un compte vaut pour toutes ses
-- organisations, et le lien se suit avant qu'aucune ne soit connue. Le jeton
-- n'est jamais gardé en clair (haché SHA-256). Pas d'audit : la ligne ne dit
-- rien d'autre que « un lien a été demandé », et le journal garderait le
-- haché d'un jeton pour toujours.
SET lock_timeout = '5s';

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);
CREATE INDEX password_resets_expiry_idx ON password_resets (expires_at);

-- DELETE : les liens passés s'en vont, et l'effacement d'un compte emporte
-- les siens.
GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO app_user;
