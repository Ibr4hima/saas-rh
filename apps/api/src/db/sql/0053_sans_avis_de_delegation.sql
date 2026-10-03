-- Déléguer ou retirer une tâche ne se notifie plus : le membre le voit dans
-- son espace. Un nouveau directeur du Capital Humain n'est plus accueilli
-- par un avis : il trouve les délégations en place dans « Déléguer des
-- tâches ». Les avis déjà envoyés quittent les boîtes.
DELETE FROM notifications
 WHERE dedupe_key LIKE 'habilitation:%' OR dedupe_key LIKE 'dch:directeur:%';
