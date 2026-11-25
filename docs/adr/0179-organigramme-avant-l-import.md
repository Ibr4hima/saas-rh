# ADR-0179 : Avant d'importer, l'organigramme final : agents à placer, responsables à désigner

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0159](0159-l-import-lit-le-fichier-de-la-dch.md) et [ADR-0178](0178-services-sous-un-departement.md)

## Contexte

L'import construit l'organigramme à partir des postes du fichier (ADR-0159,
ADR-0178). Il place un agent dans sa direction, ou dans le département que
nomme sa ligne : les membres d'un service restaient dans la direction, à
affecter ensuite fiche par fiche. Une unité qui recevait des agents sans que
le fichier nomme son responsable restait sans tête, et ses agents sans N+1.
La DCH ne voyait l'organigramme obtenu qu'une fois l'import fait.

## Décision

**L'aperçu montre l'organigramme que l'import laisse, et c'est de là qu'on
valide.** « Voir l'organigramme » ouvre l'organigramme tel qu'il sera après
l'import, unités créées et responsables désignés compris. Le bouton
« Importer » se trouve à cette étape.

**Un clic sur une unité liste ses agents.** Pour chaque agent dont l'import
décide l'unité (une fiche qu'il crée, ou une fiche encore sans unité), une
liste propose la direction, ses départements et ses services. L'aperçu se
rejoue en quittant la fiche de l'unité, et le N+1 d'office suit (ADR-0178).
Le responsable d'une unité y reste ; un agent déjà affecté se mute depuis sa
fiche, comme avant.

**Une unité sans responsable qui reçoit des agents de l'import attend sa
désignation.** L'aperçu la liste dans « Unités sans responsable », avec les
agents de sa direction qui peuvent la diriger, et « Non désigné ». Tant
qu'une unité attend sa réponse, l'organigramme ne s'ouvre pas et l'import ne
se fait pas. La personne retenue se désigne avec les règles et les cascades
de l'organigramme ; une fiche créée par l'import prend la tête depuis son
entrée, comme pour une désignation que le poste fait.

## Conséquences

- `POST /employees/import` reçoit `placements` (par unité, les lignes du
  fichier qu'on y affecte) et `responsables` (par unité, la personne
  retenue), et rend l'organigramme final, ses agents et les unités sans
  responsable. La clé d'une unité reste la même d'un aperçu à l'autre, même
  pour une unité que l'import crée.
- Un agent ne se place que dans sa direction : un placement hors de sa
  direction est ignoré.
- Un réimport qui ne place aucun nouvel agent ne pose aucune question de
  responsable.
