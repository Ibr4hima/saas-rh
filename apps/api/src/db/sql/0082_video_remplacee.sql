-- Remplacer la vidéo d'une leçon.
--
-- L'ancienne s'effaçait dès que l'envoi de la nouvelle était préparé : la
-- leçon sortait du parcours le temps de l'envoi, et l'évaluation finale, qui
-- ne compte que les leçons prêtes, s'ouvrait sans elle. Elle reste désormais
-- en place jusqu'à ce que la nouvelle soit prête ; l'envoi attendu se tient
-- à côté. Qui remplace dit si la leçon est à revoir : si oui, elle seule
-- revient à suivre, pour tous.
SET lock_timeout = '5s';

ALTER TABLE academy_lessons
  ADD COLUMN remplacement_uid text,
  ADD COLUMN remplacement_a_revoir boolean,
  ADD CONSTRAINT academy_lessons_remplacement_complet CHECK (
    (remplacement_uid IS NULL) = (remplacement_a_revoir IS NULL)
  );
