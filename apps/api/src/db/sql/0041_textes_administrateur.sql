-- Les textes de référence sont gérés par l'administrateur.
--
-- Décision APIX : un seul dépositaire. L'administrateur dépose, modifie et
-- supprime le Code du travail et le règlement intérieur ; les agents les
-- lisent dans leur espace. Ni la direction de la DCH ni une délégation ne
-- donnent plus ce droit : les délégations « Textes de référence » encore en
-- cours prennent fin.
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite = 'textes' AND fin_at IS NULL;
