# ADR-0049 : Academy, l'évaluation sans limite de temps et le certificat sans évaluation

**Statut** : acceptée · 2026-10-09

## Contexte

L'évaluation finale d'une formation se composait contre la montre : deux
minutes par question, décomptées par le serveur. À zéro, la copie partait
d'elle-même, et une copie arrivée en retard comptait pour zéro. Une
formation sans banque de questions, elle, se suivait sans rien délivrer :
la suivre en entier ne laissait aucune trace.

## Décision

**L'évaluation n'a plus de limite de temps.** L'agent répond à son rythme.
La copie reste ouverte jusqu'à être rendue, se reprend telle quelle (les
réponses cochées restent dans le navigateur, onglet fermé compris) et se
corrige quand elle arrive. Le reste ne change pas : questions tirées au
hasard, 80 % pour réussir. L'essai de la RH suit la même règle.

**Une formation sans évaluation délivre un certificat à qui en valide
toutes les leçons.** Il est émis au moment où la dernière leçon est
validée, sans score : il atteste la formation suivie en entier. Le document
s'intitule « Certificat de formation » au lieu de « Certificat de
réussite », et sa vérification publique ne montre pas de score. Avec une
évaluation, rien ne change : il faut suivre les leçons, puis la réussir.

**Les mêmes personnes en sont exclues** : qui anime la formation
(ADR-0046) et qui gère le catalogue. La page de la formation le leur dit.
La validité réglée pour la formation s'applique, et ce certificat se
révoque ou se réémet comme les autres.

**Il est délivré une fois.** Expiré ou révoqué, il ne revient pas de
lui-même.

## Conséquences

- Migration 0102 : l'heure limite d'une copie devient facultative (vide
  pour les nouvelles), le score d'un certificat aussi. Les copies laissées
  ouvertes au-delà de leur ancienne heure limite, que l'écran comptait déjà
  comme des échecs, sont rendues à zéro, à l'heure où leur temps s'est
  écoulé.
- Qui avait déjà validé toutes les leçons d'une formation sans évaluation
  reçoit son certificat à son prochain passage dans l'Academy (catalogue,
  page de la formation, « Mes certificats »). De même quand une formation
  perd sa dernière question.
- À l'échéance d'un tel certificat, rien ne permet encore de le renouveler :
  il n'y a pas d'évaluation à repasser.
- Une formation sans évaluation reste « Terminée », sans certificat, pour
  qui l'anime, pour qui gère le catalogue, et après un certificat expiré ou
  révoqué.
