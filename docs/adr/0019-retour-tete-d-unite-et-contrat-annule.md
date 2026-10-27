# ADR-0019 : Retour à la tête de son unité, contrat à venir annulable

**Statut** : acceptée · 2026-10-06

## Contexte

ADR-0018 laissait deux limites. Un responsable d'unité qui passait par une
interruption entre deux contrats perdait sa tête d'unité, et il fallait le
renommer dans l'organigramme à son retour ; son équipe restait chez celui
qui l'avait reprise. Un contrat à venir saisi par erreur ne s'annulait pas :
on pouvait seulement en corriger les dates ou le type.

## Décision

**Ce qu'un départ a défait et que personne n'a refait se refait au
retour.** La fin de contrat note dans le départ les unités qu'il dirigeait
et où chacun de son équipe est allé (`headed_unit_ids`,
`team_reassignments`). À son retour (nouveau contrat, contrat à venir le
jour venu, « Réactiver »), il retrouve la tête de chaque unité restée sans
responsable, s'il travaille dans son périmètre, avec ce que la règle impose
à un directeur ou au directeur général. Les membres de son équipe encore
rattachés là où son départ les avait mis reviennent sous lui. Un successeur
nommé entre-temps garde l'unité, et l'équipe avec.

**Un contrat qui n'a pas commencé s'annule.** Seul le dernier, et avant son
premier jour. Le contrat en cours, qu'il arrêtait la veille de son début,
retrouve sa fin d'origine, gardée sur le contrat annulé
(`previous_end_replaced`, `previous_end_date`). Les délégations qui
attendaient un membre de la DCH revenant par ce contrat sont retirées.
Commencé, un contrat se corrige, ou l'agent part.

## Conséquences

- Le retour ne se fait que pour les départs enregistrés à partir de la
  migration 0086 ; les départs plus anciens n'ont rien noté.
- Les contrats à venir enregistrés avant la migration 0086 s'annulent,
  mais sans rendre au contrat en cours une fin qui n'a pas été gardée.
