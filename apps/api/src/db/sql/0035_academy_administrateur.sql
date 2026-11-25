-- L'APIX Academy est gérée par l'administrateur.
--
-- Décision APIX : qui gère le catalogue voit les questions des évaluations.
-- Confié à un agent — même de la DCH —, il le priverait de ses propres
-- certificats. L'administrateur, qui n'est l'apprenant de personne, le gère
-- donc seul : ni la direction de la DCH ni une délégation ne le donnent
-- plus. Tous les agents passent les évaluations, sauf le formateur d'une
-- formation, qui en suit les leçons.

-- ——— Les délégations « APIX Academy » encore en cours prennent fin.
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite = 'academy' AND fin_at IS NULL;

-- ——— Plus personne d'autre que l'administrateur n'ouvre l'atelier : la
-- liste de qui y avait eu la main n'a plus d'objet.
DROP TABLE academy_course_gestionnaires;
