# ADR-0201 : La pièce d'identité d'un dossier est la CNI, et seulement elle

**Statut** : acceptée · 2026-11-08 · précise les [ADR-0134](0134-delivrance-de-la-cni.md) et [ADR-0158](0158-la-fiche-recoit-le-fichier-de-la-dch.md)

## Contexte

La fiche d'un agent proposait deux pièces d'identité, la carte nationale
d'identité et le passeport, à choisir dans une liste ; le numéro et les
dates de la pièce n'apparaissaient qu'une fois le choix fait. L'APIX ne
garde que la CNI.

## Décision

**La pièce d'identité d'un dossier est la CNI.** Dans « Nouvel employé »
et « Modifier la fiche », le champ « Pièce d'identité » affiche « Carte
Nationale d'Identité », grisé : il ne se choisit plus. Le numéro, la date
de délivrance et la date d'expiration s'affichent d'emblée. À la création,
le numéro est obligatoire, comme il l'était une fois la CNI choisie.

**L'API n'enregistre plus de passeport** comme pièce d'un dossier, ni à la
création, ni à la modification.

**Un passeport déposé par l'agent reste un document** : il se vérifie
comme les autres, sans être comparé à la fiche ni la mettre à jour. Seule
une CNI déposée devient, ou renouvelle, la pièce de la fiche.

## Conséquences

- Un passeport enregistré avant se lit encore sur la fiche. Une CNI déposée
  ensuite peut le remplacer, si qui la vérifie le choisit ; saisir un
  numéro dans « Modifier la fiche » le remplace aussi par une CNI.
- Le numéro d'une CNI compte treize chiffres : un agent sans CNI
  sénégalaise n'a plus de pièce à enregistrer.
- « Email personnel » prend toute sa ligne, les champs de la pièce ayant
  décalé la grille.
