# ADR-0016 : Compte d'un agent parti, mot de passe effacé après trente jours, retour par invitation sur le même compte

**Statut** : acceptée · 2026-10-06

## Contexte

Un agent qui part (fin de contrat, démission, licenciement, décès) garde
un portail restreint pour récupérer ses documents. Ce délai était d'un mois
calendaire ; la DCH le veut de trente jours.

Rien ne disait ce que devient son compte ensuite. Il gardait son mot de
passe pour toujours, et s'il revenait, même des années après, il se
reconnectait avec. Une invitation lui était refusée (« déjà un accès »).

Le cas voisin (point 83) : une personne qui a déjà un compte en service,
comme celle qui a ouvert l'organisation, est invitée à la même adresse.
La page lui demandait de choisir un mot de passe, et le serveur refusait.

## Décision

**Trente jours, puis le mot de passe s'efface.** Le portail reste ouvert,
restreint, trente jours après le dernier jour (le jour même pour un
licenciement ou un décès). Au-delà de trente jours, quel que soit le
motif, `users.password_hash` passe à `NULL` et ses sessions se ferment.
Un compte sans mot de passe ne se connecte pas et ne se distingue pas
d'un compte inconnu. Le passage se fait avec la relève des contrats échus
(aucune tâche ne tourne la nuit) et, au plus tard, à la réouverture du
dossier.

**Le compte reste, avec tout ce qu'il porte.** Pas de nouveau compte au
retour : la personne, son dossier et son compte restent liés. L'invitation
lui fait choisir un mot de passe neuf, comme à un nouveau venu, sous la même
règle ; l'adresse de l'invitation devient celle du compte. Il retrouve ses
demandes, ses notifications, ses certificats, sans limite de durée.

**Un compte fermé ne retient pas son adresse.** Une adresse professionnelle
se redonne, parfois des années après. Si l'invitation d'une autre personne
la demande, le compte fermé la rend (`ancien+<id>@compte.invalide`) ; à son
retour, son invitation lui en donne une.

**Un compte en service se relie avec son mot de passe.** Si l'adresse de
l'invitation porte un compte qui a encore son mot de passe, la page demande
ce mot de passe, sans règle ni confirmation (preuve de possession, comme
avant). L'invitation dit à la page lequel des trois cas elle accueille.

**Plusieurs organisations.** Le mot de passe vaut pour toutes : il ne
s'efface pas si le compte sert aussi ailleurs. La fonction
`compte_d_une_autre_organisation()` (SECURITY DEFINER) répond oui ou non
sans exposer les appartenances des autres organisations.

## Conséquences

- La fiche dit « Compte fermé » et propose d'envoyer l'invitation dès que
  le dossier est rouvert.
- Un accès coupé se rétablit avant l'invitation.
- Le rôle du compte dans l'organisation ne change pas au retour : un
  administrateur qui revient l'est encore.
- La réinitialisation du mot de passe (ADR-0009) n'est pas concernée : un
  compte fermé ne la déclenche pas, il revient par invitation.
