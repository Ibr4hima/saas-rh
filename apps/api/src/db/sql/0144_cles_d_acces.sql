-- Les clés d'accès (ADR-0247) : après le premier code, Face ID, Touch ID,
-- l'empreinte ou le code de l'appareil ouvrent la session.
--
-- Tables globales, comme `sessions` : la connexion se fait avant qu'aucune
-- organisation ne soit connue. Rien de secret n'y est gardé : la clé
-- publique ne sert qu'à vérifier une signature, la clé privée ne quitte
-- jamais l'appareil. Le défi d'une demande vit cinq minutes derrière un
-- cookie, son jeton haché, et ne sert qu'une fois.
SET lock_timeout = '5s';

CREATE TABLE cles_d_acces (
  id                    uuid PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- L'identifiant de la clé, tel que l'appareil le donne (base64url).
  identifiant           text NOT NULL UNIQUE,
  -- La clé publique (SPKI, DER) et son algorithme COSE : ES256, EdDSA, RS256.
  cle_publique          bytea NOT NULL,
  algorithme            integer NOT NULL CHECK (algorithme IN (-7, -8, -257)),
  -- Le compteur de signatures de l'appareil ; 0 pour une clé synchronisée.
  compteur              bigint NOT NULL DEFAULT 0 CHECK (compteur >= 0),
  transports            text[] NOT NULL DEFAULT '{}',
  -- Sauvegardée par son gestionnaire (iCloud, Google…) : elle suit la personne
  -- sur ses autres appareils.
  sauvegardee           boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  derniere_utilisation  timestamptz
);
CREATE INDEX cles_d_acces_user_idx ON cles_d_acces (user_id);

-- Le défi d'une création (session ouverte) ou d'une connexion.
CREATE TABLE defis_de_cle (
  id          uuid PRIMARY KEY,
  jeton_hash  text NOT NULL UNIQUE,
  defi        text NOT NULL,
  usage       text NOT NULL CHECK (usage IN ('creation', 'connexion')),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((usage = 'creation') = (user_id IS NOT NULL))
);
CREATE INDEX defis_de_cle_expiry_idx ON defis_de_cle (expires_at);

-- DELETE : un défi sert une fois ; une clé se retire.
GRANT SELECT, INSERT, UPDATE, DELETE ON cles_d_acces TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON defis_de_cle TO app_user;
