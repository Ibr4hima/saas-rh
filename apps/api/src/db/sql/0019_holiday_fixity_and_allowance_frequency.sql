-- =============================================================================
-- 0019 — Les fériés qui ne bougeront jamais, et un quota qui dit sa cadence
--
-- Deux paramétrages du module congés se lisaient jusqu'ici entre les lignes ;
-- ils deviennent des colonnes.
--
-- 1. Un jour férié sénégalais est de deux natures. Le Nouvel an tombe le
--    1er janvier — cette année, l'an prochain et dans dix ans. La Korité tombe
--    quand le croissant se voit : sa date se corrige à la main, parfois la
--    veille. Confondre les deux, c'est laisser quelqu'un déplacer Noël. D'où
--    `fixed_date` : ce qui le porte ne se modifie ni ne se supprime.
--
-- 2. `default_annual_days` promettait une cadence dans son nom. Dès qu'un type
--    d'absence se compte au mois — ou ne se compte par aucune période, comme
--    la maternité qui s'ouvre à la naissance et non au 1er janvier — le nom
--    ment. Le quota et sa cadence se séparent : `allowance_days` dit combien,
--    `frequency` dit par quoi.
-- =============================================================================

SET lock_timeout = '5s';

-- ── Un férié qui ne bouge pas ────────────────────────────────────────────────

ALTER TABLE holidays ADD COLUMN fixed_date boolean NOT NULL DEFAULT false;

-- Les six fériés sénégalais à date civile. Le repérage se fait sur la date et
-- non sur l'intitulé : un 1er janvier reste le Nouvel an quel que soit le nom
-- qu'on lui a donné en base, alors qu'un intitulé se retape.
UPDATE holidays
   SET fixed_date = true
 WHERE (extract(month FROM day), extract(day FROM day)) IN
       ((1, 1), (4, 4), (5, 1), (8, 15), (11, 1), (12, 25));

-- Corriger la date d'une fête mobile est le geste courant de ce module : sans
-- ce droit, il fallait supprimer puis recréer, et le rappel J−2 partait deux
-- fois.
GRANT UPDATE ON holidays TO app_user;

-- ── Le quota et sa cadence ───────────────────────────────────────────────────

ALTER TABLE absence_types RENAME COLUMN default_annual_days TO allowance_days;

ALTER TABLE absence_types
  ADD COLUMN frequency text NOT NULL DEFAULT 'none'
    CHECK (frequency IN ('annual', 'monthly', 'none'));

-- Tout ce qui portait un quota le portait à l'année : c'est ce que disait le
-- nom de la colonne, et c'est la seule cadence que le moteur de soldes sache
-- appliquer aujourd'hui.
UPDATE absence_types SET frequency = 'annual' WHERE allowance_days IS NOT NULL;

-- « 30 par an » se comprend, « par an » tout court ne veut rien dire. L'inverse
-- reste permis : un quota sans période, ce sont les 98 jours de la maternité,
-- qui s'ouvrent à l'événement.
ALTER TABLE absence_types
  ADD CONSTRAINT absence_types_allowance_frequency_check
    CHECK (frequency = 'none' OR allowance_days IS NOT NULL);
