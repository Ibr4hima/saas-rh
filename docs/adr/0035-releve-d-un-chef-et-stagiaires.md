# ADR-0035 : Relève d'un chef : l'équipe passe au nouveau ; aucun stagiaire n'est n+1

**Statut** : acceptée · 2026-10-08

## Contexte

L'ADR-0034 impose le n+1 des chefs de département et de service, et laisse
les autres rattachements à la RH : remplacé, un chef gardait son équipe, et
gardait lui-même son n+1. Dans les faits, le nouveau chef reprend l'équipe de
celui qu'il remplace. Par ailleurs, rien n'empêchait de désigner un stagiaire
comme n+1 d'un agent, alors qu'un stagiaire ne dirige déjà aucune unité.

## Décision

**À la relève d'un chef de département ou de service, son équipe passe au
nouveau.** Les agents qui relevaient de l'ancien chef relèvent du nouveau,
qu'ils soient dans l'unité ou ailleurs dans la direction. L'ancien chef, s'il
reste dans l'unité, relève aussi du nouveau. L'opération l'annonce avec les
autres rattachements (motifs `suit_le_chef` et `ancien_chef`). Un chef retiré
sans successeur garde son équipe.

**Un stagiaire n'est le n+1 de personne**, ni pendant son stage ni avant qu'il
commence. Le rattachement est refusé (`people.n1_stagiaire`), les listes de
n+1 et de repreneurs ne proposent aucun stagiaire, et qui a une équipe ne
passe pas sous contrat de stage tant qu'elle n'est pas confiée à une autre
personne (`people.n1_en_stage`). Le contrôle de la chaîne signale un n+1 en
stage (`responsable_stagiaire`), sans bloquer l'évaluation.

**Le n+1 d'office reste le directeur** : un agent sans n+1 relève du
responsable de sa direction, pas du chef de son service.

## Conséquences

- Les directeurs gardent leur règle : l'ancien directeur, resté dans la
  direction, passe sous le nouveau, et son équipe le garde.
- Les cascades qui rattachent d'elles-mêmes (départ, retour, relève) passent
  par la même validation : aucune ne confie une équipe à un stagiaire.
