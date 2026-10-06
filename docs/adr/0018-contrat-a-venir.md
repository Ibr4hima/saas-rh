# ADR-0018 : Contrat à venir, hors contrat entre deux contrats, équipe qui remonte

**Statut** : acceptée · 2026-10-06

## Contexte

Un nouveau contrat qui commençait plus tard réactivait le dossier dès son
enregistrement, et changeait la place de l'agent tout de suite. Le
contrat qui faisait foi était le dernier enregistré : un agent dont le CDD
finissait le 6 octobre et dont le suivant commençait le 15 restait en
activité entre les deux, avec tout son portail, et son espace RH s'il
était de la DCH.

Un nouveau contrat qui envoyait un responsable dans une autre direction
était refusé : il fallait passer par une mutation qui désigne un repreneur.

La gestion des accès affichait la dernière connexion, les dates d'envoi et
d'expiration des invitations, et les adresses personnelles ; l'invitation
partait à l'adresse personnelle faute d'adresse professionnelle.

## Décision

**Ce qui fait foi, c'est d'être sous contrat aujourd'hui.** Entre la fin
d'un contrat et le début du suivant, l'agent est hors contrat : son
dossier passe dans les inactifs comme à une fin de contrat (ADR-0016),
son portail est restreint (ses documents seulement, pas d'espace RH), et
le délai de trente jours court depuis son dernier jour.

**Un contrat à venir garde sa place, et l'applique le jour venu.** Le
poste et l'unité d'un contrat qui n'a pas commencé s'enregistrent sur le
contrat (`planned_position_title`, `planned_org_unit_id`). Rien ne bouge
avant son premier jour. Ce jour-là, le passage qui range les contrats
échus applique la place : le dossier se réactive à cette place, ou
l'agent qui enchaîne sans interruption change de place. Parti depuis plus
de trente jours, il reçoit d'office son invitation, envoyée par la
plateforme (`invited_by_user_id` nul). « Réactiver » est refusé avant ce
jour. La fiche montre le contrat « À venir » et sa place.

**Ses délégations l'attendent.** Un membre de la DCH entre deux contrats
garde ses habilitations si le contrat suivant le ramène à la DCH : il
n'en a pas l'usage pendant l'interruption, il les retrouve le jour venu.

**Une autre direction par un nouveau contrat, c'est un départ.** Plus de
refus : les unités qu'il dirigeait perdent leur responsable (le contrôle
de la chaîne les signale), son équipe remonte à son propre n+1, sinon au
responsable de sa direction, comme à une fin de contrat ; il relève du
responsable de sa nouvelle direction. Le directeur général reste à la
Direction Générale. La mutation depuis la fiche garde ses règles : elle
demande qui reprend l'unité et l'équipe.

**Un départ enregistré avant le début du contrat suivant l'annule.** Un
contrat qui devait commencer après le dernier jour n'aura pas lieu : il
est retiré.

**Le portail s'ouvre avec l'adresse professionnelle.** L'invitation n'y
part qu'à elle ; sans adresse professionnelle, elle ne part pas. La
gestion des accès ne montre que cette adresse et l'état de chacun.

## Conséquences

- Un responsable d'unité qui passe par une interruption perd sa tête
  d'unité ; à son retour, elle se redonne dans l'organigramme.
- La place s'applique au premier passage du jour, déclenché par
  l'activité sur la plateforme (aucune tâche ne tourne la nuit) : quelques
  minutes après minuit au plus tôt, à la première ouverture au plus tard.
- Les contrats déjà enregistrés qui n'avaient pas commencé reçoivent la
  place de la dernière affectation de l'agent (migration 0085).
