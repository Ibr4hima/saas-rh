# ADR-0133 : Les dates des fiches : la CNI à jour, rien dans l'avenir, chaque fin après son début

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0092](0092-attestation-de-conge.md), l'[ADR-0098](0098-contrats-de-travail.md), l'[ADR-0100](0100-decisions-de-disponibilite.md), l'[ADR-0102](0102-domiciliation-bancaire.md), l'[ADR-0104](0104-reprise-apres-disponibilite.md) et l'[ADR-0106](0106-declaration-de-mouvement.md)

## Contexte

Les fiches de « Générer des documents » acceptaient des dates incohérentes :
une demande datée de demain, une CNI périmée, un congé qui finit le jour où
il commence, un visa antérieur au contrat qu'il approuve. L'APIX fixe, document
par document, ce que les dates doivent respecter.

## Décision

**Les règles de l'APIX :**

- Contrats à durée indéterminée et déterminée : la CNI est à jour. La fiche
  n'en porte que la date de délivrance ; une CNI vaut dix ans : elle a été
  délivrée il y a moins de dix ans, et pas dans l'avenir.
- Attestation de congé : le dernier jour suit strictement le premier.
- Domiciliation bancaire : la demande, pas après aujourd'hui.
- Mise en disponibilité : la demande pas après aujourd'hui ; la prise
  d'effet pas avant la demande ; la date limite de reprise après la prise
  d'effet ; les deux nominations pas après aujourd'hui.
- Renouvellement de disponibilité : la même chose. La prorogation prend
  effet le lendemain de la période initiale : la demande vient au plus tard
  ce jour-là, et la reprise suit la période initiale.
- Reprise après disponibilité : le dernier jour de la disponibilité suit le
  premier ; la reprise de service n'est pas avant le dernier jour.
- Déclaration de mouvement du travailleur : l'entrée dans l'établissement et
  la date du contrat avant aujourd'hui ; les visas d'approbation et
  d'enregistrement pas après.
- Toute date de naissance est dans le passé ; les fiches suivent la règle
  du dossier de l'agent : quinze ans révolus.

**S'y ajoutent :**

- Domiciliation bancaire : le début du contrat pas après aujourd'hui (la
  lettre dit que la personne « fait partie de notre personnel depuis » ce
  jour), et la demande pas avant lui.
- Déclaration de mouvement : les visas pas avant la date du contrat ; la
  déclaration d'embauche pas après aujourd'hui ; l'entrée au Sénégal pas
  après aujourd'hui, ni après l'entrée dans l'établissement, et après la
  naissance ; la classe de recrutement ni dans l'avenir, ni avant l'année de
  naissance.

**À l'écran**, chaque champ de date borne son calendrier ; une règle
enfreinte se dit sous le champ, en rouge, dès que la date est saisie, et
« Valider » attend qu'elles soient toutes respectées. Le serveur applique les
mêmes règles.

## Conséquences

- Les règles vivent au contrat : celles d'un champ dans son schéma, celles
  qui lient deux dates dans une fonction que l'écran appelle aussi, Zod les
  taisant tant qu'une liste de la fiche n'est pas choisie.
- Aujourd'hui se lit à l'heure de Dakar, celle de l'UTC.
- L'ADR-0104 admettait une reprise avant la fin prévue de la disponibilité :
  une reprise anticipée se saisit désormais avec le vrai dernier jour.
- Une CNI délivrée il y a dix ans ou plus bloque le contrat : la DCH saisit
  la carte renouvelée.
