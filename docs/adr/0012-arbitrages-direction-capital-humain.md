# ADR-0012 — Arbitrages de la Direction du Capital Humain (APIX)

**Statut** : acceptée · 2026-08-19

## Contexte

Revue du projet avec la Direction du Capital Humain (DCH) de l'APIX. Deux
décisions structurantes remontent du terrain et corrigent des hypothèses du
dossier d'architecture initial (ch. 01 §6.5 « paie » et §6.3 « self-service »).

## Décision 1 — La paie reste hors périmètre

La DCH exploite déjà un système de paie qu'elle ne souhaite pas remplacer :
les données de rémunération sont jugées trop sensibles pour migrer.

- Le module paie est **retiré de la feuille de route** (ni calcul, ni
  bulletins, ni déclarations sociales).
- Le scénario « salaires versés par le Trésor public »
  (`docs/architecture/10-scenario-tresor-public.md`) devient **caduc pour
  l'APIX** ; le document reste comme référence pour de futurs clients PME.
- Conséquence produit : Teranga RH est un SIRH **hors paie** pour ce pilote.
  Un connecteur d'export (matricules, absences décomptées) reste possible
  plus tard si la DCH le demande — jamais un import de rémunérations.
- Conséquence technique : le rôle `payroll` est conservé (lecture des
  dossiers pour rapprochement), mais aucune donnée salariale n'est stockée.

## Décision 2 — Les documents officiels ne sont pas téléchargés par l'employé

Au Sénégal, un document RH n'a de valeur que **cachetté et signé**. Laisser
l'employé télécharger une attestation depuis son espace contredit la
procédure : le document sortirait sans cachet ni signature.

Circuit retenu (implémenté par la migration `0010_document_requests.sql`) :

1. L'employé **demande** un ou plusieurs documents depuis son espace
   (attestation de travail, contrat, bulletin de salaire…), avec une
   précision libre (période, motif).
2. La RH reçoit la demande dans sa file d'attente et est **notifiée**.
3. Elle passe la demande **en traitement** (l'employé est notifié : « votre
   demande est en cours ») et génère les documents qu'elle sait produire —
   l'attestation de travail est générée par l'application, les autres sont
   produits hors application (paie, contrats papier).
4. Elle imprime, cachette, signe, puis marque la demande **prête** en
   indiquant **auprès de qui** le document est à retirer. L'employé reçoit
   un message explicite (« disponibles auprès de Mme X, Direction du
   Capital Humain — veuillez passer les récupérer »).
5. Au retrait, la RH marque **remis** : la traçabilité est complète.
   Une demande peut aussi être **refusée avec motif** (ex. bulletin de
   salaire qui relève du système de paie externe).

Conséquences :

- Le téléchargement self-service de l'attestation (`GET /me/attestation`)
  est **supprimé** : la génération reste réservée à la RH depuis la fiche
  employé (`GET /employees/:id/attestation`).
- L'historique des demandes est visible **des deux côtés** : sur la fiche
  employé pour la RH, dans l'espace personnel pour l'employé.
- Les pièces justificatives _déposées_ par l'employé (CNI, diplômes,
  ADR précédent) ne sont pas concernées : elles restent en self-service
  avec validation croisée, car ce sont des pièces entrantes, pas des
  documents officiels sortants.
