# ADR-0197 : Sur « Générer des documents », l'agent choisi fige ce que son dossier donne

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0174](0174-fiches-depuis-le-dossier.md) et [ADR-0190](0190-demande-figee.md)

## Contexte

Sur « Générer des documents », la domiciliation bancaire et les décisions de
disponibilité et de renouvellement font choisir l'agent : la fiche se
préremplit de son dossier (ADR-0174). Tout s'y corrigeait ensuite, la
civilité, le prénom, le nom, la fonction, le contrat. Au titre d'une
demande, ces champs étaient déjà figés (ADR-0190) ; sans demande, non.

## Décision

**L'agent choisi, ce que son dossier donne est figé et grisé**, comme au
titre d'une demande : civilité, prénom, nom, poste ou fonction ; l'affectation
pour un renouvellement ; le type de contrat et sa date de début pour la
domiciliation. Ce que le dossier ne porte pas reste à saisir.

**La date de la demande se saisit** : sans demande, l'application ne la
connaît pas. La banque, le RIB, le destinataire, le salaire, les dates de la
disponibilité et les sessions du conseil d'administration se renseignent
comme avant.

**Le serveur reprend ces valeurs.** La page lui nomme l'agent choisi
(`?agent=`) ; la fiche reçue est complétée de son dossier avant de produire
le document, comme au titre d'une demande.

## Conséquences

- `ficheReprise` prend la date de la demande en option : avec elle au titre
  d'une demande, sans elle pour l'agent choisi.
- Un appel à l'API sans agent ni demande garde la fiche telle qu'elle est
  saisie : la page, elle, nomme toujours l'agent.
- Un dossier incomplet ou faux se corrige dans « Gestion du personnel ».
