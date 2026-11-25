# ADR-0157 : Cadre ou non cadre, la seule chose qu'on règle sur son propre dossier

**Statut** : acceptée · 2026-10-27 · précise l'[ADR-0024](0024-inactivite-et-revue-des-droits.md)

## Contexte

Rien sur soi-même (ADR-0024) : un membre de la DCH est aussi un agent, et
ce qui concerne son dossier passe par quelqu'un d'autre. Le tableau
« Agents à évaluer » suivait cette règle : la colonne « Personnel » s'y
choisit sur chaque ligne, comme sur la fiche, mais pas sur la sienne. Qui
dirige la DCH voyait « À renseigner » sur sa propre ligne, sans pouvoir
rien y faire.

Cadre ou non cadre choisit seulement la grille d'évaluation que remplira le
N+1. Ce choix ne donne aucun droit, et ne touche ni à la rémunération, ni
aux congés, ni à la hiérarchie.

## Décision

**Dans le tableau « Agents à évaluer », qui gère le personnel dit aussi si
son propre dossier est cadre ou non cadre.** C'est la seule chose qu'on
règle sur son propre dossier. Depuis la fiche, la modification de son
propre dossier reste refusée, cadre ou non cadre compris.

Les règles sont celles des autres lignes : il faut gérer le personnel, et
le dossier doit être en activité. Comme toute modification d'un dossier,
le choix reste dans l'historique de la fiche.

## Conséquences

- Une route : `PUT /evaluations/personnel/:employeeId`, que le tableau
  utilise pour toutes ses lignes. `PATCH /employees/:id` refuse toujours
  son propre dossier (`acces.son_propre_dossier`).
- Dans le suivi, `personnelModifiable` ne dépend plus de qui lit : vrai
  pour tout dossier en activité, si l'on gère le personnel.
