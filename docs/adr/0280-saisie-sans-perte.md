# ADR-0280 : Ce qui est saisi ne se perd plus, et l'accueil propose de continuer l'auto-évaluation

**Statut** : acceptée · 2026-11-25 · complète l'[ADR-0215](0215-formulaire-d-auto-evaluation.md), l'[ADR-0216](0216-evaluation-par-le-n1.md), l'[ADR-0218](0218-commentaires-du-n2.md) et l'[ADR-0274](0274-campagne-des-objectifs.md)

## Contexte

L'auto-évaluation, l'évaluation du N+1, les commentaires du N+2 et les
objectifs s'enregistrent seuls, un peu après la dernière frappe. L'APIX a
constaté des saisies perdues. Trois causes :

- revenue sur une page de saisie sans la recharger (l'accueil, puis de
  nouveau le bouton), la personne retrouvait la fiche telle qu'elle était à
  sa première ouverture, gardée en mémoire par le navigateur ; la frappe
  suivante enregistrait cette version ancienne par-dessus la bonne ;
- un envoi qui échouait (réseau, serveur) ne repartait qu'à la frappe
  suivante ;
- une frappe continue, sans pause, n'était envoyée qu'à la première pause ;
  un ordinateur éteint, un onglet fermé ou un réseau tombé faisait perdre
  ce qui n'était pas encore parti.

## Décision

**La saisie part toujours de la fiche relue à l'ouverture de la page**,
jamais d'une copie gardée en mémoire depuis une visite précédente : la
page attend la réponse du serveur avant d'ouvrir la saisie.

**L'enregistrement automatique** :

- part 0,8 s après la dernière frappe, et au plus tard 4 s après la
  première, même sans pause ;
- un envoi qui échoue (réseau, serveur, session) repart seul après 2 s,
  puis 4 s, 8 s… jusqu'à 30 s d'écart, et dès que le réseau revient. La
  barre du bas dit : « Enregistrement impossible pour l'instant, nouvel
  essai automatique. » Un refus (une évaluation fermée ou déjà transmise)
  ne se relance pas, et la barre dit pourquoi ;
- l'onglet caché ou fermé, ce qui reste part quand même.

**Une copie dans le navigateur.** Chaque frappe garde aussi une copie de la
saisie dans le navigateur, propre au compte et à la page. Au retour, après
une coupure (ordinateur éteint, réseau tombé), la saisie reprend cette
copie si le serveur n'a pas changé depuis le début de cette saisie, puis
l'enregistre. Si le serveur a changé entre-temps, par exemple une saisie
continuée sur un autre ordinateur, le serveur fait foi. La copie s'efface
une fois la saisie enregistrée ; une copie de plus de 30 jours s'efface
sans être reprise.

**Sur l'accueil**, une fois l'auto-évaluation commencée, le bouton
« M'auto-évaluer » devient « Continuer mon auto-évaluation ».

## Conséquences

- Sur un ordinateur partagé, une saisie qui n'a pas pu partir reste dans le
  navigateur jusqu'au retour de la personne, 30 jours au plus ; un autre
  compte ne la reprend pas.
- Revenir sur une page de saisie montre un bref chargement : la fiche est
  relue à chaque ouverture.
- Le serveur et ses routes ne changent pas.
