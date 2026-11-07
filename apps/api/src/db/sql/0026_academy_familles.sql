-- =============================================================================
-- 0026 — APIX Academy : dix familles de formations au lieu de cinq.
--
-- Les cinq premières (bureautique, économie, métier, management, conformité)
-- ne couvraient pas le plan de formation de l'agence : le numérique, le
-- droit, la gestion de projet, la communication, les langues y manquaient.
-- La liste reste FERMÉE — chaque famille a son icône et sa couverture — mais
-- plus complète. Les clés existantes ne changent pas : aucune formation n'a
-- à être reclassée.
--
-- Expand-only : la contrainte s'élargit, elle ne refuse rien de ce qu'elle
-- acceptait.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE academy_courses DROP CONSTRAINT IF EXISTS academy_courses_category_check;
ALTER TABLE academy_courses
  ADD CONSTRAINT academy_courses_category_check CHECK (
    category IN (
      'bureautique', 'digital', 'economie', 'droit', 'metier',
      'management', 'projets', 'communication', 'langues', 'conformite'
    )
  );
