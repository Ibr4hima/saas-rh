-- Une offre se désigne par une RÉFÉRENCE, pas par son intitulé.
--
-- « Ingénieur des données » se répète d'une campagne à l'autre, et deux offres
-- peuvent porter le même titre la même année. Un candidat qui écrit, un
-- directeur qui relance, un dossier d'archive : tous ont besoin d'un identifiant
-- court, stable et prononçable — que l'UUID n'est pas.
--
-- Forme : OFF-AAAA-NNN, numéroté par organisation ET par année. La suite
-- repart à 001 chaque janvier, comme un registre de courrier.
--
-- L'unicité est posée PAR TENANT : deux employeurs peuvent tous deux avoir
-- leur OFF-2026-001 sans se marcher dessus.

ALTER TABLE job_postings ADD COLUMN reference text;

-- Rétro-remplissage : les offres déjà en base sont numérotées dans leur ordre
-- de création, année par année, pour que la suite reste continue.
WITH numerotees AS (
  SELECT
    id,
    'OFF-' || to_char(created_at, 'YYYY') || '-' ||
      lpad(
        row_number() OVER (
          PARTITION BY tenant_id, date_part('year', created_at)
          ORDER BY created_at, id
        )::text,
        3,
        '0'
      ) AS reference
  FROM job_postings
)
UPDATE job_postings j SET reference = n.reference FROM numerotees n WHERE n.id = j.id;

ALTER TABLE job_postings ALTER COLUMN reference SET NOT NULL;

CREATE UNIQUE INDEX job_postings_tenant_reference_idx
  ON job_postings (tenant_id, reference);
