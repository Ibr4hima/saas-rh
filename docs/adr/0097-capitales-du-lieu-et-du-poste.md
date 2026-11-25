# ADR-0097 : Lieu de naissance et adresse en capitales initiales, formation et poste à l'initiale

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0096](0096-fiche-du-contrat-de-stage.md)

## Contexte

Dans la fiche du contrat de stage, les prénoms et les noms prennent une
capitale à chaque mot (ADR-0096). Le lieu de naissance, l'adresse, la
formation suivie et le poste s'imprimaient tels que saisis : « à pikine »,
« en qualité d'assistante archiviste ». La DCH demande les capitales pour
eux aussi.

## Décision

**Le lieu de naissance et l'adresse prennent une capitale à chaque mot**,
comme les prénoms et les noms (`majusculesInitiales`) : « pikine - dakar »
donne « Pikine - Dakar », « parcelles assainies, unité 15 - dakar »
« Parcelles Assainies, Unité 15 - Dakar ». Un mot commence aussi après une
virgule ou une parenthèse, même sans espace : « Unité 15,Villa 12 (Dakar) ».

**La formation suivie et le poste prennent une capitale à leur première
lettre seulement** (`premiereMajuscule`) : « assistante archiviste » donne
« Assistante archiviste », « licence en science de l'information
documentaire » « Licence en science de l'information documentaire ».

Dans les deux cas, les autres lettres restent telles que saisies, la
capitale se pose à la frappe sans que le curseur bouge, et le schéma de la
fiche applique la même règle : l'API imprime les capitales même pour une
fiche saisie sans elles.

## Conséquences

- Sur un téléphone, le clavier propose la capitale de lui-même : à chaque
  mot pour le lieu et l'adresse, en début de phrase pour la formation et le
  poste.
