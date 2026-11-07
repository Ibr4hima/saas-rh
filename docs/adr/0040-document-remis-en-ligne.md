# ADR-0040 : Le document demandé peut se remettre en ligne

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0012](0012-arbitrages-direction-capital-humain.md) (décision 2)

## Contexte

Un document demandé ne se remettait qu'en main propre : la DCH indiquait
auprès de qui le retirer (ADR-0012, décision 2). En télétravail, en mission
ou en déplacement, personne ne pouvait passer le chercher.

## Décision

**Qui traite la demande choisit la remise** en la mettant à disposition :
en main propre, comme avant, ou en ligne. En ligne, le document signé et
cacheté, numérisé, se dépose dans la demande : PDF, JPEG ou PNG, 5 Mo au
plus par fichier, douze fichiers au plus. L'original peut rester à
retirer ; on dit alors auprès de qui.

**L'application ne dépose rien d'elle-même.** L'attestation qu'elle produit
sort sans cachet ni signature : elle reste à imprimer et à signer
(ADR-0012). Ce qui part en ligne est ce que la DCH a signé.

**Le dépôt part aussitôt au serveur** (table `document_request_files`,
migration 0099) : chiffré au repos comme les pièces des agents (ADR-0023),
nom de fichier compris, audité sans son contenu. Rien ne se perd si la
fenêtre se ferme. Le document n'apparaît dans l'espace personnel qu'une
fois la demande prête : un avis l'annonce (« Votre attestation de travail
est déposée dans votre espace »), et le suivi des demandes, où elle se lit
« Disponible », permet de le télécharger.

**Côté DCH, le document se règle par type.** Le dépôt, le retrait et le
téléchargement reviennent à qui traite ce type de document : la personne
qui dirige la DCH, le membre habilité, ou la personne à qui la demande est
confiée ; jamais sur sa propre demande. Un bulletin de salaire ne s'ouvre
pas à qui traite seulement les attestations. La liste dit à l'écran ce que
le serveur accepte (`canHandleFiles`).

**Une demande prête se corrige.** Un document s'y ajoute, et un nouvel avis
part ; un mauvais fichier s'en retire. Remise en ligne sans retrait, elle
garde au moins un document : on dépose d'abord le bon. Prête à retirer,
elle peut encore se déposer en ligne, pour qui ne peut pas passer.

**Rien ne reste d'une demande refusée ou annulée** : ses fichiers sont
effacés. Remise en main propre, un fichier déposé puis laissé de côté est
effacé à la validation. L'effacement définitif d'un dossier emporte les
fichiers de ses demandes.

## Conséquences

- La décision 2 de l'ADR-0012 est précisée, pas remplacée : aucun document
  produit par l'application ne se télécharge depuis l'espace personnel ;
  seul y arrive le document signé que la DCH dépose.
- Un bulletin de salaire déposé est une donnée de rémunération conservée
  dans l'application, ce que la décision 1 de l'ADR-0012 évitait. Il n'y
  entre qu'à la demande de l'agent, en fichier opaque, chiffré, lisible par
  l'agent et par qui traite les bulletins. Aucune durée de conservation
  n'est encore fixée : elle se décide avec la DCH.
- Les fichiers voyagent en base64 dans du JSON, avec une limite de corps
  propre à la route, comme les autres pièces.
