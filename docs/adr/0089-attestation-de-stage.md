# ADR-0089 : L'attestation de stage : le dernier stage commencé, dossier en activité ou non

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0086](0086-modeles-de-l-apix.md)

## Contexte

L'APIX a fourni le modèle, encore à l'état de brouillon, de son attestation
de stage : la mise en page des autres attestations, le numéro
« /PR/SG/APIX/DG//DCH », le timbre « Le Directeur du Capital Humain », et un
paragraphe où qui dirige la DCH atteste que l'agent « a effectué un stage sur
la période allant du … au …, en qualité de … (poste) … ». Le dossier porte le
stage : ses contrats, ses affectations, ses départs.

## Décision

**L'attestation cite le dernier stage commencé**, que le dossier soit en
activité ou non : elle se délivre le plus souvent après le stage, au départ
de l'agent ou après son embauche. Un dossier sans stage commencé n'en a pas
(`documents.sans_stage`).

**Le stage va de son premier jour à son dernier.** Renouvelé dans le mois,
c'est le même stage, comme pour l'ancienneté (ADR-0083). Il finit avec son
contrat, ou au départ s'il vient avant. Une fin que rien ne fixe encore reste
un blanc à remplir à la main ; un stage en cours s'atteste avec sa fin
prévue, la DCH décide du moment.

**Le poste est celui du stage** : l'affectation qui couvre le stage, la plus
récente ; à défaut, le poste que prévoyait le contrat. Après une embauche,
l'attestation garde le poste du stage.

**Le modèle se reprend mot pour mot**, les noms et les dates en gras, le
poste non. « L'intéressée » s'accorde au dossier : « l'intéressé »,
« l'intéressée », « l'intéressé(e) ». Le double trait du numéro, une coquille
du brouillon, n'est pas repris : « /PR/SG/APIX/DG/DCH », celui de
l'attestation de revenu.

**La file des documents ne la génère pas** (ADR-0087) : une demande
d'attestation de stage s'y traite comme un document préparé hors de
l'application ; le PDF se génère depuis « Générer des documents ».

## Conséquences

- Le numéro des actes qui passent par la direction générale se tient en un
  seul endroit (`ENTETE.referenceDG`), la qualité de qui dirige la DCH aussi.
- Un stage dont le contrat n'est pas saisi au dossier ne s'atteste pas d'ici.
