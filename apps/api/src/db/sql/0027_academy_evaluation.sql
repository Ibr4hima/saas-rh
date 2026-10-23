-- =============================================================================
-- 0027 — APIX Academy, étape 2 : l'évaluation finale et le certificat.
--
-- Regarder une formation ne la fait pas réussir. Une formation qui porte une
-- BANQUE DE QUESTIONS se conclut par une évaluation : chaque tentative tire
-- ses questions au hasard dans la banque, les mélange, et se corrige au
-- serveur — les bonnes réponses ne quittent jamais la base avant la copie
-- rendue. 80 % ou plus, et l'agent reçoit un certificat numéroté, qu'un tiers
-- peut vérifier en ligne sans compte.
--
-- La tentative garde un INSTANTANÉ des questions posées, bonnes réponses
-- comprises : la RH peut corriger sa banque pendant qu'un agent compose, la
-- copie se corrige contre ce qui lui a été posé.
--
-- Le certificat, lui, garde un instantané de ce qu'il atteste — nom de
-- l'agent, titre de la formation, organisation — : il doit rester lisible et
-- vérifiable même si la formation est retirée du catalogue, supprimée, ou
-- renommée.
--
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE academy_courses
  -- Combien de questions chaque tentative tire dans la banque.
  ADD COLUMN quiz_question_count integer NOT NULL DEFAULT 10
    CHECK (quiz_question_count BETWEEN 1 AND 50),
  -- Nul : le certificat ne se périme pas. Sinon, sa durée de validité en
  -- mois — une formation conformité se renouvelle, une formation Excel non.
  ADD COLUMN certificate_validity_months integer
    CHECK (certificate_validity_months IS NULL OR certificate_validity_months BETWEEN 1 AND 120);

CREATE TABLE academy_questions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  course_id   uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  position    integer NOT NULL CHECK (position >= 0),
  prompt      text NOT NULL CHECK (length(prompt) BETWEEN 3 AND 1000),
  -- « unique » : une seule bonne réponse. « multiple » : plusieurs, et il
  -- faut les cocher toutes, et rien d'autre, pour que la question compte.
  kind        text NOT NULL CHECK (kind IN ('unique', 'multiple')),
  -- [{ "id": "…", "text": "…", "correct": true }] — de deux à six choix.
  options     jsonb NOT NULL CHECK (
    jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6
  ),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academy_questions_rang UNIQUE (course_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX academy_questions_course_idx ON academy_questions (tenant_id, course_id, position);

CREATE TABLE academy_quiz_attempts (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  employee_id   uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  -- Ce qui a été posé, dans l'ordre posé, bonnes réponses comprises.
  questions     jsonb NOT NULL,
  started_at    timestamptz NOT NULL,
  -- Le temps accordé est décidé au DÉPART, par le serveur : la minuterie de
  -- l'écran n'en est que l'affichage.
  expires_at    timestamptz NOT NULL,
  submitted_at  timestamptz,
  answers       jsonb,
  score         double precision CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  passed        boolean,
  CONSTRAINT academy_attempts_rendue CHECK ((submitted_at IS NULL) = (passed IS NULL)),
  CONSTRAINT academy_attempts_duree CHECK (expires_at > started_at)
);
-- Une seule copie ouverte à la fois, par agent et par formation.
CREATE UNIQUE INDEX academy_attempts_ouverte
  ON academy_quiz_attempts (employee_id, course_id) WHERE submitted_at IS NULL;
CREATE INDEX academy_attempts_agent_idx
  ON academy_quiz_attempts (tenant_id, employee_id, course_id, started_at DESC);

CREATE TABLE academy_certificates (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  employee_id        uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  course_id          uuid REFERENCES academy_courses (id) ON DELETE SET NULL,
  attempt_id         uuid REFERENCES academy_quiz_attempts (id) ON DELETE SET NULL,
  -- APX-XXXX-XXXX : quarante bits tirés au hasard. Imprimé sur le
  -- certificat, porté par le QR code, et impossible à deviner — c'est lui
  -- qui ouvre la page de vérification publique.
  number             text NOT NULL UNIQUE CHECK (number ~ '^APX-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  holder_name        text NOT NULL,
  holder_number      text NOT NULL,
  course_title       text NOT NULL,
  course_category    text NOT NULL,
  organization_name  text NOT NULL,
  score              double precision NOT NULL CHECK (score BETWEEN 0 AND 1),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  revoked_at         timestamptz
);
CREATE INDEX academy_certificates_agent_idx
  ON academy_certificates (tenant_id, employee_id, issued_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academy_questions', 'academy_quiz_attempts', 'academy_certificates']
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

-- La page de vérification est PUBLIQUE : quiconque tient le certificat en
-- main — un recruteur, un partenaire — peut le vérifier. Elle ne voit qu'UNE
-- ligne, celle dont elle présente le numéro ; jamais de liste.
CREATE POLICY verification_publique ON academy_certificates FOR SELECT
  USING (number = NULLIF(current_setting('app.certificate_number', true), ''));

-- La banque et les certificats sont des pièces qu'on doit pouvoir retracer ;
-- les tentatives, écrites par chaque agent à chaque copie, n'y gagneraient
-- rien.
CREATE TRIGGER academy_questions_audit
  AFTER INSERT OR UPDATE OR DELETE ON academy_questions
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER academy_certificates_audit
  AFTER INSERT OR UPDATE OR DELETE ON academy_certificates
  FOR EACH ROW EXECUTE FUNCTION audit_row();
