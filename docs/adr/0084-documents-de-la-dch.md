# ADR-0084 : La liste des documents à demander est celle de la DCH

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0044](0044-demander-un-document-en-fenetre.md) et l'[ADR-0045](0045-autre-document-retire.md) ; le bulletin de l'[ADR-0039](0039-bulletin-de-salaire-avec-ses-mois.md) ne se demande plus

## Contexte

« Demander un document » proposait six documents : attestation de travail,
attestation de stage, contrat de travail, bulletin de salaire, attestation
de salaire, certificat de travail. La DCH a fourni la liste complète des
documents que les agents lui demandent.

## Décision

**On demande les seize documents de la DCH, dans l'ordre de sa liste** :
contrat de travail à durée déterminée, contrat de travail à durée
indéterminée, contrat de stage, attestation de congé, attestation de
travail, attestation de reprise de service, attestation de reprise après
disponibilité, attestation de départ à la retraite, attestation de stage,
attestation de cessation de paiement et d'activités, attestation de revenu,
domiciliation bancaire, décision de mise en disponibilité, décision de
renouvellement de disponibilité, déclaration de mouvement du travailleur,
certificat de travail.

Aucun ne demande de précision, et tout agent peut les demander.
L'application génère toujours l'attestation de travail ; la DCH prépare
les autres, et les remet en main propre ou en ligne (ADR-0040).

**Le contrat de travail, le bulletin de salaire et l'attestation de salaire
ne se demandent plus.** L'API les refuse à la création. Comme « Autre
document » (ADR-0045), les demandes faites avant restent lisibles, au suivi
comme dans la file de la DCH, et se traitent comme avant ; un bulletin
demandé avec ses mois les garde, et ses avis les nomment.

**Chaque document se délègue à part**, sauf les attestations de travail et
de stage, qui vont toujours ensemble. Qui traitait les copies de contrat de
travail traite les contrats à durée déterminée, à durée indéterminée et de
stage (migration 0115). Les délégations des trois documents retirés se
closent : leurs demandes encore ouvertes reviennent à qui dirige la DCH.

## Conséquences

- La fenêtre « Demander un document » ne demande plus de mois : le choix
  des mois du bulletin (ADR-0039) disparaît, avec ses contrôles.
- Un envoi porte jusqu'aux seize documents ; chacun reste une demande à
  part, qui va à qui traite ce type.
- Les habilitations des documents retirés restent au catalogue pour les
  demandes anciennes ; la fenêtre « Déléguer » ne les propose plus.
