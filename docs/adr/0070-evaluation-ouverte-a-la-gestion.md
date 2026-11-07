# ADR-0070 : Academy, l'évaluation ouverte à qui gère le catalogue

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0046](0046-formateur-obligatoire.md),
l'[ADR-0049](0049-evaluation-sans-minuterie.md) et
l'[ADR-0058](0058-formations-encadrees.md) ; lève la règle des réponses vues
de l'[ADR-0024](0024-inactivite-et-revue-des-droits.md).

## Contexte

Qui gère le catalogue de l'APIX Academy (qui dirige la DCH, qui en a la
délégation, l'administrateur) en voit les questions et les bonnes réponses.
Les évaluations restaient donc fermées à ces personnes, et une formation
sans évaluation ne leur délivrait pas de certificat. Ouvrir les réponses
d'une formation se retenait (migration 0092) : l'évaluation restait fermée
à l'agent, même la délégation retirée.

La DCH lève ces restrictions : toute personne, y compris qui gère le
catalogue, suit les formations, passe les évaluations et obtient son
certificat en cas de réussite.

Qui anime une formation la suivait comme tout agent : leçons dans l'ordre,
vidéo sans avance, pause au changement d'onglet. Sur la page de la
formation, une carte disait que l'évaluation ne concernait pas cette
personne.

## Décision

**Seule la personne qui anime une formation n'en passe pas l'évaluation**,
quand c'est un agent de l'APIX (ADR-0046). Une formation sans évaluation ne
délivre pas de certificat à qui l'anime, et le dossier de l'agent la range
parmi les formations dispensées. Gérer le catalogue n'y change rien.

**Qui anime une formation la lit librement**, en aperçu, comme la RH qui la
relit : toutes les leçons sont ouvertes, la vidéo avance et recule à
volonté, continue quand l'onglet change, et rien n'est compté. La page de
la formation n'en montre ni l'évaluation ni le certificat, sans message ;
l'adresse de l'évaluation ramène à la formation. Cette liberté ne vaut que
pour la formation animée : les autres se suivent comme pour tout agent.

**Qui gère le catalogue est un agent comme les autres** : l'évaluation
réussie délivre son certificat ; une formation sans évaluation, à la
dernière leçon validée.

**Voir les réponses ne ferme plus rien.** La banque ouverte à l'atelier, une
question écrite, un essai corrigé ne se retiennent plus ; ce qui avait été
retenu ne compte plus.

**Les formations à suivre** ne laissent de côté que celles que l'agent a
obtenues ou anime, comme le disait l'ADR-0057.

## Conséquences

- Qui gère le catalogue et a déjà validé toutes les leçons d'une formation
  sans évaluation reçoit son certificat à son prochain passage dans
  l'Academy (catalogue, page de la formation, « Mes certificats »).
- Personne ne révoque ni ne réémet ses propres certificats, même en gérant
  le catalogue : la règle existait, elle sert désormais.
- Une copie réussie pendant que l'évaluation était fermée à la gestion
  reste sans certificat : l'évaluation se repasse.
- La progression enregistrée sur une formation avant que l'agent ne
  l'anime reste en base sans s'afficher ; elle reparaît si l'animation
  passe à une autre personne. Un certificat obtenu avant reste valide et
  figure dans « Mes certificats ».
- Le contrôle reste au serveur : en aperçu, aucune session de lecture ne
  s'ouvre et aucun passage n'est crédité.
- La page « Déléguer des tâches » ne prévient plus que la délégation
  « APIX Academy » ferme les évaluations.
- La table des réponses vues (migration 0092) n'est plus ni lue ni écrite ;
  elle se supprimera dans une version suivante (ADR-0010).
