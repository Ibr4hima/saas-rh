# ADR-0291 : Client web : saisies liées au compte, déconnexion sûre, retour vérifié

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0280](0280-saisie-sans-perte.md)

## Contexte

L'audit du 25 novembre 2026 a relu le client web de la campagne.

- **Une saisie pouvait partir sous un autre compte.** Sur un navigateur
  partagé, la session de l'agent A expire pendant sa saisie ; l'agent B se
  connecte dans un autre onglet ; l'envoi resté en attente partait avec la
  session de B, sur le même chemin : le brouillon de B prenait le texte de
  A.
- **Les copies locales survivaient à la déconnexion**, partie réservée à
  la hiérarchie et commentaires du N+2 compris, et ne s'effaçaient qu'à
  l'ouverture d'une page de saisie.
- **Une session expirée** se relançait en boucle, sous un message de
  réseau.
- **La page de retour après la connexion** (`?suite=`) acceptait
  `/<tabulation>/autre.site`, que le navigateur lit `//autre.site` : une
  porte vers un faux écran de connexion.
- **« Se déconnecter »** ne faisait rien quand l'appel échouait, sans le
  dire.
- **Un serveur qui ne répondait pas** (réseau, redémarrage) renvoyait à la
  connexion une personne dont la session tenait encore ; en campagne, il
  fallait un nouveau code.
- **Le menu du compte** laissait la tabulation parcourir toute la page
  floutée avant d'atteindre « Se déconnecter ».

## Décision

**Une saisie appartient au compte qui a ouvert la page.** Si un autre
compte se connecte dans ce navigateur, plus rien de cette saisie ne part,
ni ne s'écrit sous son nom.

**Une session expirée arrête les envois** : « Votre session a expiré :
reconnectez-vous. » La copie locale reste ; la connexion ramène à la page,
qui la reprend et l'enregistre (ADR-0280).

**Les copies locales** (déplacées dans `lib/copies.ts`) :

- la déconnexion enregistre d'abord ce qui attend (cinq secondes au
  plus), puis efface les copies du compte ; ce qui n'a pas pu partir est
  dit sur l'écran de connexion ;
- dès qu'un compte est connu, les copies des autres comptes s'effacent,
  avec celles de plus de trente jours.

**La page de retour** se lit comme le navigateur la suivrait, avec
`new URL` : seule une adresse du portail est suivie.

**La déconnexion** : une session déjà fermée compte comme une déconnexion
faite ; un échec réseau le dit dans le menu (« Déconnexion impossible pour
l'instant. Vérifiez la connexion, puis réessayez. ») au lieu de laisser
croire que la session est fermée.

**Seul un refus de la session (401) ramène à la connexion.** Un serveur
qui ne répond pas affiche « Le serveur ne répond pas pour l'instant. »
avec « Réessayer ».

**Le menu du compte** prend le focus à l'ouverture ; les flèches passent
d'une rangée à l'autre, la tabulation le referme.

## Conséquences

- Une personne qui se déconnecte sur un poste partagé ne laisse rien de
  ses saisies dans le navigateur.
- Une coupure de réseau ne déconnecte plus personne.
