# ADR-0216 : L'évaluation par le N+1, sur la fiche S1/EN05

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0215](0215-formulaire-d-auto-evaluation.md), révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

Une fois l'auto-évaluation transmise (ADR-0215), le N+1 remplit sa part de
la fiche S1/EN05 (ADR-0205) : l'appréciation de chaque objectif, les
compétences, la synthèse et le plan d'action, les objectifs et les
formations de l'année suivante, et la partie strictement réservée à la
hiérarchie, que l'agent ne lit jamais. La fiche s'ouvre depuis la carte de
l'agent, sur l'accueil de la campagne.

## Décision

**La fiche entière, dans son ordre.** Sur la page de l'agent, sous son
en-tête et ses deux étapes (l'auto-évaluation, l'évaluation du N+1, côte à
côte sur un grand écran), la fiche se lit et se remplit dans l'ordre du
PDF :

- « Récapitulatif et faits marquants », de l'agent, en lecture ;
- « Évaluation des résultats » : pour chaque objectif, l'auto-évaluation de
  l'agent et l'appréciation du N+1 (niveau, commentaire) côte à côte sur un
  grand écran, l'une sous l'autre sur un téléphone ; puis les autres
  réalisations de l'agent ;
- « Évaluation des compétences et des performances » : chaque compétence
  avec ses quatre niveaux décrits, l'échelle (Excellent, Satisfaisant, À
  améliorer, Non acceptable) en tête de la carte ; le management pour le
  personnel cadre seulement ;
- « Synthèse de l'évaluation et axes d'amélioration » : le bilan global
  (points forts, axes de développement) et le plan d'action ;
- « Objectifs et perspectives » de l'année suivante : ses objectifs, avec
  leur indicateur et leur échéance, et les besoins de formation ;
- « Préoccupations et souhaits », de l'agent, en lecture ;
- « Partie strictement réservée à la hiérarchie » : la compréhension et la
  tenue du poste, les observations du N+1.

Chaque carte dit qui la remplit (« Rempli par l'agent », « Rempli par le
N+1 »), comme le PDF. Les intitulés sont ceux de la fiche de la DCH
(contrats, `entretien-annuel.ts`).

**Les tableaux** (plan d'action, objectifs de l'année suivante, formations)
se remplissent ligne par ligne : sur une zone large, une ligne par entrée
sous les titres des colonnes, comme sur la fiche ; sur une zone étroite,
chaque entrée s'empile, chaque case sous son titre. Au plus 8 actions, 10
objectifs et 6 formations. Une ligne laissée vide ne part pas avec
l'évaluation transmise (`sansLignesVides`).

**Obligatoires, et marqués d'un astérisque** : le niveau de chaque
objectif, chaque compétence (sauf le management, qui se remplit s'il y a
lieu), les points forts, les axes de développement, la compréhension et la
tenue du poste. La règle vit une seule fois, dans les contrats
(`ceQuiManqueALEvaluationDuN1`) : l'écran et l'API l'appliquent. Le
personnel de la fiche se lit sur le statut de l'agent : cadre, sinon non
cadre (`personnelDeLaFiche`).

**L'enregistrement est automatique**, comme celui de l'auto-évaluation, avec
le même code (`useEnregistrementAuto`, `BarreDeTransmission`). La barre
collée au bas de l'écran porte « Transmettre à l'agent ». La transmission
se confirme : l'évaluation part à l'agent, sans la partie réservée, et ne
change plus. Elle se lit alors, dans la même forme.

**Le temps de l'évaluation.** Le N+1 évalue dès que l'auto-évaluation est
transmise, et jusqu'à la fin de la période (`au`) ; plus seulement après la
fin de l'auto-évaluation (`auto_au`), comme le prévoyait l'ADR-0211.

**L'API** : `PUT /v1/campagne/equipe/{agent}/evaluation` (le brouillon) et
`POST …/evaluation/transmission`, avec `{ evaluation, reservee }`.
L'écriture est réservée à l'évaluateur de l'agent (sinon 404,
`campagne.agent_hors_equipe`), une fois l'auto-évaluation transmise (409,
`campagne.auto_non_transmise`), pendant la période (409,
`campagne.evaluation_fermee`) et tant que l'évaluation n'est pas transmise
(409, `campagne.evaluation_transmise`).
Incomplète, la transmission est refusée (422,
`campagne.evaluation_incomplete`) et la réponse dit ce qui manque.
L'appréciation d'un objectif absent de la fiche et le management d'un agent
non cadre ne s'enregistrent pas. `GET /v1/campagne/equipe/{agent}` rend
aussi l'évaluation, la partie réservée, leur état et le jour de la
transmission.

**La migration 0139** ajoute à `fiches_entretien` : `evaluation` et
`reservee`, à part l'une de l'autre (l'agent lira la première, jamais la
seconde), `evaluation_par_employee_id`, qui l'a écrite, et
`evaluation_transmise_le`.

**Sur l'accueil**, la carte d'un agent dont l'auto-évaluation est faite dit
où en est son évaluation : « À évaluer », en orange, ce qui attend le N+1,
puis « Évaluation en cours » et « Évaluation transmise ». Les autres cartes
gardent l'état de l'auto-évaluation.

**Les quatre niveaux courts d'un objectif** (Dépassé, Réalisé…) se mettent
sur une ligne selon la place de leur zone, et non plus celle de l'écran :
dans une colonne étroite, ils passent deux par deux.

## Conséquences

- L'agent ne lit pas encore l'évaluation transmise : sa lecture et sa
  validation viennent à l'étape suivante, puis les commentaires du N+2.
- Ce que l'API rendra à l'agent ne devra jamais inclure `reservee`.
- Les niveaux courts de la grille de l'ancienne plateforme suivent eux aussi
  la place de leur zone.
