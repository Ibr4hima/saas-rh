-- Destructif : fond en une seule les fiches d'objectifs du 1er et du 2nd semestre d'une même année, et retire les appels d'évaluation devenus sans objet (ADR-0075). Les fiches telles qu'elles étaient restent dans objectifs_fiches_semestres.
--
-- Les objectifs se fixent et s'évaluent une fois par an (ADR-0075) : une
-- fiche par agent et par année, « Objectifs de l’année 2026 », et une seule
-- date d'évaluation, le 15 décembre tant que la DCH n'en fixe pas d'autre.
--
-- Les fiches du 1er et du 2nd semestre d'une même année n'en font plus
-- qu'une : les objectifs des deux, rangés par échéance ; les formations à
-- suivre, sans doublon ; les commentaires, bout à bout ; les statuts, et ce
-- que l'agent et le n+1 ont dit de chaque objectif. Leur évaluation :
--  - une année close (le 15 décembre passé) garde ce qui a été fait :
--    validée si un semestre l'a été (la note du 2nd quand les deux le sont),
--    sinon en attente du n+1 si l'auto-évaluation d'un semestre était
--    envoyée ;
--  - l'année en cours n'a pas encore eu son évaluation : la fiche n'est
--    validée que si les deux semestres l'étaient (la note du 2nd), en attente
--    du n+1 que si les deux auto-évaluations étaient envoyées ; sinon
--    l'auto-évaluation de l'année reste à faire, avec les statuts et les
--    commentaires déjà donnés.
-- Une fiche vide ne compte pas.
--
-- Les fiches telles qu'elles étaient restent, à part, dans
-- objectifs_fiches_semestres, que l'application ne lit pas : une livraison
-- suivante la supprimera, avec les colonnes des semestres (ADR-0010). Les
-- appels du n+1 suivent la fiche de l'année ; celui d'une fiche rouverte
-- s'en va.
SET lock_timeout = '5s';

-- Les fiches par semestre, telles quelles.
CREATE TABLE objectifs_fiches_semestres (
  LIKE objectifs_fiches INCLUDING DEFAULTS,
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
);

INSERT INTO objectifs_fiches_semestres SELECT * FROM objectifs_fiches;

ALTER TABLE objectifs_fiches_semestres ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectifs_fiches_semestres FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objectifs_fiches_semestres
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
-- Après la copie : le journal ne la double pas. Seul l'effacement
-- définitif d'un agent y touche encore.
CREATE TRIGGER objectifs_fiches_semestres_audit
  AFTER INSERT OR UPDATE OR DELETE ON objectifs_fiches_semestres
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, DELETE ON objectifs_fiches_semestres TO app_user;

-- Une fiche par année.
DO $$
DECLARE
  g record;
  a objectifs_fiches%ROWTYPE;   -- le 1er semestre
  b objectifs_fiches%ROWTYPE;   -- le 2nd
  ea text;                      -- où en est chacun : V validée, E envoyée,
  eb text;                      -- O ouverte ; NULL, une fiche vide
  etat text;
  passee boolean;               -- l'année close : son 15 décembre passé
  gardee objectifs_fiches%ROWTYPE;  -- l'évaluation validée qui reste
  brouillon objectifs_fiches%ROWTYPE;  -- la note en cours du n+1, s'il y en a une
  fusion jsonb;
  figees jsonb;
  remplie constant jsonpath :=
    'strict $.** ? ((@.type == "text" && @.text like_regex "[^[:space:]]")
                    || @.type == "echeance" || @.type == "formation")';
