# ADR-0139 : Le retour à la page précédente, un rond à gauche du titre de l'écran

**Statut** : acceptée · 2026-10-19

## Contexte

Les fiches et les pages de détail portaient, en tête de la page, sous le
titre de l'écran, un lien vers la page d'où l'on vient : « ← Gestion du
personnel » sur le dossier d'un agent, « Offres d'emploi » sur une offre,
« APIX Academy » ou le nom de la formation dans l'Academy, « Suivi &
Évaluation » sur le suivi d'un membre de l'équipe. Le titre de l'écran le
disait déjà, juste au-dessus.

## Décision

**Le retour se tient à gauche du titre de l'écran**, dans l'en-tête : un
rond de l'en-tête (36 px, cerclé d'un filet), le chevron
`chevron_backward`. Il mène où menait le lien, aux mêmes conditions. Son
nom, pour les lecteurs d'écran et dans l'infobulle : « Retour : » suivi de
la page visée.

**Le lien sous le titre disparaît.**

**Sur téléphone**, le titre descend en tête de la page ; le retour le suit,
à sa gauche.

## Conséquences

- La page pose le retour par un portail (`RetourDeLEcran`), comme ses
  onglets et ses gestes ; la coquille lui réserve la place.
- Une page sans retour garde son titre seul.
- Le contenu de la page remonte de la hauteur du lien.
