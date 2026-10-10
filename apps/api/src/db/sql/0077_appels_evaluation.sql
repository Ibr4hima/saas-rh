-- Une auto-évaluation envoyée attend le N+1 d'aujourd'hui.
--
-- Le N+1 en était prévenu une fois, au moment de l'envoi : l'agent changeait
-- de N+1 avant l'évaluation, l'ancien gardait un avis qui menait à « ne fait
-- pas partie de votre équipe », le nouveau n'apprenait rien. L'attente
-- devient un appel, comme une demande à viser : il suit le N+1, et s'en va
-- une fois l'évaluation validée. Les avis des fiches qui attendent encore
-- prennent la clé de l'appel ; le circuit les tient ensuite.
SET lock_timeout = '5s';

UPDATE notifications n
   SET dedupe_key = 'objectifs:' || f.employee_id || ':' || f.annee || ':' || f.semestre || ':appel:n1'
  FROM objectifs_fiches f
 WHERE n.dedupe_key = 'objectifs:commentaires:' || f.employee_id || ':' || f.annee || ':' || f.semestre
   AND n.tenant_id = f.tenant_id
   AND f.commentaires_envoyes_le IS NOT NULL
   AND f.evaluation_validee_le IS NULL;
