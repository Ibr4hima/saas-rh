-- Les compteurs de l'anti-abus, en base : partagés entre les instances.
--
-- Le compteur des candidatures vivait dans la mémoire du serveur : chaque
-- instance avait le sien, un redémarrage le remettait à zéro, et derrière
-- un proxy mal réglé tous les candidats partageaient la même adresse. Ici,
-- un compteur par fenêtre de temps ; il ne se garde pas plus d’un jour.
--
-- Table globale, comme `sessions` : un compteur vaut avant toute
-- organisation (une adresse IP n'appartient à aucune), sans audit (il ne
-- dit rien de personne et s'efface de lui-même).
SET lock_timeout = '5s';

CREATE TABLE rate_limit_counters (
  bucket        text        NOT NULL,
  -- Une adresse réduite (IPv6 au /64), ou l'empreinte d'un identifiant :
  -- jamais une adresse email en clair.
  subject       text        NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          integer     NOT NULL,
  PRIMARY KEY (bucket, subject, window_start)
);

CREATE INDEX rate_limit_counters_window_idx ON rate_limit_counters (window_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_counters TO app_user;
