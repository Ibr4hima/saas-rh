# ADR-0017 : Invitations au portail, d'office au retour, groupées, suivies sur une page

**Statut** : acceptée · 2026-10-06

## Contexte

Les invitations au portail se faisaient une à une, depuis la fiche de
chaque agent. Après un import de cinquante agents, cinquante clics. Et un
agent qui revient (ADR-0016) attendait que la DCH réactive son dossier,
puis pense à l'inviter.

Un nouveau contrat ne disait pas non plus où l'agent travaillait : une
reprise dans une autre direction demandait une mutation à part.

## Décision

**Le nouveau contrat dit la place, et réactive.** Il porte le poste et la
direction, obligatoires, proposés d'après la dernière affectation. Dans la
même direction, l'unité en cours est gardée ; inchangés, rien ne bouge ;
changés, une nouvelle affectation part du début du contrat, sous les règles
d'une mutation. Sur un dossier inactif, il le réactive à cette place. Tout
se fait dans une seule transaction : un refus n'enregistre rien.

**Le retour invite de lui-même.** Si le compte de l'agent est fermé (parti
plus de trente jours, ADR-0016), l'invitation part d'office à la
réactivation, par le nouveau contrat comme par « Réactiver ». Sans adresse,
la réactivation passe et dit pourquoi l'invitation n'est pas partie.

**On invite en groupe.** À la création, une case (cochée) envoie
l'invitation dans la foulée. Après un import, la liste des agents créés se
coche : ceux qui ont une adresse professionnelle d'office, les autres à la
main. Chaque invitation part dans sa propre transaction : un refus
n'empêche pas les autres. Sans serveur de courrier, il n'y a pas d'envoi
groupé : le lien se génère depuis la fiche.

**Une page pour suivre.** « Gestion des accès », réservée au directeur du
Capital Humain : l'état de chaque agent en activité (compte actif,
invitation en attente ou en échec, expirée, aucune, compte fermé, accès
coupé), son adresse, sa dernière connexion ; on y invite un agent ou
plusieurs.

## Conséquences

- ADR-0016 disait que la fiche « propose d'envoyer l'invitation » au
  retour : elle part désormais d'elle-même, quand un serveur de courrier
  est configuré.
- « Réactiver » ne s'affiche plus quand le contrat est échu : c'est le
  nouveau contrat qui réactive.
- Corriger un contrat ne demande pas la place : seul un nouveau contrat la
  dit.
