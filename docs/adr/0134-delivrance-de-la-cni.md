# ADR-0134 : La délivrance de la CNI dans chaque fiche ; le renouvellement demandé sans date limite

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0096](0096-fiche-du-contrat-de-stage.md), l'[ADR-0106](0106-declaration-de-mouvement.md) et l'[ADR-0133](0133-dates-des-fiches.md)

## Contexte

L'ADR-0133 veut la CNI à jour dans les contrats à durée indéterminée et
déterminée, les seules fiches qui en portaient la date de délivrance. Le
contrat de stage et la déclaration de mouvement du travailleur saisissent
aussi le numéro de la carte, sans date : rien n'y dit qu'elle est à jour.
L'APIX demande la date partout où une CNI se renseigne, même là où le
document ne l'écrit pas : elle sert à vérifier que la carte est à jour.

L'ADR-0133 bornait aussi la demande de renouvellement d'une disponibilité
au lendemain de la période initiale. L'APIX ne retient pas cette borne.

## Décision

**Une CNI vaut dix ans** : délivrée le 10 octobre 2019, elle expire le
9 octobre 2029. Sa date d'expiration ne se saisit pas : elle se déduit de
la délivrance.

**Toute fiche qui porte une CNI en demande la date de délivrance**,
obligatoire, et la veut à jour : délivrée il y a moins de dix ans, pas
dans l'avenir.

- Contrat de stage : « Date de délivrance de la CNI », après le lieu de
  naissance, comme aux contrats de travail. Le contrat ne l'écrit pas.
- Déclaration de mouvement du travailleur : « Date de délivrance », entre
  le numéro de la carte et son lieu de délivrance. Le formulaire ne l'écrit
  pas : il n'a de place que pour le numéro, le lieu et l'autorité.

**Une carte étrangère**, à la déclaration de mouvement, n'a pas la
validité de la CNI sénégalaise : sa date de délivrance se demande aussi,
pas dans l'avenir, après la naissance.

**Le renouvellement d'une disponibilité** garde ses autres règles ; sa
demande n'a plus que la borne de son champ : pas après aujourd'hui.

## Conséquences

- Les règles vivent au contrat, comme celles de l'ADR-0133 : celle du
  contrat de stage dans le schéma de son champ ; celle de la déclaration,
  qui dépend de la nationalité, dans la fonction de ses dates croisées, que
  l'écran appelle aussi.
- Une fiche de contrat de stage ou de déclaration sans date de délivrance
  est refusée (`validation_failed`).
- Le dossier de l'agent n'est pas touché : sa pièce d'identité garde une
  date de délivrance et une date d'expiration, saisies.
