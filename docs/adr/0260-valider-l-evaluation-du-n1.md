# ADR-0260 : « Valider » chez le N+1 : la fiche en PDF avant de la transmettre à l'agent

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0241](0241-valider-l-auto-evaluation.md)

## Contexte

Sous l'auto-évaluation, « Valider » montre à l'agent sa fiche en PDF avant
de la transmettre (ADR-0241). Sous l'évaluation du N+1, la barre au bas de
la page ne portait que « Transmettre à l'agent ». L'APIX veut le même
« Valider », à gauche de « Transmettre à l'agent », qui génère le PDF de la
fiche.

## Décision

**La barre au bas de l'évaluation porte « Valider »**, à gauche de
« Transmettre à l'agent ». Comme la transmission, il reste inactif tant que
l'obligatoire n'est pas rempli. Un clic replie la saisie et affiche à sa
place la fiche entière en PDF, à la largeur de la page : l'auto-évaluation
de l'agent, l'évaluation du N+1 telle que la saisie la remplit, enregistrée
ou non, et la partie réservée à la hiérarchie. La page repart de son haut.
« Modifier » prend alors la place de « Valider » et rouvre la saisie.

**L'API génère ce PDF sans rien enregistrer** :
`POST /campagne/equipe/{agent}/apercu`, avec l'évaluation et la partie
réservée en cours. Seul l'évaluateur de l'agent l'obtient (sinon 404,
`campagne.agent_hors_equipe`), une fois l'auto-évaluation transmise (sinon
409, `campagne.auto_non_transmise`). Comme à la transmission, les lignes
restées vides des tableaux n'y figurent pas.

## Conséquences

- Les validations du PDF restent vides : l'évaluation n'est encore ni
  transmise ni validée par l'agent.
- L'aperçu de l'auto-évaluation et celui du N+1 partagent le même
  composant.
