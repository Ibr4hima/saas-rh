-- L'évaluation de l'année (ADR-0076). Le n+1 marque, pour chaque
-- objectif, s'il est atteint, partiellement atteint ou non atteint, et peut
-- reporter à l'année suivante un objectif qui ne l'est pas entièrement. La
-- note de A à D se lit avec cette atteinte, objectif par objectif.
--
-- atteintes_n1 : par objectif (l'id du bloc), l'atteinte selon le n+1 ;
-- celle d'une formation vient de l'APIX Academy et ne s'y écrit pas.
-- reports_n1 : les objectifs que le n+1 reporte ; à la validation, ils se
-- recopient dans la fiche de l'année suivante. Les évaluations validées
-- avant n'ont ni l'une ni l'autre.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches
  ADD COLUMN atteintes_n1 jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reports_n1 jsonb NOT NULL DEFAULT '[]'::jsonb;
