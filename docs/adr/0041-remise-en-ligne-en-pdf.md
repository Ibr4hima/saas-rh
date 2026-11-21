# ADR-0041 : Remise en ligne : un PDF, un nom choisi, un aperçu

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0040](0040-document-remis-en-ligne.md)

## Contexte

Premiers essais de la remise en ligne (ADR-0040) par la DCH : les scans
arrivaient sous des noms de classement (« attestation-travail-A12345678.pdf »),
vérifier un fichier obligeait à le télécharger, et le choix de la remise,
posé dans l'en-tête de la fenêtre, se voyait mal.

## Décision

**Un PDF seulement.** Le document signé et cacheté se numérise en PDF ;
l'agent reçoit toujours le même format. Le serveur vérifie la signature du
fichier, et la contrainte de la base (migration 0100) refuse tout nouveau
dépôt d'un autre type, sans toucher aux fichiers déjà déposés.

**Le nom se corrige après dépôt**
(`PATCH /document-requests/:id/fichiers/:fichierId`) : c'est celui que
l'agent voit et enregistre. Seul le nom change (le droit de mise à jour se
limite à cette colonne), chiffré comme au dépôt ; l'extension `.pdf` revient
si elle manque. Mêmes règles d'accès que le dépôt.

**Un clic ouvre le document** dans la fenêtre d'aperçu de l'application,
par-dessus la mise à disposition : on vérifie ce qui part sans rien
télécharger.

**La fenêtre de mise à disposition se lit de haut en bas** : la demande
(qui, son matricule, quoi), la remise (en main propre ou en ligne), puis le
point de retrait ou le document à déposer.

**En ligne, rien d'autre à dire** : ni original à retirer, ni précision.
Pour un original à retirer, la remise est en main propre. Une demande déjà
prête à retirer peut toujours recevoir un document en ligne (ADR-0040) :
l'avis dit alors que l'original attend au point de retrait.

## Conséquences

- L'ADR-0040 est précisée : PDF seul, nom modifiable, et plus de point de
  retrait saisi pendant une remise en ligne.
- Les fichiers déjà déposés en image restent lisibles : la contrainte ne
  porte que sur les nouveaux dépôts (`NOT VALID`).
