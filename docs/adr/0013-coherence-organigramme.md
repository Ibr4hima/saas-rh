# ADR-0013 — Règles de cohérence de l'organigramme

**Statut** : acceptée · 2026-08-21

## Contexte

L'organigramme acceptait des états que personne n'aurait défendus à l'oral.
Vérifié sur la base de démonstration, avant correction :

- un même employé pouvait être responsable de plusieurs unités à la fois ;
- une direction pouvait être rattachée sous un service ;
- un responsable muté ailleurs continuait de diriger son ancienne équipe ;
- un employé au dossier clos pouvait rester responsable ;
- deux unités sœurs pouvaient porter le même nom ;
- une unité, une fois créée, ne pouvait plus être ni renommée ni dissoute.

Un organigramme qui ment est pire qu'un organigramme absent : il sert à savoir
à qui s'adresser.

## Décision 1 — Un employé ne dirige qu'une unité

Index unique partiel `(tenant_id, manager_employee_id)` sur les unités
vivantes. La contrainte est en base, pas seulement dans le code : c'est le
dernier mot. Dissoudre une unité libère son responsable.

## Décision 2 — La hiérarchie des types est fixe

`direction > département > service`. Une direction est toujours racine ; un
département relève d'une direction ; un service d'un département ou
directement d'une direction. La règle est tenue côté applicatif — elle demande
de remonter l'arbre — et le formulaire ne propose que des parents valables,
plutôt que de laisser composer un état que le serveur refusera.

Changer le type d'une unité est refusé si ses unités rattachées deviendraient
illégitimes ; le message nomme lesquelles.

## Décision 3 — Un responsable travaille dans l'unité qu'il dirige

Il doit être affecté à cette unité **ou à une unité qui en dépend** (un chef de
département peut être affecté à l'un de ses services), et son dossier doit être
actif.

Conséquence assumée : muter un responsable hors de son unité est **refusé** tant
qu'un successeur n'est pas désigné. Retirer le responsable en douce laisserait
une unité décapitée sans que personne ne l'ait décidé ; la RH tranche.

## Décision 3 bis — L'invariant se vérifie APRÈS écriture

La règle du responsable porte sur le couple (affectation, unité). La tenir au
seul moment où l'on mute l'employé laissait deux portes ouvertes, toutes deux
reproduites en revue : **dissoudre** son unité vers une autre direction, ou
**re-rattacher** cette unité ailleurs. Ni l'une ni l'autre ne passe par le
chemin « employé ».

Le contrôle a donc été déplacé : on écrit, on relit l'état réel, et la
transaction est annulée si l'invariant est rompu. Vérifier avant l'écriture
obligeait à simuler l'arbre futur — et c'est précisément cette simulation qui
laissait passer le re-rattachement, puisqu'elle lisait encore l'ancien arbre.

Le même invariant vaut à la **clôture d'un dossier** : suspendre ou clore un
responsable est refusé tant qu'un successeur n'est pas désigné.

## Décision 4 — Une unité se modifie et se dissout

Nom, type, rattachement et abrégé sont modifiables. La dissolution est un
**effacement doux** : l'unité quitte l'organigramme, mais l'historique des
affectations continue de la mentionner (« était au Service X, dissous depuis »).

Deux garde-fous :

- une unité qui en contient d'autres n'est pas dissoute tant que celles-ci ne
  sont pas rattachées ailleurs — décision par décision, jamais en cascade ;
- une offre de recrutement ouverte l'empêche aussi : la page publique de
  candidature annoncerait une direction disparue ;
- **toutes** les affectations non terminées doivent être réaffectées à une
  unité désignée, y compris celles d'employés suspendus ou clos et celles qui
  démarrent plus tard. Ne traiter que les affectations « courantes d'employés
  actifs » abandonnait les autres sur une unité fantôme.

La réaffectation **clôt** l'affectation en cours à la date du jour et en ouvre
une nouvelle sur l'unité d'accueil, comme une mutation ordinaire. Réécrire le
rattachement de la ligne existante ferait dire au dossier que l'agent était
dans l'unité d'accueil depuis son arrivée : l'historique mentirait. Les
affectations qui n'ont pas encore commencé sont simplement redirigées.

## Décision 5 — Abrégé des directions

Une direction porte un abrégé facultatif (« DCH »), unique par organisation et
insensible à la casse. Réservé aux directions : un département ou un service se
désigne par son nom complet. Déclasser une direction efface son abrégé.

## Ce qui était déjà garanti

Un employé ne peut pas appartenir à deux directions simultanément : la
contrainte d'exclusion `assignments_no_overlap` interdit deux affectations qui
se chevauchent, et une mutation ferme la précédente. Aucune règle
supplémentaire n'était nécessaire.

## Portée de l'abrégé

L'abrégé est un **repère d'organigramme**. Il n'est pas propagé aux documents
officiels (attestation) ni aux offres publiques, qui portent le nom complet :
un sigle n'a pas de valeur juridique et ne parle pas à un lecteur externe.

## Ce qui reste ouvert

- Un employé sans affectation (embauche sans unité) n'est rattaché à rien :
  toléré, car le dossier précède parfois l'affectation.
- Re-rattacher une unité déplace implicitement la direction de tous ses
  membres. C'est le comportement attendu d'une réorganisation, mais aucune
  trace n'en est gardée côté employé.
