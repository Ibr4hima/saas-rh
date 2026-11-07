# ADR-0132 : L'attestation de stage : le stage au choix, quand le dossier en compte plusieurs

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0089](0089-attestation-de-stage.md) et l'[ADR-0130](0130-cible-des-documents.md)

## Contexte

L'attestation de stage citait le dernier stage commencé (ADR-0089). Une
personne peut pourtant avoir fait plusieurs stages à l'APIX, à des années
d'écart : six mois en 2012, quatre mois en 2015. L'attestation doit pouvoir
citer l'un ou l'autre.

## Décision

**La liste propose toute personne qui a fait un ou plusieurs stages**, sous
contrat aujourd'hui ou non, en activité ou partie (ADR-0130). Un stage en
cours compte aussi : il s'atteste avec sa fin prévue.

**À plusieurs stages, la DCH choisit lequel.** Sous l'agent, « Sélectionner
le stage » offre une liste obligatoire : « Du 1er mars 2012 au 31 août 2012
· Stagiaire juriste », « Du 5 janv. 2015 au 4 mai 2015 · Stagiaire
comptable ». « Valider » attend le choix. À un seul stage, rien à choisir.

**Un stage suit la règle de l'ADR-0089** : renouvelé dans le mois, c'est le
même stage ; il va du premier jour de son premier contrat au dernier jour
de son dernier, ou au départ s'il vient avant ; le poste est celui occupé
pendant le stage.

**Le serveur exige le choix** : sans lui, un dossier à plusieurs stages est
refusé (`documents.stage_a_choisir`) ; un jour qui n'ouvre aucun stage du
dossier aussi (`documents.stage_inconnu`).

## Conséquences

- `GET /employees/:id/stages` donne les stages du dossier, du plus ancien
  au plus récent ; la saisie `stage` porte le premier jour du stage choisi.
- Un dossier à un seul stage se génère comme avant.
