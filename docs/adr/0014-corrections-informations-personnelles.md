# ADR-0014 — Corrections des informations personnelles par l'employé

**Statut** : acceptée · 2026-08-22

## Contexte

Un dossier RH se périme sans que personne ne s'en aperçoive. Un agent déménage,
se marie, change de numéro : la Direction du Capital Humain ne peut pas le
deviner, et l'agent n'a aucun moyen de le signaler autrement qu'en passant au
bureau. Le dossier dérive, et on ne s'en rend compte qu'au moment d'en avoir
besoin — pour un courrier, un contact d'urgence, une déclaration.

Le circuit des demandes de documents (ADR-0012) a montré que le bon partage
est : l'employé déclare, la RH tranche.

## Décision — Il propose, la RH confirme, le dossier se met à jour

L'employé voit son dossier dans « Mes informations » et signale ce qui a changé.
La RH est notifiée, voit « avant → après », et confirme ou refuse avec motif.
Une confirmation applique les valeurs **immédiatement** : sans cela, la RH
devrait ressaisir ce que l'employé vient d'écrire, et l'erreur de recopie
reviendrait par la fenêtre.

Une seule demande en attente à la fois (index unique partiel) : deux demandes
concurrentes se contrediraient sans que la RH puisse trancher laquelle prime.

## Le périmètre est étroit, et c'est délibéré

Sont modifiables **uniquement** : situation matrimoniale, courriel personnel,
téléphone personnel, adresse, ville, contact d'urgence et son téléphone.

En sont exclus :

- **l'identité** (nom, sexe, date et pays de naissance, nationalité) et les
  **pièces d'identité** : elles s'appuient sur un document officiel, pas sur une
  déclaration. La page le dit et renvoie vers la DCH ;
- **tout ce qui relève du contrat** (matricule, poste, unité, manager, statut,
  dates, courriel et téléphone professionnels) : ce n'est pas au salarié de
  décrire sa propre situation contractuelle.

## Conséquence technique — jamais de recopie de clés

Les valeurs proposées transitent par un `jsonb`. Le confirmer signifie écrire
dans `persons`, donc c'est un chemin d'**affectation de masse** : recopier les
clés reçues laisserait un employé écrire son propre matricule ou son statut.

Le jsonb est donc **revalidé** au moment de l'application — il a transité par le
disque, rien ne garantit qu'il porte encore la forme attendue — et l'`UPDATE`
n'est construit qu'à partir de la liste blanche, jamais par recopie. Un test
dédié corrompt volontairement la demande en base et vérifie que le nom de
l'agent ne bouge pas.

## Ce qui reste ouvert

- La RH voit les valeurs **au moment de la demande**. Si elle modifie le champ
  entre-temps et confirme ensuite, sa propre saisie est écrasée sans avertir.
  L'affichage « avant → après » le rend visible, mais rien ne le bloque.
- Aucune pièce justificative n'est demandée pour un changement d'état civil.
  La RH peut refuser avec motif (« passez présenter votre acte de mariage »),
  ce qui suffit tant que le volume reste faible.
