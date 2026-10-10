# ADR-0051 : La fiche d'objectifs s'ouvre au crayon et s'enregistre d'un clic

**Statut** : acceptée · 2026-10-10

## Contexte

Sur la page d'un direct, chaque fiche d'objectifs s'ouvrait prête à écrire,
et chaque pause de la saisie l'enregistrait. Un clic de trop dans une fiche
suffisait à la modifier sans que rien ne le signale, et l'agent n'en était
prévenu qu'une fois par jour et par fiche.

## Décision

**La fiche se lit d'abord.** Un crayon, posé sur le bord haut de la carte, à
droite, à la hauteur du titre, l'ouvre à la rédaction. Ouverte, la carte
prend le filet de la marque et le crayon devient le bouton « Enregistrer »
(une disquette), qui la referme. Une fiche dont l'agent a envoyé
l'auto-évaluation, ou celle d'un agent parti, n'a pas de crayon.

**Plus d'enregistrement automatique.** Rien ne part tant que le n+1 n'a pas
cliqué sur « Enregistrer » (ou pressé Ctrl+S). Refermée sans changement, la
fiche ne s'écrit pas ; renvoyée identique, le serveur ne l'écrit pas non
plus.

**Chaque enregistrement qui change la fiche prévient l'agent**, dans la
plateforme et par les canaux choisis. La dernière notification d'une fiche
remplace les précédentes, et le courriel encore en attente de l'une d'elles
ne part plus.

**Un semestre ouvert par « Fixer des objectifs » s'ouvre à la rédaction.**
Refermé sans rien d'écrit, il disparaît sans rien créer. Choisir un semestre
qui a déjà sa fiche l'ouvre, le curseur en fin d'objectifs.

**Ce qui n'est pas enregistré ne se perd pas en silence.**

- Un lien de l'application, cliqué avec une fiche modifiée, demande d'abord
  « Quitter sans enregistrer ? » : « Rester » ou « Quitter ». Quitter
  abandonne les modifications.
- Fermer ou recharger l'onglet : le navigateur demande.
- Les autres départs (la vue Évaluation, une notification ouverte, le retour
  du navigateur) gardent les modifications en mémoire. Au retour sur la
  page, la fiche est rouverte telle qu'on l'avait laissée.

## Conséquences

- L'ADR-0026 disait qu'une fiche rédigée avant le partage en trois parties
  s'enregistre rangée à la prochaine modification du n+1 : c'est désormais à
  son prochain enregistrement. Une échéance devenue texte change toujours
  l'empreinte de son objectif, dont le statut est alors à redonner.
- L'agent peut recevoir plusieurs avis sur une même fiche dans la journée ;
  seul le dernier reste dans sa boîte.
- Une modification gardée en mémoire ne survit pas au rechargement de la
  page, et ne se voit pas dans un autre onglet.
- Si l'agent envoie son auto-évaluation pendant que le n+1 écrit, la fiche
  se referme à la lecture suivante : ce qui n'était pas enregistré est
  abandonné, comme le serveur l'aurait refusé.
- Le journal d'audit garde une trace par séance d'écriture, comme avant.
