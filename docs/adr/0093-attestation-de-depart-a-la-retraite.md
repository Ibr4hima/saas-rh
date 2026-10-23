# ADR-0093 : L'attestation de départ à la retraite : le jour du départ saisi

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0092](0092-attestation-de-conge.md)

## Contexte

L'APIX a fourni le modèle, encore à l'état de brouillon, de son attestation
de départ à la retraite : la mise en page des autres attestations, le numéro
« /PR/SG/APIX/DG/DCH », le timbre « Le Directeur du Capital Humain », puis
l'agent, sa date d'entrée et sa fonction, et le jour où l'agent « fera valoir
ses droits à la retraite ». Le dossier ne porte pas ce jour.

## Décision

**La DCH saisit le jour du départ**, comme les dates du congé : un bloc
« Saisir la date de départ à la retraite », une date au calendrier du
navigateur. Sans elle, l'attestation est refusée (`documents.depart`).

**Le modèle se reprend mot pour mot**, comme l'attestation de revenu dont il
suit les deux premières phrases : qui atteste dirige la DCH, au genre de son
dossier, timbre compris ; la date d'entrée est le début de l'ancienneté
(ADR-0083), à défaut l'embauche ; la fonction, omise si le dossier n'en porte
pas. Les noms et les dates sont en gras, la fonction non. « L'intéressé »
s'accorde au dossier ; « APIX-S.A. » devient « APIX-SA » (ADR-0088) ; le titre
prend ses accents : « ATTESTATION DE DÉPART À LA RETRAITE ».

**Elle se délivre avant le départ** : un agent en activité, sous contrat de
travail, comme l'attestation de travail. Le jour saisi n'est pas contrôlé :
la DCH le vérifie avant de signer.

## Conséquences

- La file des documents ne la génère pas (ADR-0087).
- Une fois le départ enregistré, le dossier inactif relève du certificat de
  travail (ADR-0091).
