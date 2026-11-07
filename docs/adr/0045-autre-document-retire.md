# ADR-0045 : « Autre document » ne se demande plus

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0044](0044-demander-un-document-en-fenetre.md)

## Contexte

Sans le champ « Précision » (ADR-0044), « Autre document » partait sans dire
lequel : la DCH ne pouvait le préparer qu'en le demandant à l'agent.

## Décision

**« Autre document » sort de la liste.** On demande une attestation de
travail ou de stage, un contrat de travail, un bulletin ou une attestation
de salaire, un certificat de travail. L'API refuse « autre » à la création.

**Les demandes faites avant restent lisibles**, au suivi comme dans la file
de la DCH, et se traitent comme avant.

## Conséquences

- La conséquence de l'ADR-0044 sur « Autre document » tombe.
- Comme pour les documents officiels déposés, « autre » ne se lit plus que
  sur les demandes anciennes ; leur traitement reste à qui dirige la DCH.
