# ADR-0269 : « Télécharger » n'apparaît qu'une fois l'évaluation validée

**Statut** : acceptée · 2026-11-22 · révise l'[ADR-0268](0268-telechargement-par-l-agent.md)

## Contexte

L'ADR-0268 affichait « Télécharger » sur « Mon évaluation » dès que le N+1
avait transmis l'évaluation, avant comme après la validation. Avant la
validation, le PDF laissait vide la ligne de l'agent dans « Validation et
suivi » (« Néant »). L'APIX veut que l'agent ne télécharge que la fiche
validée.

## Décision

« Télécharger » n'apparaît dans le bandeau qu'une fois l'évaluation validée
par l'agent. `GET /v1/campagne/mon-evaluation/pdf` refuse avant : 409,
`campagne.evaluation_non_validee`, « Votre évaluation n'est pas encore
validée ». Sans évaluation, la réponse reste 404,
`campagne.sans_auto_evaluation`.

## Conséquences

- Le PDF de l'agent porte toujours le jour de la validation et son paraphe.
  La première conséquence de l'ADR-0268 ne tient plus.
- Avant de valider, l'agent lit son évaluation à l'écran, sur « Mon
  évaluation ».
