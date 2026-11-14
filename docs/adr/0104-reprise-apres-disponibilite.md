# ADR-0104 : L'attestation de reprise après disponibilité : les dates saisies, l'agent au dossier

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0092](0092-attestation-de-conge.md)

## Contexte

L'APIX a fourni le modèle de son attestation de reprise de service après
disponibilité : la mise en page des autres attestations, le timbre « Le
Directeur du Capital Humain », le titre encadré « ATTESTATION DE REPRISE DE
SERVICE », puis un paragraphe. Qui dirige la DCH y atteste que l'agent,
nommé avec son poste et sa direction, mis en disponibilité pour une période,
a repris service tel jour. L'agent est dans l'application, son dossier en
activité.

## Décision

**L'attestation se génère pour un agent** (ADR-0085), dont le dossier donne
le nom, le genre, le poste et l'unité ; la DCH saisit trois dates, comme
pour l'attestation de congé (ADR-0092) : le premier et le dernier jour de la
disponibilité, puis le jour de la reprise de service. Les trois sont
obligatoires ; la fin suit le début, la reprise aussi, et elle peut
précéder la fin : une reprise anticipée. Une saisie s'ajoute, `reprise`.
Le début et la fin portent ici les intitulés de la disponibilité (« Saisir
la date de début de la disponibilité ») ; l'attestation de congé garde les
siens.

**Le poste s'écrit avec son unité** : « Chargée d'études à la Direction du
Capital Humain ». Qui dirige l'unité a un poste qui la nomme déjà : le poste
seul, « Cheffe du département Études ». Sans unité, le poste seul ; sans
poste, rien.

**Ce qui s'accorde vient du dossier et de l'organigramme** : « mise en
disponibilité » au genre de l'agent ; « Je soussignée, Madame …, Directrice
du Capital Humain » au genre de qui dirige la DCH, nommée d'après
l'organigramme et non d'après le modèle ; la place vacante laisse des
pointillés. Les noms et le jour de la reprise sont en gras, comme sur le
modèle.

**Les coquilles se corrigent** (ADR-0095) : la virgule qui ferme l'incise
avant « a repris service » ; les accords (« Je soussigné », « mise »).

## Conséquences

- Un dossier inactif ou un stage est refusé, comme pour les autres
  attestations (ADR-0086).
- L'affectation en cours d'un agent, son unité et la tête de l'unité, se lit
  au dossier (`affectationDeLAgent`, `documents/dossier.ts`).
