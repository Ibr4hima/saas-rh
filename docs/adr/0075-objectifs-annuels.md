# ADR-0075 : Objectifs, une fiche et une évaluation par an

**Statut** : acceptée · 2026-10-14

Remplace l'[ADR-0053](0053-dates-d-evaluation.md), l'[ADR-0055](0055-objectifs-a-echeance.md),
l'[ADR-0056](0056-fixer-des-objectifs-par-semestre.md) et
l'[ADR-0059](0059-report-au-s1.md) ; dans
l'[ADR-0057](0057-echeance-confirmee-a-l-enregistrement.md) et
l'[ADR-0058](0058-formations-encadrees.md), la confirmation de l'échéance et
sa fenêtre. Précise l'[ADR-0051](0051-fiche-objectifs-crayon.md),
l'[ADR-0052](0052-une-annee-a-la-fois.md) et
l'[ADR-0054](0054-jours-d-evaluation-chaque-annee.md).

## Contexte

Les objectifs se fixaient et s'évaluaient par semestre : deux fiches par an,
deux dates d'évaluation (ADR-0053, ADR-0054), un menu « Semestre 1 /
Semestre 2 » pour fixer les objectifs (ADR-0056), une échéance obligatoire
qui rangeait chaque objectif dans l'évaluation de sa période, et une
confirmation, ou un report, quand elle tombait à 30 jours ou moins de
l'évaluation (ADR-0055, ADR-0057). La DCH ne tient qu'une évaluation par an,
l'évaluation annuelle.

## Décision

**Une fiche par agent et par année** : « Objectifs de l’année 2026 ». Le
n+1 y écrit comme avant les objectifs, les formations à suivre et les
commentaires, et peut ajouter ou retirer des objectifs au fil de l'année.
« Fixer des objectifs » n'ouvre plus de menu : la fiche de l'année choisie
s'ouvre à la rédaction. Le bouton paraît pour l'année en cours et la
suivante, tant que l'évaluation de l'année est à venir et que l'agent n'a
pas envoyé son auto-évaluation.

**L'échéance est facultative.** Sans échéance, l'objectif vaut pour
l'année. Une échéance se choisit dans l'année de la fiche, d'aujourd'hui au
jour de l'évaluation ; le bouton « Effacer » du calendrier la retire. Les
objectifs se lisent par échéance, ceux sans échéance à la fin.

**Plus de report.** Un objectif reste dans la fiche où il est écrit : la
fenêtre « Confirmer cette échéance ? », le report à la prochaine évaluation
et son champ (ADR-0056 à ADR-0059) disparaissent. Une fois la date
d'évaluation passée, les échéances de la fiche ne changent plus et rien ne
s'y ajoute ; le texte se corrige encore tant que l'auto-évaluation n'est
pas envoyée.

**Une date d'évaluation par an.** Un jour et un mois qui reviennent chaque
année : le 15 décembre sans réglage. Seule la personne qui dirige la DCH la
change, sur la page « Évaluation des objectifs ». La déplacer ne déplace
aucun objectif ; les échéances nouvelles s'arrêtent à la nouvelle date.

**L'évaluation porte sur l'année.** L'auto-évaluation de l'agent, puis les
commentaires et la note de A à D du n+1, se font sur la fiche de l'année,
comme avant. Le dossier de l'agent garde une évaluation par année.

**Les fiches par semestre se fondent** (migration 0111, déclarée
destructive). Pour chaque agent et chaque année, les fiches des deux
semestres n'en font plus qu'une : leurs objectifs, leurs formations à
suivre sans doublon, leurs commentaires bout à bout, les statuts et ce que
l'agent et le n+1 ont dit de chaque objectif. Une année dont le 15 décembre
est passé garde l'évaluation faite : validée si un semestre l'a été (la
note du 2nd quand les deux le sont), sinon en attente du n+1. L'année en
cours ne reste validée, ou en attente du n+1, que si ses deux semestres
l'étaient ; sinon l'auto-évaluation de l'année reste à faire, avec ce qui a
déjà été dit. Les fiches telles qu'elles étaient restent à part
(`objectifs_fiches_semestres`), sans que l'application ne les lise.

## Conséquences

- Les routes de l'auto-évaluation et de l'évaluation perdent le semestre
  (`/objectifs/moi/fiches/:annee/…`,
  `/objectifs/equipe/:employeeId/fiches/:annee/…`) ; la date se lit et se
  fixe à `/objectifs/evaluations/date`.
- Les avis disent « vos objectifs de l’année 2026 » ; l'appel du n+1 suit la
  fiche de l'année, et les appels des semestres fondus n'en font qu'un.
- La migration 0111 s'applique à une base en service avec
  `MIGRATIONS_DESTRUCTIVES=0111_objectifs_annuels.sql`, la sauvegarde faite.
- Les jours des semestres choisis par la DCH ne sont pas repris : la date
  repart du 15 décembre.
- Une livraison suivante supprimera `objectifs_fiches_semestres`, la
  colonne `semestre` et les jours des semestres, dans un fichier déclaré
  destructif (ADR-0010).
