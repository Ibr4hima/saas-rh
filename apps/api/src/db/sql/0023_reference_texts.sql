-- =============================================================================
-- 0023 — Textes de référence : Code du travail, règlement intérieur.
--
-- Deux textes que TOUT LE MONDE doit pouvoir consulter et que la RH seule
-- dépose. Ils n'étaient jusqu'ici que deux pages de prose figée dans le code
-- du produit, réservées au personnel RH — c'est-à-dire invisibles pour ceux à
-- qui elles s'appliquent.
--
-- Un texte de loi n'est pas un fichier : c'est une STRUCTURE — des chapitres,
-- parfois des sections, des articles numérotés — et c'est cette structure qui
-- permet un sommaire, un lien vers un article précis, une recherche qui rend
-- « Article 47 » plutôt qu'une page de PDF. Le PDF officiel reste joint, parce
-- que lui seul fait foi ; le texte structuré est ce qu'on LIT.
--
-- Le corps des articles est du TEXTE BRUT, pas du HTML. Un éditeur riche
-- stockerait du balisage qu'il faudrait réafficher tel quel, et une session RH
-- compromise injecterait alors du script dans l'écran de chaque employé du
-- tenant. La mise en forme se déduit de la frappe : ligne vide = paragraphe,
-- ligne commençant par « - » ou « — » = élément de liste. Le rendu est à nous.
--
-- Générique à dessein : `slug` n'est pas contraint à deux valeurs. Une
-- convention collective, un accord d'entreprise entreront sans migration.
-- Expand-only.
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE reference_texts (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  title         text NOT NULL,
  -- « Loi n° 97-17 du 1er décembre 1997 » : la référence qui identifie la
  -- version en vigueur. Sans elle, on ne sait pas ce qu'on lit.
  reference     text,
  effective_on  date,
  -- Le PDF officiel, celui qui fait foi. Nullable : on peut publier le texte
  -- structuré avant d'avoir le fichier, et l'inverse.
  pdf_filename  text,
  pdf_data      bytea,
  pdf_size      integer CHECK (pdf_size IS NULL OR (pdf_size > 0 AND pdf_size <= 15728640)),
  -- Tant que `published_at` est nul, le texte est un brouillon : la RH le
  -- construit, personne d'autre ne le voit.
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  -- Un PDF, c'est trois colonnes qui vont ensemble ou pas du tout.
  CONSTRAINT reference_texts_pdf_complet CHECK (
    (pdf_filename IS NULL AND pdf_data IS NULL AND pdf_size IS NULL)
    OR (pdf_filename IS NOT NULL AND pdf_data IS NOT NULL AND pdf_size IS NOT NULL)
  )
);

CREATE TABLE reference_chapters (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  text_id     uuid NOT NULL REFERENCES reference_texts (id) ON DELETE CASCADE,
  number      integer NOT NULL CHECK (number > 0),
  title       text NOT NULL,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_id, number)
);
CREATE INDEX reference_chapters_text_idx ON reference_chapters (tenant_id, text_id, number);

CREATE TABLE reference_sections (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  chapter_id  uuid NOT NULL REFERENCES reference_chapters (id) ON DELETE CASCADE,
  number      integer NOT NULL CHECK (number > 0),
  title       text NOT NULL,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, number)
);
CREATE INDEX reference_sections_chapter_idx ON reference_sections (tenant_id, chapter_id, number);

CREATE TABLE reference_articles (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  text_id     uuid NOT NULL REFERENCES reference_texts (id) ON DELETE CASCADE,
  chapter_id  uuid NOT NULL REFERENCES reference_chapters (id) ON DELETE CASCADE,
  -- Un article peut relever directement du chapitre : la section est un étage
  -- FACULTATIF, et le Code du travail ne s'en sert pas partout.
  section_id  uuid REFERENCES reference_sections (id) ON DELETE SET NULL,
  number      integer NOT NULL CHECK (number > 0),
  -- Pour les numérotations que l'entier ne dit pas : « L.34 », « 12 bis ».
  label       text,
  title       text,
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Le numéro est unique DANS LE TEXTE, pas dans le chapitre : « Article 47 »
  -- doit désigner un seul article, c'est ce qui rend le renvoi possible.
  UNIQUE (text_id, number)
);
CREATE INDEX reference_articles_chapter_idx
  ON reference_articles (tenant_id, chapter_id, number);
-- La recherche plein texte, en français : c'est elle qui remplace le feuilletage.
CREATE INDEX reference_articles_recherche_idx
  ON reference_articles
  USING gin (to_tsvector('french', coalesce(title, '') || ' ' || body));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reference_texts', 'reference_chapters', 'reference_sections', 'reference_articles']
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

-- Audit sur la STRUCTURE, jamais sur `reference_texts` : audit_row() copie
-- to_jsonb(NEW), et ce serait le PDF entier à chaque dépôt (cf. 0006/0009).
CREATE TRIGGER reference_chapters_audit
  AFTER INSERT OR UPDATE OR DELETE ON reference_chapters
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER reference_sections_audit
  AFTER INSERT OR UPDATE OR DELETE ON reference_sections
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER reference_articles_audit
  AFTER INSERT OR UPDATE OR DELETE ON reference_articles
  FOR EACH ROW EXECUTE FUNCTION audit_row();
