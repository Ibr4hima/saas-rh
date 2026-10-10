-- La nationalité cesse d'être devinée.
--
-- La colonne portait NOT NULL DEFAULT 'SN' : un dossier créé sans que la RH
-- ait choisi la nationalité ressortait « Sénégalaise » — une valeur que
-- personne n'avait saisie, indiscernable d'une vraie. Sur un employeur qui
-- recrute dans toute l'UEMOA, c'est une donnée fausse dans un dossier
-- administratif, pas un détail d'affichage.
--
-- Désormais l'ABSENCE est représentable : NULL veut dire « pas encore
-- renseignée », et l'écran l'affiche « — » au lieu d'un pays.
--
-- Les lignes existantes ne sont PAS touchées : celles à 'SN' peuvent être
-- d'authentiques Sénégalais. On ne peut plus distinguer après coup les vraies
-- saisies des défauts appliqués ; les effacer en bloc perdrait des données
-- justes pour corriger des données douteuses.

ALTER TABLE persons ALTER COLUMN nationality DROP DEFAULT;
ALTER TABLE persons ALTER COLUMN nationality DROP NOT NULL;
