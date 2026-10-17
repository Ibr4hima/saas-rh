# ADR-0057 : L'échéance proche se confirme à l'enregistrement ; les formations n'en ont pas

**Statut** : acceptée · 2026-10-12

Remplace, dans l'[ADR-0056](0056-fixer-des-objectifs-par-semestre.md), le
moment où une échéance proche de l'évaluation se confirme, et la règle lue
en tête des objectifs ([ADR-0055](0055-objectifs-a-echeance.md)). Précise
l'[ADR-0027](0027-formations-a-suivre-en-badges.md) pour les formations à
suivre.

## Contexte

L'ADR-0056 ouvrait la fenêtre « Confirmer cette échéance ? » dès qu'une
échéance à 30 jours ou moins de l'évaluation était choisie. Or le calendrier
du navigateur change la date à chaque mois qu'on fait défiler : la fenêtre
s'ouvrait pendant qu'on cherchait le jour. L'encadré de la règle, en tête
des objectifs (ADR-0055), chargeait la fiche sans servir au geste. Enfin,
rien n'empêchait de demander à un agent une formation que l'agent anime
dans l'APIX Academy.

## Décision

**Choisir une date ne fait que la poser sur la puce.** Ni fenêtre, ni
objectif qui change de place pendant qu'on fait défiler le calendrier. Les
objectifs se rangent par échéance quand on quitte la puce, ou sur Entrée.

**L'échéance proche se confirme à l'enregistrement** (le bouton, ou
Ctrl+S). Chaque échéance fixée depuis le dernier enregistrement à 30 jours
ou moins de son évaluation se confirme, une fenêtre après l'autre, dans
l'ordre de la fiche, avec le texte et les choix de l'ADR-0056 :
« Confirmer », ou « Reporter à la prochaine évaluation » avec une nouvelle
échéance. Une nouvelle échéance elle aussi à 30 jours ou moins de son
évaluation se confirme aussitôt. Quand toutes l'ont été, la fiche part.

- Fermer une fenêtre (la croix, Échap, « Annuler ») arrête
  l'enregistrement : rien ne s'écrit, la fiche reste ouverte avec ce qu'on
  y a mis. Les échéances déjà confirmées le restent tant que la fiche est
  ouverte : un nouvel essai ne les redemande pas.
- Une échéance déjà enregistrée ne se redemande pas : elle s'est confirmée
  en son temps, ou date d'avant cette règle. Corriger le texte d'un
  objectif n'ouvre aucune fenêtre.
- Le refus d'un objectif sans échéance (ADR-0056) passe avant.

**Plus d'encadré de la règle.** Les phrases qui disaient quelle évaluation
compte pour quelle échéance disparaissent de la fiche. La puce garde ses
bornes : l'échéance se choisit dans la période du semestre.

**Les formations à suivre n'ont pas d'échéance.** Une formation demandée
s'évalue à l'évaluation du semestre de sa fiche, avec les objectifs. Elle
ne part dans aucune autre fiche et n'ouvre aucune fenêtre.

**Ne se proposent pas** : les formations que l'agent a obtenues (ADR-0027 :
certificat en cours de validité, ou toutes les leçons vues quand la
formation n'a pas d'évaluation), ni celles que l'agent anime dans l'APIX
Academy. La fiche du membre (`GET /objectifs/equipe/:employeeId`) donne
celles-ci : `formationsAnimees`.

## Conséquences

- La saisie de l'ADR-0056 (« une échéance tapée vaut quand on quitte la
  puce ») n'a plus d'objet : une date complète, dans ses bornes, vaut
  aussitôt ; une date à moitié tapée, ou hors des bornes, s'efface quand on
  quitte la puce.
- Un objectif reporté à l'enregistrement part dans la fiche de sa nouvelle
  évaluation, et la fiche le dit, comme avant (ADR-0055, ADR-0056).
- Une formation demandée avant que l'agent ne l'anime reste dans la fiche ;
  son badge reste à l'écran du n+1, qui peut la retirer.
- Un certificat expiré ou révoqué rend la formation de nouveau proposable :
  elle se redemande pour le renouveler.
- Une formation dont l'agent est gestionnaire dans l'Academy (son
  évaluation est fermée à l'agent) reste proposée : la question reste
  ouverte.
