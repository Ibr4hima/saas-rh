-- L'émetteur d'un certificat est la raison sociale de l'APIX, telle qu'elle
-- figure dans le corps de ses actes : « APIX S.A », et non le nom court du
-- compte. Les certificats déjà délivrés sous le nom court sont alignés.
UPDATE academy_certificates
   SET organization_name = 'APIX S.A'
 WHERE organization_name = 'APIX';
