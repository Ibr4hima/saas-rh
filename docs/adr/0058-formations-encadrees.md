# ADR-0058 : Formations encadrées par l'agent ; la fenêtre de confirmation comme la fiche

**Statut** : acceptée · 2026-10-12

Précise l'[ADR-0057](0057-echeance-confirmee-a-l-enregistrement.md) et, pour
les formations à suivre, l'[ADR-0027](0027-formations-a-suivre-en-badges.md).
Remplace la phrase de la fenêtre que citait
l'[ADR-0056](0056-fixer-des-objectifs-par-semestre.md).

## Contexte

L'ADR-0057 ne proposait plus à un agent les formations que l'agent anime,
et laissait ouverte la question des formations dont l'évaluation est fermée
à l'agent parce que l'agent gère l'Academy. La fenêtre « Confirmer cette
échéance ? » montrait l'objectif en gras, puis son échéance : autrement que
la fiche où on l'écrit.

## Décision

**Ne se proposent pas non plus les formations dont l'évaluation est fermée
à l'agent** (academy-evaluation.service.ts, `fermeture`) :

- toutes celles qui s'évaluent, quand l'agent gère le catalogue de
  l'Academy : qui dirige la DCH, qui a la délégation « APIX Academy »,
  l'administrateur ;
- celles dont l'agent a vu les réponses (la banque de questions à
  l'atelier, une question écrite, un essai corrigé), même sa délégation
  retirée.

Une formation sans évaluation se suit jusqu'au bout : elle reste proposée.
Celles que l'agent anime ne se proposent toujours pas, qu'elles s'évaluent
ou non. La fiche du membre (`GET /objectifs/equipe/:employeeId`) les donne
toutes dans `formationsEncadrees`, qui remplace `formationsAnimees`.

**La fenêtre montre l'objectif comme la fiche**, dans sa carte : sa case,
son texte, sa puce d'échéance (« S1 » quand l'échéance compte pour une autre
évaluation). L'avertissement suit dans une autre carte ; pour reporter, la
nouvelle échéance prend sa place. Elle est aussi large que les fenêtres de
saisie : l'objectif y tient sur sa ligne, comme dans la fiche.

**La phrase dit « S2 »** : « L'évaluation du S2 de 2026 se tiendra 8 jours
après l'échéance de cet objectif. Voulez-vous confirmer cette échéance ou
reporter l'objectif à la prochaine évaluation ? »

## Conséquences

- Pour qui gère le catalogue, seules les formations sans évaluation restent
  proposées.
- Une formation demandée avant que l'agent ne l'encadre reste dans la
  fiche, et son badge à l'écran du n+1, qui peut la retirer (ADR-0057).
- Le champ du report garde son intitulé : « Nouvelle échéance, au
  semestre 1 de 2027 ».
