# ADR-0267 : L'agent valide son évaluation, sans pouvoir la renvoyer au N+1

**Statut** : acceptée · 2026-11-22 · revient sur le renvoi de l'[ADR-0217](0217-validation-par-l-agent.md) et sur la conséquence de l'[ADR-0266](0266-confirmation-du-n1.md)

## Contexte

L'ADR-0217 donnait deux gestes à l'agent sur « Mon évaluation » :
« Valider mon évaluation » et « Renvoyer à mon N+1 », avec un mot
obligatoire. Renvoyée, l'évaluation redevenait un brouillon du N+1.

Depuis l'ADR-0266, la fenêtre du N+1 dit : « Elle ne pourra plus être
modifiée. » Le renvoi contredisait ce texte. L'APIX retire le renvoi.

## Décision

**Un seul geste pour l'agent.** La barre au bas de « Mon évaluation » ne
porte plus que « Valider mon évaluation ». La fenêtre de confirmation dit :
« Elle devient définitive : elle ne pourra plus être modifiée. » Les mots
« ni renvoyée » disparaissent.

**L'API** retire `POST /v1/campagne/mon-evaluation/renvoi`. Les réponses
perdent `renvoyable`, `renvoi` et `renvoyeeLe`, et l'état `renvoyee`
disparaît, chez l'agent comme chez le N+1. La validation ne change pas :
`POST /v1/campagne/mon-evaluation/validation`, à tout moment une fois
l'évaluation transmise, même après la période.

**Chez le N+1**, le mot de l'agent ne s'affiche plus au-dessus de la fiche,
et l'étape « Évaluation par le N+1 » ne dit plus « Renvoyée le … ».

**La base** garde les colonnes `renvoyee_le` et `renvoi_mot` de la
migration 0140, sans les lire ni les écrire. Une migration pourra les
retirer plus tard. Une fiche renvoyée avant ce changement se lit comme un
brouillon du N+1 : le N+1 la reprend et la transmet de nouveau.

## Conséquences

- Un agent en désaccord n'a plus de geste dans la plateforme : le désaccord
  se règle pendant l'entretien, avant la transmission (ADR-0265). La fiche
  S1/EN05 n'a pas de place pour un commentaire de l'agent.
- La conséquence de l'ADR-0266 sur le renvoi ne tient plus : une évaluation
  transmise à l'agent ne revient plus au N+1.
