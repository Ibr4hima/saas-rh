-- Une notification peut en remplacer une autre sur le même sujet : le
-- rappel d'une échéance, la fiche d'objectifs mise à jour. La plus récente
-- reste seule dans la boîte ; l'ancienne n'y apparaît plus. Elle n'est pas
-- effacée pour autant : sa clé reste prise, et un rappel déjà envoyé ne
-- repart jamais une seconde fois.
ALTER TABLE notifications ADD COLUMN remplacee_le timestamptz;
