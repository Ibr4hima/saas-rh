# ADR-0080 : Le certificat de mariage accompagne le passage à « Marié(e) »

**Statut** : acceptée · 2026-10-15

Précise l'[ADR-0014](0014-corrections-informations-personnelles.md), qui
laissait ouvert le cas des pièces justificatives d'un changement d'état civil.

## Contexte

L'agent signale ses changements depuis son espace (« Signaler un
changement ») ; qui vérifie les mises à jour d'informations pour la DCH, la
personne qui la dirige ou les membres à qui la tâche est déléguée, valide ou
refuse. Pour un mariage, rien ne prouvait le changement : la DCH demandait
l'acte en dehors de la plateforme, et le dossier ne gardait pas la pièce.

## Décision

**Passer à « Marié(e) » se signale avec le certificat de mariage** que
délivre la mairie : un PDF de 5 Mo au plus. La règle vaut pour tout passage
à « Marié(e) », quelle que soit la situation de départ, renseignée ou non.
Sans certificat, le signalement ne part pas ; un certificat joint à un autre
changement est refusé.

**Qui vérifie les mises à jour d'informations s'y fie.** Le certificat
s'ouvre depuis la demande, dans la file « Mise à jour d'infos » et sur la
fiche de l'agent. Le lisent : l'agent qui l'a envoyé, qui traite la file, le
membre de la DCH à qui la demande est confiée tant qu'elle attend, et qui
voit les données sensibles des dossiers.

**Validée, la demande verse le certificat au dossier.** Il rejoint les
pièces de l'agent sous le nom « Certificat de mariage », vérifié par qui a
validé, déposé au nom de l'agent qui l'a envoyé ; la situation matrimoniale
passe à « Marié(e) » dans le même geste. Il ne passe pas par la file
« Vérification des documents » : la décision sur la demande vaut
vérification.

**Refusée ou annulée, la demande emporte le certificat** : il ne reste
nulle part.

## Conséquences

- Une table `profile_change_documents` garde le certificat le temps de la
  décision (migration 0114). Elle est chiffrée au repos comme les pièces des
  dossiers, sous la sécurité par ligne, et le journal d'audit en garde le
  dépôt et le retrait, avec leur auteur, sans le contenu.
- Les pièces du dossier gagnent un type, `certificat_mariage`. Il ne se
  dépose pas seul : il n'entre au dossier que par une demande validée. Versé,
  il suit la règle des pièces validées : seule la gestion du personnel peut
  le retirer.
- La route `POST /v1/profile-changes` accepte un corps à la taille d'un PDF
  de 5 Mo, comme les dépôts de pièces.
- Une demande déjà en attente, envoyée sans certificat avant cette règle, se
  décide comme avant.
- L'effacement définitif d'un agent efface aussi le certificat d'une demande
  en attente, et le journal d'audit l'oublie.
