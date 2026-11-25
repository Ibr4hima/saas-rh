# ADR-0198 : La déclaration de mouvement du travailleur, la DCH la produit : elle ne se demande pas

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0106](0106-declaration-de-mouvement.md) et [ADR-0114](0114-contrats-etablis-par-la-dch.md)

## Contexte

« Demander un document » proposait la déclaration de mouvement du
travailleur à tout agent sous CDI ou CDD (ADR-0137). Or un agent ne la
demande pas : la DCH la produit quand il le faut, pour déclarer une
embauche, un départ ou un changement de situation. L'ADR-0114 a posé la
règle des documents que la DCH établit d'elle-même, en commençant par les
contrats : ils ne se demandent pas, leur génération se délègue.

## Décision

**La déclaration de mouvement rejoint les contrats.** « Demander un
document » ne la propose plus, et l'API la refuse à la création. Elle reste
dans « Générer des documents ».

**Sa génération se délègue** comme celle d'un contrat : l'habilitation
`generation.declaration_mouvement`, dans la tâche « Génération de
documents » de « Déléguer des tâches ». Qui dirige la DCH la génère
toujours.

## Conséquences

- Les demandes faites avant restent lisibles et se traitent comme avant ;
  leurs délégations de traitement se closent (migration 0134), et une
  demande encore ouverte revient à qui dirige la DCH.
- L'habilitation de traitement `demandes.documents.declaration_mouvement`
  reste au catalogue pour ces demandes anciennes ; « Déléguer des tâches »
  ne la propose plus parmi les demandes de documents.
- Un agent demande désormais douze documents au plus.
