# ADR-0096 : La fiche du contrat de stage : tout obligatoire, capitales initiales, CNI groupée

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0094](0094-contrat-de-stage.md)

## Contexte

La DCH a revu la fiche du contrat de stage (ADR-0094) : la mère s'y saisissait
en un champ, « Prénom et nom de la mère » ; l'adresse, la formation suivie et
le poste pouvaient rester vides et s'imprimer en pointillés ; un prénom saisi
en minuscules s'imprimait tel quel ; le numéro de la CNI s'écrivait d'un bloc.

## Décision

**Tout est obligatoire**, l'adresse, la formation suivie et le poste compris :
chaque case porte l'astérisque, et l'aperçu attend la fiche complète. Les
pointillés ne restent que pour la place vacante à la tête de la DCH.

**La mère se saisit en deux champs**, « Prénom de la mère » et « Nom de la
mère » ; le contrat les imprime à la suite : « Fille de Mamadou et de Fatou
Diop ». La filiation s'élide devant une voyelle (ADR-0095) : « Fils d'El
Hadji et d'Aminata Ba » ; le y suivi d'une voyelle reste une consonne : « de
Youssou ».

**Les prénoms et les noms prennent leurs capitales initiales** (la personne,
le père, la mère) : la première lettre de chaque mot, au début ou après une
espace, un trait d'union ou une apostrophe, passe en capitale à la frappe, le
reste tel que saisi. « mouhamadou moustapha lamine » donne « Mouhamadou
Moustapha Lamine », « dos santos » « Dos Santos », « n'diaye » « N'Diaye ».
Le schéma de la fiche applique la même règle (`majusculesInitiales`) : l'API
imprime les capitales même pour une fiche saisie sans elles. Le nom de la
personne reste en capitales dans le contrat : « DOS SANTOS ».

**Le numéro de la CNI se groupe comme sur la carte** : 1, 3, 4 puis 5
chiffres, « 1 234 0000 12345 », à la frappe (`cniGroupee`). La fiche porte
les treize chiffres seuls ; le contrat imprime le numéro groupé, sans le
couper en fin de ligne.

## Conséquences

- La saisie de chiffres groupés est commune à la page : le montant et la CNI
  s'écrivent groupés dès la touche frappée, le curseur à sa place parmi les
  chiffres.
- Une fiche de l'ancienne forme (`mere`, champs facultatifs absents) est
  refusée par l'API ; aucune n'a été enregistrée.
