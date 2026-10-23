# ADR-0056 : Fixer des objectifs par semestre, chacun avec son échéance

**Statut** : acceptée · 2026-10-12

## Contexte

L'ADR-0055 a fait de « Fixer des objectifs » une fenêtre où chaque objectif
prend son échéance, sans semestre à choisir. À l'usage, le n+1 préfère le
geste d'avant (ADR-0051) : choisir le semestre, puis rédiger sa fiche en
trois parties, les objectifs, les formations à suivre et les commentaires.
L'échéance reste, objectif par objectif. Une échéance qui tombe juste avant
l'évaluation laisse trop peu de temps : il faut le voir au moment de la
fixer.

## Décision

**« Fixer des objectifs » ouvre un menu : Semestre 1, Semestre 2.** Le
semestre choisi ouvre sa fiche à la rédaction (ADR-0051). Une coche marque
les semestres qui ont déjà leur fiche ; les choisir y ramène. Un semestre
dont l'évaluation est passée, sans fiche, ne se choisit plus. La fenêtre de
l'ADR-0055 disparaît, avec sa route
`POST /objectifs/equipe/:employeeId/objectifs`.

**Pas d'objectif sans échéance.** Chaque objectif porte sa puce
d'échéance ; un objectif nouveau l'attend, vide. L'enregistrement est
refusé tant qu'un objectif n'a pas la sienne, et la puce se signale.
L'échéance se choisit dans la période du semestre, du lendemain de
l'évaluation précédente au jour de la sienne, jamais dans le passé. La
règle de l'ADR-0055 se lit toujours en tête des objectifs.

**Les objectifs se rangent par échéance** dans la fiche ouverte, dès
qu'une échéance se fixe ; le serveur les range de même à l'enregistrement.

**À 30 jours ou moins de l'évaluation, l'échéance se confirme.** Une
fenêtre le dit : « L'évaluation du semestre 2 de 2026 se tiendra 11 jours
après l'échéance de cet objectif. Voulez-vous confirmer cette échéance ou
reporter l'objectif à la prochaine évaluation ? » Le jour même, elle se
tient « le jour même de l'échéance de cet objectif ».

- « Confirmer » garde l'échéance.
- « Reporter à la prochaine évaluation » demande une nouvelle échéance,
  dans la période de l'évaluation suivante. La puce porte alors le
  semestre où l'objectif compte (« S1 »). À l'enregistrement, l'objectif
  part dans la fiche de cette évaluation (ADR-0055), et la fiche le dit,
  avec un lien « Voir ». Une nouvelle échéance elle aussi à 30 jours ou
  moins de son évaluation se confirme à son tour.
- Quand l'évaluation suivante tombe au-delà de la dernière où une échéance
  se fixe, seul « Confirmer » reste.
- Fermer la fenêtre garde l'échéance d'avant.

Une échéance tapée au clavier vaut quand on quitte la puce, ou sur Entrée :
un jour à moitié tapé n'ouvre pas la fenêtre.

**Le serveur range comme avant.** L'enregistrement d'une fiche fait partir
dans sa fiche l'objectif dont l'échéance tombe dans une autre période
(ADR-0055). Une fiche neuve dont tous les objectifs partent ailleurs ne se
crée pas ; l'enregistrement rend alors `majLe: null`.

## Conséquences

- L'ADR-0051 retrouve son geste « Fixer des objectifs ».
- L'ADR-0055 vaut toujours pour le rattachement, le tri, les déplacements,
  les bornes et les dates de la DCH ; sa fenêtre et sa route `POST` sont
  remplacées.
- Un objectif sans échéance à lui, fixé avant les échéances, garde celle de
  sa fiche (ADR-0055). L'écran n'enregistre plus d'objectif sans échéance.
- Les objectifs reportés depuis une fiche pendant qu'une autre est ouverte
  s'ajoutent à l'enregistrement de celle-ci, sans se perdre.
