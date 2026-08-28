-- Une offre devient supprimable — et sa référence cesse d'être réversible.
--
-- À la création du module (0006), les offres n'étaient pas supprimables : on
-- publie, on clôture, on archive. À l'usage, la RH prépare des brouillons, se
-- trompe de poste, duplique — et ces brouillons encombrent une liste consultée
-- tous les jours. Rien ne justifie de les garder à vie.
--
-- Mais une suppression casse une numérotation déduite des lignes présentes :
-- supprimer OFF-2026-002 rendrait ce numéro à l'offre suivante, et un courrier
-- archivé citant OFF-2026-002 désignerait alors DEUX campagnes. Le compteur
-- vit donc à part, et n'est jamais décrémenté.
--
-- Le second garde-fou n'est pas ici mais dans le service : une offre qui porte
-- des candidatures est écartée de la suppression. Les dossiers déposés
-- appartiennent à des personnes, pas à la campagne.

CREATE TABLE job_posting_counters (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  year        int  NOT NULL,
  last_number int  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE job_posting_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_posting_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_posting_counters
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Le compteur repart de ce qui a DÉJÀ été attribué (cf. 0016), jamais de zéro.
INSERT INTO job_posting_counters (tenant_id, year, last_number)
SELECT
  tenant_id,
  date_part('year', created_at)::int,
  max(substring(reference from '(\d+)$')::int)
FROM job_postings
GROUP BY tenant_id, date_part('year', created_at)::int;

GRANT SELECT, INSERT, UPDATE ON job_posting_counters TO app_user;
GRANT DELETE ON job_postings TO app_user;
