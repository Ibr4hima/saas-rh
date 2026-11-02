-- La fiche reçoit tout ce que la DCH tient sur chaque agent (ADR-0158) : des
-- colonnes vides, et une table pour la rémunération. Aucune ligne ne change.
SET lock_timeout = '5s';

-- La personne : sa ville de naissance (birth_place reste le pays), sa
-- filiation, ses épouses (quatre au plus), ses enfants, sa ville et sa
-- région, et son lien avec le contact d'urgence.
ALTER TABLE persons
  ADD COLUMN lieu_de_naissance text CHECK (length(lieu_de_naissance) <= 120),
  ADD COLUMN prenom_du_pere text CHECK (length(prenom_du_pere) <= 80),
  ADD COLUMN prenom_de_la_mere text CHECK (length(prenom_de_la_mere) <= 80),
  ADD COLUMN nom_de_la_mere text CHECK (length(nom_de_la_mere) <= 80),
  ADD COLUMN epouses text[] NOT NULL DEFAULT '{}' CHECK (cardinality(epouses) <= 4),
  ADD COLUMN nombre_enfants smallint CHECK (nombre_enfants BETWEEN 0 AND 30),
  ADD COLUMN ville text CHECK (length(ville) <= 80),
  ADD COLUMN region text CHECK (region IN ('dakar', 'diourbel', 'fatick', 'kaffrine',
    'kaolack', 'kedougou', 'kolda', 'louga', 'matam', 'saint_louis', 'sedhiou',
    'tambacounda', 'thies', 'ziguinchor')),
  ADD COLUMN lien_contact_urgence text CHECK (lien_contact_urgence IN ('pere', 'mere',
    'conjoint', 'frere', 'soeur', 'enfant', 'ami', 'autre'));

-- L'emploi : le lieu de travail, le projet, la catégorie, le responsable
-- fonctionnel (pour information : seul le N+1 valide), et deux marques de
-- l'import : un matricule provisoire (50-A, 50-B pour un matricule en double)
-- et une date d'entrée connue au mois près.
ALTER TABLE employees
  ADD COLUMN lieu_de_travail text CHECK (length(lieu_de_travail) <= 120),
  ADD COLUMN projet text CHECK (length(projet) <= 120),
  ADD COLUMN categorie text CHECK (length(categorie) <= 60),
  ADD COLUMN responsable_fonctionnel_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN matricule_provisoire boolean NOT NULL DEFAULT false,
  ADD COLUMN entree_au_mois boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT employees_fonctionnel_pas_soi CHECK (responsable_fonctionnel_id <> id);

-- La rémunération, la banque et l'IPRES, réservées à l'accès aux données
-- sensibles : à part, pour ne jamais partir avec le reste de la fiche. Le
-- RIB est chiffré, comme le numéro de la pièce d'identité.
CREATE TABLE remunerations (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  employee_id         uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  salaire_de_base     integer CHECK (salaire_de_base >= 0),
  sursalaire          integer CHECK (sursalaire >= 0),
  prime_anciennete    integer CHECK (prime_anciennete >= 0),
  brut_social         integer CHECK (brut_social >= 0),
  prime_transport     integer CHECK (prime_transport >= 0),
  salaire_brut        integer CHECK (salaire_brut >= 0),
  carburant           integer CHECK (carburant >= 0),
  forfait_telephone   integer CHECK (forfait_telephone >= 0),
  indemnite_sujetion  integer CHECK (indemnite_sujetion >= 0),
  autres_avantages    text CHECK (length(autres_avantages) <= 300),
  nombre_de_parts     numeric(2, 1) CHECK (nombre_de_parts BETWEEN 1 AND 5),
  banque              text CHECK (length(banque) <= 40),
  rib_chiffre         text,
  domiciliation       text CHECK (length(domiciliation) <= 120),
  numero_ipres        text CHECK (length(numero_ipres) <= 30),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remunerations_une_par_agent UNIQUE (tenant_id, employee_id)
);

ALTER TABLE remunerations ENABLE ROW LEVEL SECURITY;
ALTER TABLE remunerations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON remunerations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER remunerations_audit
  AFTER INSERT OR UPDATE OR DELETE ON remunerations
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON remunerations TO app_user;