BEGIN
  FOR g IN
    SELECT employee_id, annee FROM objectifs_fiches
     GROUP BY employee_id, annee HAVING count(*) > 1
  LOOP
    SELECT * INTO a FROM objectifs_fiches
     WHERE employee_id = g.employee_id AND annee = g.annee AND semestre = 1;
    SELECT * INTO b FROM objectifs_fiches
     WHERE employee_id = g.employee_id AND annee = g.annee AND semestre = 2;

    ea := CASE WHEN NOT jsonb_path_exists(a.contenu, remplie) THEN NULL
               WHEN a.evaluation_validee_le IS NOT NULL THEN 'V'
               WHEN a.commentaires_envoyes_le IS NOT NULL THEN 'E' ELSE 'O' END;
    eb := CASE WHEN NOT jsonb_path_exists(b.contenu, remplie) THEN NULL
               WHEN b.evaluation_validee_le IS NOT NULL THEN 'V'
               WHEN b.commentaires_envoyes_le IS NOT NULL THEN 'E' ELSE 'O' END;
    passee := make_date(g.annee, 12, 15) < CURRENT_DATE;
    etat := CASE
      WHEN ea IS NULL AND eb IS NULL THEN 'O'
      WHEN ea IS NULL THEN eb
      WHEN eb IS NULL THEN ea
      WHEN passee THEN CASE WHEN 'V' IN (ea, eb) THEN 'V'
                           WHEN 'E' IN (ea, eb) THEN 'E' ELSE 'O' END
      ELSE CASE WHEN ea = 'V' AND eb = 'V' THEN 'V'
                WHEN ea <> 'O' AND eb <> 'O' THEN 'E' ELSE 'O' END
    END;
    gardee := CASE WHEN eb = 'V' THEN b ELSE a END;
    brouillon := CASE WHEN b.evaluateur_employee_id IS NOT NULL THEN b ELSE a END;

    -- Les objectifs des deux semestres, par échéance (sans échéance à la
    -- fin), puis les formations, puis les commentaires. Une formation
    -- demandée aux deux semestres ne l'est qu'une fois.
    SELECT coalesce(jsonb_agg(x.bloc ORDER BY x.genre, x.echeance NULLS LAST, x.s, x.i),
                    '[]'::jsonb)
      INTO fusion
      FROM (
        SELECT t.bloc, t.s, t.i,
               CASE t.bloc ->> 'type' WHEN 'checkListItem' THEN 0
                                      WHEN 'formation' THEN 1 ELSE 2 END AS genre,
               CASE WHEN t.bloc ->> 'type' = 'checkListItem'
                     AND t.bloc #>> '{props,echeance}' ~ '^\d{4}-\d{2}-\d{2}$'
                    THEN t.bloc #>> '{props,echeance}' END AS echeance
          FROM (SELECT e.bloc, 1 AS s, e.i
                  FROM jsonb_array_elements(a.contenu) WITH ORDINALITY AS e (bloc, i)
                UNION ALL
                SELECT e.bloc, 2, e.i
                  FROM jsonb_array_elements(b.contenu) WITH ORDINALITY AS e (bloc, i)) t
         WHERE NOT (t.s = 2 AND t.bloc ->> 'type' = 'formation'
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.contenu) d
                                 WHERE d ->> 'type' = 'formation'
                                   AND d #>> '{props,courseId}' = t.bloc #>> '{props,courseId}'))
      ) x;

    -- L'état des formations, figé à l'envoi : celui du 2nd semestre d'abord.
    figees := CASE WHEN etat = 'O' THEN NULL ELSE (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(f.formation ORDER BY f.s, f.i) END
        FROM (SELECT e.formation, 1 AS s, e.i
                FROM jsonb_array_elements(coalesce(b.formations_figees, '[]'::jsonb))
                     WITH ORDINALITY AS e (formation, i)
              UNION ALL
              SELECT e.formation, 2, e.i
                FROM jsonb_array_elements(coalesce(a.formations_figees, '[]'::jsonb))
                     WITH ORDINALITY AS e (formation, i)
               WHERE NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(coalesce(b.formations_figees, '[]'::jsonb)) d
                  WHERE d ->> 'courseId' = e.formation ->> 'courseId')) f) END;

    UPDATE objectifs_fiches
       SET contenu = fusion,
           statuts = a.statuts || b.statuts,
           statuts_empreintes = a.statuts_empreintes || b.statuts_empreintes,
           commentaires_agent = a.commentaires_agent || b.commentaires_agent,
           commentaires_n1 = a.commentaires_n1 || b.commentaires_n1,
           formations_figees = figees,
           commentaires_envoyes_le = CASE etat
             WHEN 'V' THEN gardee.commentaires_envoyes_le
             WHEN 'E' THEN greatest(a.commentaires_envoyes_le, b.commentaires_envoyes_le) END,
           evaluation_validee_le = CASE WHEN etat = 'V' THEN gardee.evaluation_validee_le END,
           evaluation_note = CASE WHEN etat = 'V' THEN gardee.evaluation_note
                                  ELSE brouillon.evaluation_note END,
           evaluateur_employee_id = CASE WHEN etat = 'V' THEN gardee.evaluateur_employee_id
                                         ELSE brouillon.evaluateur_employee_id END,
           auteur_employee_id = CASE WHEN a.updated_at > b.updated_at
                                     THEN coalesce(a.auteur_employee_id, b.auteur_employee_id)
                                     ELSE coalesce(b.auteur_employee_id, a.auteur_employee_id) END,
           created_at = least(a.created_at, b.created_at),
           updated_at = greatest(a.updated_at, b.updated_at)
     WHERE id = b.id;
    DELETE FROM objectifs_fiches WHERE id = a.id;
  END LOOP;
