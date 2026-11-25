# ADR-0137 : « Demander un document » n'offre à l'agent que les documents de sa cible

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0130](0130-cible-des-documents.md)

## Contexte

« Générer des documents » ne propose, pour chaque document, que les agents
de sa cible (ADR-0130). La liste de « Demander un document » offrait
pourtant tous les documents à tout agent : une attestation de travail à qui
est en stage, la reprise de service après un congé de maternité à un
dossier au genre masculin, le départ à la retraite à 25 ans.

## Décision

**La liste n'offre à l'agent que les documents de sa cible**, lue à son
dossier : l'activité, le contrat qui fait foi, un stage, le genre, l'âge.
Les autres n'y paraissent pas.

**Un document qui se génère pour un agent garde la cible de « Générer des
documents »** (ADR-0130, ADR-0131) : l'attestation de stage pour qui a fait
un stage, la maternité au genre féminin, le départ à la retraite dès
40 ans sous CDI ou CDD, le certificat de travail au départ.

**Les documents que la DCH renseigne sur une fiche reçoivent la leur** : la
domiciliation bancaire, les deux décisions de disponibilité et la
déclaration de mouvement supposent un CDI ou un CDD en cours ; leurs fiches
ne connaissent pas d'autre contrat.

**Le serveur refuse un document hors de la cible**, en le disant, avec les
codes de l'ADR-0130 (`documents.stage`, `documents.genre`,
`documents.age`…). Rien ne part.

## Conséquences

- `GET /document-requests/demandables` donne les documents qu'un agent
  peut demander, dans l'ordre de la liste.
- Un agent en activité ne voit plus le certificat de travail : il se
  délivre au départ.
- Les demandes déjà faites ne changent pas.
