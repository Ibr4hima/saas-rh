# ADR-0199 : La déclaration de mouvement se préremplit du dossier de la personne

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0106](0106-declaration-de-mouvement.md) et [ADR-0197](0197-agent-choisi-fiche-figee.md)

## Contexte

La DCH renseignait la déclaration de mouvement du travailleur champ par
champ (ADR-0106), même pour un agent dont le dossier porte déjà l'état
civil, la famille, l'entrée et le contrat. La fiche commençait par le
mouvement ; la DCH veut d'abord l'état civil. Le certificat de travail fait
déjà la différence entre une personne qui a son dossier dans l'application
et une autre (ADR-0176).

## Décision

**La page demande d'abord si la personne a un dossier dans
l'application.** Oui : la DCH choisit l'agent parmi les dossiers sous CDI
ou CDD, inactifs compris, puisqu'un départ se déclare aussi. Ce que le
dossier porte se préremplit, grisé, et ne se corrige pas, comme sur les
fiches de l'ADR-0197 ; le reste se saisit. Non : la DCH renseigne une
déclaration vierge, comme avant.

**Ce que le dossier donne** : la civilité, le prénom, le nom, la date, le
lieu et le pays de naissance, la nationalité, la filiation, l'adresse, la
ville comme lieu de résidence habituel, la CNI et sa date de délivrance, la
situation de famille, les épouses d'un homme marié, le nombre d'enfants à
charge, l'entrée dans l'établissement, le poste en cours comme emploi, la
catégorie, et le contrat qui fait foi s'il est un CDI ou un CDD, avec les
dates d'un CDD. Le numéro de la CNI, celui de l'IPRES et le salaire de base
ne se reprennent qu'avec l'accès aux données sensibles (ADR-0158). Une
valeur que la déclaration refuserait, une CNI échue par exemple, reste à
saisir, comme une entrée dont le dossier ne connaît que le mois.

**Le serveur reprend ces valeurs** quand la déclaration se génère pour
l'agent choisi : ce que la fiche dit d'autre n'y change rien, et elle
nomme autant d'enfants à charge que le dossier en compte.

**L'état civil vient en premier** dans la fiche, avant le mouvement.

## Conséquences

- `GET /documents/generer/declaration_mouvement/agents/:id/fiche` rend ce
  que le dossier porte ; `POST /documents/generer/declaration_mouvement`
  prend l'agent en paramètre `agent`.
- Le pays de naissance, gardé au dossier par son nom, se retrouve par son
  code.
- Changer de réponse efface ce que le dossier d'un agent avait rempli ;
  changer d'agent repart d'une fiche vide.
