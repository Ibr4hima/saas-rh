# ADR-0268 : « Télécharger » : l'agent enregistre son évaluation en PDF, sans la partie réservée

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0217](0217-validation-par-l-agent.md)

## Contexte

L'agent lit son évaluation sur « Mon évaluation » (ADR-0217), mais ne
peut pas en garder de copie. La fiche S1/EN05 prévoit pourtant une copie
pour l'agent : « Diffusion : original au dossier du personnel (DCH) ·
copie à l'agent. » Jusqu'ici, seule la DCH téléchargeait la fiche, dans sa
version complète (ADR-0221).

## Décision

**« Télécharger »**, dans le bandeau de « Mon évaluation », dès que le N+1
a transmis l'évaluation, avant comme après la validation. C'est le bouton
blanc des gestes du bandeau, comme « Télécharger le PDF » chez la DCH. Les
deux boutons partagent désormais le même composant.

**Le PDF** est la version de l'agent de la fiche S1/EN05 : les sections 1
à 7, de l'identification à « Validation et suivi ». La section 8, « Partie
strictement réservée à la hiérarchie », n'y figure pas, ni les commentaires
du N+2, qui en font partie. Le N+1 y figure avec le jour de la
transmission, et l'agent avec le jour de sa validation, une fois
l'évaluation validée.

**L'API** : `GET /v1/campagne/mon-evaluation/pdf`, en pièce jointe, sous
le nom `fiche-entretien-2026-<matricule>.pdf`. Avant la transmission : 409,
`campagne.evaluation_non_transmise`. Sans évaluation (au sommet de
l'organigramme, en stage, sans dossier) : 404,
`campagne.sans_auto_evaluation`. `GET /v1/campagne/mon-evaluation` donne
aussi le matricule, pour nommer le fichier. Rien n'est stocké : le PDF se
compose à chaque téléchargement.

## Conséquences

- Avant la validation, la ligne de l'agent dans « Validation et suivi »
  reste sans date ni paraphe (« Néant »). Sous le tableau, la fiche rappelle
  qu'elle n'est valable qu'une fois validée par l'agent.
- Le nom du fichier distingue la version de l'agent de la version complète
  de la DCH, qui se termine par `-complete`.
