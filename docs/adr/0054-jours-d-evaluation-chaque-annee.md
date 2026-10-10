# ADR-0054 : Dates d'évaluation, un jour et un mois qui reviennent chaque année

**Statut** : acceptée · 2026-10-10

## Contexte

L'ADR-0053 donnait à chaque année ses deux dates d'évaluation, et grisait
celle qui était passée. Ce que la DCH fixe est un rythme : un jour et un mois
par semestre, qui reviennent chaque année.

## Décision

**Un jour et un mois par semestre, sans année.** Par défaut, le 30 juin et le
31 décembre. Ils valent cette année comme les suivantes : « Évaluations
2026 » les pose sur 2026, « Évaluations 2027 » sur 2027.

**Rien ne se grise.** Ce qui est passé reste passé ; un jour changé vaut pour
les années à venir.

**La fenêtre propose deux listes par semestre, Jour et Mois.** Les deux
semestres s'enregistrent ensemble, le 1er avant le 2nd. Le 29 février n'est
pas proposé : il ne revient pas chaque année. Un mois plus court ramène le
jour à son dernier (le 31 devient le 30 en juin).

**Une ligne par organisation** (`objective_review_schedule`, migration 0104,
RLS et journal d'audit). Les dates déjà déplacées dans `objective_review_dates`
(0103) y sont reprises : pour chaque semestre, la plus récente donne son jour
et son mois.

## Conséquences

- `objective_review_dates` n'est plus lue ; elle partira dans une version
  suivante (ADR-0010).
- La carte de tête montre le jour et le mois (« 30 juin ») ; la prochaine
  évaluation garde son année (« 31 déc. 2026 »).
- Le reste de l'ADR-0053 tient : qui dirige la DCH fixe les dates, qui a
  l'habilitation Pilotage les lit, la page montre l'année de la prochaine
  évaluation.
- Les dates ne déclenchent encore rien. Quand elles ouvriront les
  évaluations, une évaluation déjà faite dans l'année ne se rouvrira pas si
  son jour est déplacé plus tard.
