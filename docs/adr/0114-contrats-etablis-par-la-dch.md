# ADR-0114 : Les contrats, la DCH les établit : ils ne se demandent pas, leur génération se délègue

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0084](0084-documents-de-la-dch.md) et l'[ADR-0085](0085-generer-des-documents.md)

## Contexte

Tout document de la liste de la DCH se demandait (ADR-0084), les contrats
compris. Or un agent ne demande pas son contrat : la DCH l'établit, selon
la situation de la personne. Et seule la personne qui dirige la DCH
générait les documents (ADR-0085) ; la DCH veut confier la génération des
contrats à des membres de sa direction, contrat par contrat. D'autres
documents sont dans le même cas ; l'APIX commence par les contrats.

## Décision

**Les contrats ne se demandent plus** : le contrat à durée déterminée, le
contrat à durée indéterminée et le contrat de stage. « Demander un
document » ne les propose plus, et l'API les refuse à la création. Les
demandes faites avant restent lisibles et se traitent comme avant ; leurs
délégations de traitement se closent (migration 0116), et une demande
encore ouverte revient à qui dirige la DCH. Les contrats restent dans la
liste de la DCH, et dans « Générer des documents ».

**Leur génération se délègue, contrat par contrat** : une habilitation par
contrat, `generation.contrat_cdd`, `generation.contrat_cdi`,
`generation.contrat_stage`. Dans « Déléguer des tâches », la section
« Documents » porte la tâche « Génération de documents » : pour chaque
contrat, la liste des membres de la DCH à qui la confier.

**Qui en détient une a « Générer des documents »** dans son espace de
gestion, pour ces contrats-là seulement : la liste ne montre qu'eux, et
l'API refuse tout autre document. Qui dirige la DCH génère toujours tout. Le
rôle d'administrateur ne donne pas ces habilitations : le compte technique
ne produit pas d'actes.

## Conséquences

- Les habilitations de traitement des demandes de contrats restent au
  catalogue pour les demandes anciennes ; « Déléguer des tâches » ne les
  propose plus parmi les demandes de documents.
- La liste de « Demander un document » perd la famille « Documents
  contractuels ».
- Un membre qui n'a que la génération arrive, en « Gestion RH », sur
  « Générer des documents ».
- Un autre document que la DCH établit d'elle-même rejoindra cette règle :
  il ne se demandera plus, et sa génération se déléguera de même.
