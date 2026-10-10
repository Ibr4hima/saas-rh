-- Rappels de jours fériés : pouvoir les RETIRER quand le férié disparaît.
--
-- Les fêtes mobiles (Korité, Tabaski, Tamkharit…) sont confirmées la veille ou
-- l'avant-veille — soit exactement pendant la fenêtre où le rappel J−2 vient de
-- partir. L'API des fériés n'ayant pas de mise à jour, corriger une date ou un
-- libellé se fait par suppression puis recréation ; sans DELETE sur les
-- notifications, l'ancien rappel restait dans la boîte de tous les employés et
-- affirmait qu'un jour ouvré était chômé, sans aucun moyen de le retirer.
SET lock_timeout = '5s';

GRANT DELETE ON notifications TO app_user;