END $$;

-- Le semestre ne se lit plus : une fiche nouvelle n'en a pas.
ALTER TABLE objectifs_fiches
  ALTER COLUMN semestre DROP NOT NULL,
  ADD CONSTRAINT objectifs_fiches_une_par_annee UNIQUE (tenant_id, employee_id, annee);

-- Les appels du n+1 suivent la fiche de l'année. Celui d'une fiche rouverte
-- s'en va ; deux appels pour la même année n'en font qu'un, le plus ancien.
DELETE FROM notifications n
 WHERE n.dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):'
   AND NOT EXISTS (
     SELECT 1 FROM objectifs_fiches f
      WHERE f.commentaires_envoyes_le IS NOT NULL AND f.evaluation_validee_le IS NULL
        AND n.dedupe_key ^@ ('objectifs:' || f.employee_id || ':' || f.annee || ':'));
DELETE FROM notifications n
 WHERE n.dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):'
   AND EXISTS (
     SELECT 1 FROM notifications m
      WHERE m.tenant_id = n.tenant_id AND m.recipient_user_id = n.recipient_user_id
        AND m.dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):'
        AND regexp_replace(m.dedupe_key, '^(objectifs:[^:]+:[0-9]{4}):[12]:', '\1:')
          = regexp_replace(n.dedupe_key, '^(objectifs:[^:]+:[0-9]{4}):[12]:', '\1:')
        AND (m.created_at, m.id) < (n.created_at, n.id));
UPDATE notifications
   SET dedupe_key = regexp_replace(dedupe_key, '^(objectifs:[^:]+:[0-9]{4}):[12]:', '\1:'),
       title = regexp_replace(title, ' du (1er|2nd) semestre ([0-9]{4})$', ' de l’année \2')
 WHERE dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):';

-- Une date d'évaluation, un jour et un mois qui reviennent chaque année :
-- le 15 décembre, pour toutes les organisations, jusqu'à ce que la DCH la
-- change. Les jours des deux semestres ne se lisent plus.
ALTER TABLE objective_review_schedule
  ADD COLUMN review_month smallint NOT NULL DEFAULT 12,
  ADD COLUMN review_day smallint NOT NULL DEFAULT 15,
  -- Un jour qui revient chaque année : le 29 février n'en est pas un.
  ADD CONSTRAINT objective_review_schedule_review CHECK (
    review_month BETWEEN 1 AND 12 AND review_day >= 1 AND review_day <=
      CASE WHEN review_month = 2 THEN 28
           WHEN review_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END),
  ALTER COLUMN s1_month DROP NOT NULL,
  ALTER COLUMN s1_day DROP NOT NULL,
  ALTER COLUMN s2_month DROP NOT NULL,
  ALTER COLUMN s2_day DROP NOT NULL;
