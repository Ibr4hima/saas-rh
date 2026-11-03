# ADR-0168 : Générer des documents : les champs par lignes pleines, la prime de transport préremplie

**Statut** : acceptée · 2026-11-03 · précise l'[ADR-0094](0094-contrat-de-stage.md), l'[ADR-0098](0098-contrats-de-travail.md), l'[ADR-0100](0100-decisions-de-disponibilite.md), l'[ADR-0102](0102-domiciliation-bancaire.md), l'[ADR-0121](0121-preremplissage-valide.md) et l'[ADR-0134](0134-delivrance-de-la-cni.md)

## Contexte

Les fiches de « Générer des documents » rangeaient leurs champs sur deux
colonnes, chacune d'une demi-largeur de bloc : plus de 500 pixels pour une
civilité, une date ou une catégorie. Une section finissait souvent sur un
champ seul, le reste de la ligne vide : le treizième mois, la date limite
de reprise, l'agent d'une attestation. Dans les contrats, la civilité était
suivie du numéro de la CNI, et la CNI séparée de sa délivrance. L'APIX
demande des fiches rangées, ni entassées ni trop vastes : trois champs par
ligne, aucun champ isolé, le prénom et le nom juste après la civilité, la
CNI avec sa date et son lieu de délivrance, et la prime de transport
préremplie à 26 000 FCFA, modifiable.

## Décision

**Trois champs par ligne** quand le bloc est assez large : à 1 440 pixels,
un champ mesure 350 pixels. Quatre quand une section tient en quatre champs
courts : la rémunération d'un contrat de travail, le statut militaire d'une
déclaration de mouvement, l'agent et les trois dates de la reprise après
disponibilité. Deux sur une tablette, un sur un téléphone. La largeur se
mesure au bloc, pas à l'écran : le menu en prend sa part. Une adresse, une
affectation, un nom d'employeur prennent deux colonnes ; une disposition
particulière, une phrase de 300 caractères, la ligne entière.

**Chaque ligne a un sujet, et aucun champ n'y reste seul.**

- Contrats de travail : la civilité, le prénom, le nom ; la date et le lieu
  de naissance, la nationalité ; le numéro de la CNI, sa date et son lieu de
  délivrance ; l'adresse. Puis le poste et l'affectation ; la catégorie, la
  date de début et, pour un CDD, la durée. Puis les quatre montants sur une
  ligne : salaire de base, sursalaire, prime de transport, treizième mois.
- Contrat de stage : la civilité, le prénom, le nom ; la date et le lieu de
  naissance, l'adresse ; le numéro de la CNI et sa date de délivrance, le
  contrat n'imprimant pas de lieu de délivrance ; le prénom du père, le
  prénom et le nom de la mère. Puis la formation, le poste, la catégorie ;
  la date de début, la durée, l'allocation.
- Domiciliation bancaire : la banque, son destinataire et la date de la
  demande ; le RIB, sa confirmation et le salaire mensuel net.
- Renouvellement de disponibilité : la demande tient le poste et
  l'affectation sur une ligne, et sa date ouvre la section de la
  disponibilité, avant la période initiale. La mise en disponibilité garde
  la date de la demande à côté du poste.
- Déclaration de mouvement : l'ordre du formulaire imprimé, à deux
  exceptions près. L'adresse suit la nationalité ; l'emploi commence par la
  profession, l'emploi et la catégorie, puis les dates et le type de
  contrat. Chaque numéro de déclaration ou de visa garde sa date sur sa
  ligne. Le statut militaire tient en une ligne de quatre : la classe,
  l'armée et le grade restent grisés tant que le service n'est pas dit
  effectué, et se vident si la réponse redevient « Non ». Dans une liste qui
  s'allonge, les épouses puis les enfants, un dernier champ seul sur sa
  ligne en prend deux.
- Documents d'un agent : l'agent et ce que le document demande se saisissent
  sur la même ligne (« Agent », « Premier jour du congé », « Dernier jour du
  congé »), sous l'intitulé de la saisie. Les saisies restent grisées
  jusqu'au choix de l'agent, puis la première prend le curseur. Un document
  qui ne demande que l'agent le fait choisir comme le document au-dessus :
  l'intitulé à gauche, le champ à droite ; le stage à choisir de même.

**Les saisies d'une ligne restent alignées.** Chaque champ partage trois
rangées avec ses voisins de ligne, l'intitulé, la saisie et le message
(`subgrid`) : un intitulé sur deux lignes, un message d'erreur sous un
champ ne décalent pas la saisie d'à côté.

**La prime de transport s'ouvre à 26 000 FCFA** dans les contrats à durée
déterminée et indéterminée, le seul endroit de la génération où elle se
saisit. La DCH la corrige au besoin ; vidée, elle se ressaisit avant
« Valider ». Le salaire brut affiché en tient compte dès que le salaire de
base et le sursalaire sont saisis.

## Conséquences

- `Groupe` (`saisie-de-fiche.tsx`) prend `colonnes`, trois ou quatre ;
  `SUR_DEUX_COLONNES`, `PLEINE_LIGNE`, `EN_DEBUT_DE_LIGNE` et
  `ALLONGE_EN_FIN_DE_LISTE` placent un champ ; `Choix` pose une section
  d'un seul choix. `Field` (`@teranga/ui`) accepte une `className` pour sa
  place dans la grille.
- « Changements », dans la déclaration de mouvement, devient un groupe
  (`role="group"`) plutôt qu'un `fieldset` : sa légende se range dans la
  rangée des intitulés, comme celle de « Mouvement » à côté.
- Rien ne change dans les documents produits ni dans l'API : les schémas
  des fiches restent les mêmes.
- Les ordres de champs de l'ADR-0094, de l'ADR-0098, de l'ADR-0100, de
  l'ADR-0102 et de l'ADR-0134 laissent la place à ceux-ci. L'ADR-0121 garde
  son bloc unique ; l'agent y rejoint ses saisies.
