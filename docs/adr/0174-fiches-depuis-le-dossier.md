# ADR-0174 : Les fiches préremplies au dossier de l'agent, la prime de transport facultative, le stage de un à six mois

**Statut** : acceptée · 2026-11-06 · précise les [ADR-0094](0094-contrat-de-stage.md), [ADR-0098](0098-contrats-de-travail.md), [ADR-0100](0100-decisions-de-disponibilite.md), [ADR-0102](0102-domiciliation-bancaire.md), [ADR-0130](0130-cible-des-documents.md) et [ADR-0168](0168-champs-par-lignes-pleines.md)

## Contexte

La domiciliation bancaire et les décisions de disponibilité se font sans
agent : la DCH tape tout ce qu'elles impriment (ADR-0100, ADR-0102). Or ces
documents concernent un agent de l'APIX, dont le dossier porte déjà le nom,
le poste, l'affectation et le contrat, et, depuis l'import du fichier de la
DCH, la banque et le RIB.

Le contrat de travail s'ouvrait avec une prime de transport de 26 000 F CFA
(ADR-0168), toujours imprimée. Tous les agents n'en ont pas.

Le contrat de stage proposait une durée de un à vingt-quatre mois ; un stage
de l'APIX dure de un à six mois.

## Décision

**L'agent se choisit, et son dossier remplit la fiche.** La domiciliation
bancaire, la décision de mise en disponibilité et celle de renouvellement
commencent par « Sélectionner l'agent », parmi les agents en activité sous
CDI ou CDD, jamais soi. Le dossier remplit alors :

- pour la domiciliation, la civilité, le prénom, le nom, la fonction, le
  type de contrat et la date de début du contrat qui fait foi ; la banque et
  le RIB quand le dossier les porte, à qui a l'accès aux données sensibles
  (ADR-0158). Un RIB du dossier arrive validé et confirmé : il ne se retape
  pas ;
- pour les décisions, la civilité, le prénom, le nom, le poste et
  l'affectation.

Tout se corrige. Ce que le dossier ne porte pas reste à saisir : les dates
de la demande, le destinataire de la lettre, le salaire net. Choisir un autre
agent vide la fiche, sauf les sessions du conseil d'administration, qui sont
de l'organisation. « Valider » attend l'agent. La génération ne change pas :
la fiche complète part à l'API, qui la valide comme avant.

**La prime de transport se coche.** La fiche du contrat de travail a une case
« Prime de transport », décochée à l'ouverture. Cochée, le montant se saisit
à côté, prérempli à 26 000 F CFA. Décochée, le contrat n'écrit pas la ligne
de la prime, et le salaire brut s'en passe. Une prime accordée a un montant :
zéro est refusé.

**Le stage dure de un à six mois.**

**Des intitulés plus précis** : « Destinataire de la lettre » et « Date de la
demande de domiciliation » pour la domiciliation, « Date de la demande de
disponibilité » et « Date de la demande de renouvellement » pour les
décisions.

## Conséquences

- `GET /documents/generer/:type/agents` propose aussi les agents de ces
  trois fiches ; `GET /documents/generer/:type/agents/:id/fiche` rend ce que
  le dossier en porte. Le RIB n'en sort que pour la domiciliation.
- Les dossiers importés sans banque ni RIB, comme aujourd'hui, laissent ces
  deux champs à saisir ; ils se rempliront seuls quand l'import les portera.
- Pour un agent absent de l'application, la domiciliation et les décisions
  de disponibilité attendent que son dossier soit créé dans le personnel.
