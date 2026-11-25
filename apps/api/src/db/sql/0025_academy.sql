-- =============================================================================
-- 0025 — APIX Academy : des formations en ligne, suivies et vérifiées.
--
-- Une formation se range en MODULES, un module en LEÇONS ; une leçon est une
-- vidéo de douze minutes au plus, accompagnée ou non d'un support PDF. La RH
-- construit le catalogue, les agents le suivent — dans l'ordre, et sans
-- pouvoir sauter.
--
-- LA VIDÉO N'EST PAS ICI. Une leçon ne porte que l'IDENTIFIANT de sa vidéo
-- chez le fournisseur qui la sert (Cloudflare Stream en production, le disque
-- du serveur en développement) : ses octets ne passent jamais par Postgres.
-- Trois cents mégaoctets par leçon feraient d'une sauvegarde quotidienne une
-- affaire d'heures, et chaque lecture disputerait la mémoire de la base aux
-- demandes de congé.
--
-- Le support PDF, lui, reste en base comme les autres pièces du pilote — dix
-- mégaoctets au plus, dans une table À PART : la liste des leçons se lit à
-- chaque écran, et ne doit jamais traîner un fichier avec elle.
--
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE academy_courses (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  title               text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  summary             text CHECK (summary IS NULL OR length(summary) <= 2000),
  -- Une liste FERMÉE, décidée avec l'APIX. Une sixième famille se prendra par
  -- une migration : c'est ce qui la fera discuter plutôt qu'inventer au fil
  -- de la saisie.
  category            text NOT NULL CHECK (
    category IN ('bureautique', 'economie', 'metier', 'management', 'conformite')
  ),
  -- Nul tant que la formation est un brouillon : la RH la construit, aucun
  -- agent ne la voit.
  published_at        timestamptz,
  created_by_user_id  uuid NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX academy_courses_tenant_idx ON academy_courses (tenant_id, published_at);

CREATE TABLE academy_modules (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  course_id   uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  position    integer NOT NULL CHECK (position >= 0),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Différée : monter un module d'un cran échange deux positions, et l'état
  -- intermédiaire — deux modules au même rang — ne doit pas faire échouer
  -- l'échange.
  CONSTRAINT academy_modules_rang UNIQUE (course_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE academy_lessons (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  course_id         uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  module_id         uuid NOT NULL REFERENCES academy_modules (id) ON DELETE CASCADE,
  position          integer NOT NULL CHECK (position >= 0),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  -- Qui sert la vidéo, et sous quel identifiant. Les deux vont ensemble.
  video_provider    text CHECK (video_provider IN ('local', 'cloudflare')),
  video_uid         text,
  -- absente → envoi → (traitement) → prete ; erreur à toute étape.
  video_status      text NOT NULL DEFAULT 'absente' CHECK (
    video_status IN ('absente', 'envoi', 'traitement', 'prete', 'erreur')
  ),
  video_error       text,
  -- La durée que dit le FOURNISSEUR, jamais celle qu'annonce le navigateur :
  -- c'est sur elle que se calcule le seuil de visionnage. Douze minutes au
  -- plus — la règle de l'APIX, tenue ici en dernier recours, à une seconde
  -- près : un enregistrement arrêté pile à 12:00 dure 720,04 s une fois
  -- encodé.
  duration_seconds  double precision CHECK (
    duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 721)
  ),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academy_lessons_rang UNIQUE (module_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT academy_lessons_video_complete CHECK (
    (video_provider IS NULL) = (video_uid IS NULL)
  ),
  -- Une leçon prête a une durée : sans elle, « vue à 90 % » ne voudrait rien dire.
  CONSTRAINT academy_lessons_prete_datee CHECK (
    video_status <> 'prete' OR duration_seconds IS NOT NULL
  )
);
CREATE INDEX academy_lessons_course_idx ON academy_lessons (tenant_id, course_id);

CREATE TABLE academy_lesson_supports (
  lesson_id   uuid PRIMARY KEY REFERENCES academy_lessons (id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  filename    text NOT NULL,
  data        bytea NOT NULL,
  size        integer NOT NULL CHECK (size > 0 AND size <= 10485760),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- La progression d'un AGENT — un dossier, pas un compte : c'est au dossier que
-- s'attacheront les certifications, et c'est par lui que le n+1 verra son
-- équipe.
CREATE TABLE academy_lesson_progress (
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  employee_id       uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  lesson_id         uuid NOT NULL REFERENCES academy_lessons (id) ON DELETE CASCADE,
  -- Les passages RÉELLEMENT crédités, en secondes : [[0, 184.2], [201, 240]].
  -- Pas la position atteinte — un passage sauté ne compte pas, un passage
  -- revu ne compte pas deux fois.
  watched           jsonb NOT NULL DEFAULT '[]'::jsonb,
  watched_seconds   double precision NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  -- La reprise : là où l'agent s'est arrêté.
  position_seconds  double precision NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  completed_at      timestamptz,
  started_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, lesson_id)
);
CREATE INDEX academy_progress_lesson_idx ON academy_lesson_progress (tenant_id, lesson_id);

-- LA LECTURE EN COURS d'un agent : une seule à la fois. Ouvrir une leçon
-- ailleurs remplace la session, et l'ancien onglet l'apprend au battement
-- suivant.
--
-- Elle porte aussi la RÉSERVE DE TEMPS de l'agent : chaque seconde créditée
-- en consomme une, et elle ne se remplit qu'au rythme de l'horloge — d'où la
-- garantie qu'aucune leçon ne se valide plus vite que sa durée réelle, quel
-- que soit le nombre d'onglets, de sessions ou de requêtes fabriquées.
CREATE TABLE academy_viewers (
  employee_id   uuid PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  session_id    uuid NOT NULL,
  lesson_id     uuid NOT NULL REFERENCES academy_lessons (id) ON DELETE CASCADE,
  tokens        double precision NOT NULL CHECK (tokens >= 0),
  tokens_at     timestamptz NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'academy_courses', 'academy_modules', 'academy_lessons',
    'academy_lesson_supports', 'academy_lesson_progress', 'academy_viewers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_tenant_id())
         WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

-- Audit sur le CATALOGUE seulement. Ni sur les supports — audit_row() copie
-- la ligne entière, fichier compris —, ni sur la progression et la lecture en
-- cours, écrites toutes les dix secondes par chaque agent qui regarde : le
-- journal d'audit n'y survivrait pas, et il n'y apprendrait rien.
CREATE TRIGGER academy_courses_audit
  AFTER INSERT OR UPDATE OR DELETE ON academy_courses
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER academy_modules_audit
  AFTER INSERT OR UPDATE OR DELETE ON academy_modules
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER academy_lessons_audit
  AFTER INSERT OR UPDATE OR DELETE ON academy_lessons
  FOR EACH ROW EXECUTE FUNCTION audit_row();
