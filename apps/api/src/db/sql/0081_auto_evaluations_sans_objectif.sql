-- Une auto-évaluation sans objectif se rouvre.
--
-- Seules les cases à cocher sont des objectifs. Une fiche rédigée en titres,
-- en puces ou en tableau n'en avait aucun : l'agent pouvait l'envoyer vide,
-- et elle se verrouillait sans que personne puisse la rouvrir. L'envoi le
-- refuse désormais ; celles déjà parties, et pas encore évaluées, reviennent
-- à leur N+1, qui peut y poser des objectifs. Leur appel au N+1 s'en va de
-- lui-même au prochain passage du circuit (cf. `reconcilierLesEvaluations`).
SET lock_timeout = '5s';

UPDATE objectifs_fiches f
   SET commentaires_envoyes_le = NULL, formations_figees = NULL
 WHERE f.commentaires_envoyes_le IS NOT NULL
   AND f.evaluation_validee_le IS NULL
   AND NOT jsonb_path_exists(
         f.contenu,
         'strict $.** ? (@.type == "checkListItem" && exists(@.id)) .content.**
            ? ((@.type == "text" && @.text like_regex "[^[:space:]]") || @.type == "echeance")');
