# ADR-0071 : Academy, la même règle à chaque lecture

**Statut** : acceptée · 2026-10-14

Prolonge l'[ADR-0070](0070-evaluation-ouverte-a-la-gestion.md) : la lecture
libre ne vaut plus seulement pour qui anime la formation.

## Contexte

Une leçon se lit sous une règle : pas d'avance au-delà du point atteint,
pause quand on quitte l'onglet, vitesse à ×1, pas d'image dans l'image, une
seule lecture à la fois. Elle ne tenait qu'en première lecture : une leçon
validée se revoyait librement (avancer, quitter l'onglet, changer la
vitesse). La page « Mes certificats » rangeait aussi, à part, les
formations que l'agent anime.

La DCH demande une seule règle, à chaque lecture, avec deux exceptions :
qui anime la formation, pour celle-là, et qui a terminé la formation et en
a obtenu le certificat.

## Décision

**Chaque lecture suit la même règle, leçon validée ou non.** Relire une
leçon validée ne mène pas au-delà de ce que la lecture en cours a montré ;
l'onglet quitté met la vidéo en pause ; la vitesse reste à ×1, sans image
dans l'image ; une lecture ouverte ailleurs l'arrête.

**La lecture devient libre** (avancer, reculer, quitter l'onglet, changer
la vitesse, image dans l'image) :

- pour qui anime la formation, sur celle-là, en tout temps (ADR-0070) ;
- pour l'agent qui a validé toutes les leçons de la formation et tient un
  certificat en cours de validité pour elle.

Le serveur le dit à l'ouverture de chaque leçon (`libre`), et au battement
qui termine la formation certificat en main (`devientLibre`) : la lecture
se libère sans recharger la page.

**« Mes certificats » ne montre plus que les certificats.** La section des
formations animées disparaît, avec la route qui ne servait qu'à elle ; le
dossier de l'agent garde ses formations dispensées.

## Conséquences

- Entre la dernière leçon validée et l'évaluation réussie, revoir une leçon
  pour réviser se fait sous la règle.
- Un certificat expiré ou révoqué, une leçon ajoutée ou à revoir remettent
  la règle, jusqu'à ce que la formation soit de nouveau terminée et
  certifiée.
- En relecture, la barre de la vidéo hachure ce qui dépasse le point
  atteint pendant cette lecture ; les passages vus avant ne s'y affichent
  plus.
- Le serveur crédite comme avant : une leçon validée ne gagne rien à un
  saut, et la règle de relecture tient au lecteur.
