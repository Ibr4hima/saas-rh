-- La domiciliation se dit par oui ou par non (ADR-0202) : le salaire de
-- l'agent est-il domicilié à sa banque. La colonne salaire_domicilie prend
-- le relais de domiciliation, un texte libre depuis la 0126 : un « oui » ou
-- un « non » déjà saisi s'y reporte, le reste attend d'être dit sur la
-- fiche. L'ancienne colonne reste le temps d'une version (ADR-0010) ;
-- l'application ne la lit plus.
ALTER TABLE remunerations ADD COLUMN IF NOT EXISTS salaire_domicilie boolean;

UPDATE remunerations
   SET salaire_domicilie = lower(btrim(domiciliation)) IN ('oui', 'o')
 WHERE lower(btrim(domiciliation)) IN ('oui', 'o', 'non', 'n');
