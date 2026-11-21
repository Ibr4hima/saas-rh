# ADR-0215 : Le formulaire d'auto-évaluation de la campagne, sur la fiche S1/EN05

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0211](0211-mode-campagne-et-accueil.md) et l'[ADR-0205](0205-fiche-d-entretien-annuel.md)

## Contexte

Pendant la campagne, les agents à évaluer remplissent leur partie de la
fiche d'entretien S1/EN05 (ADR-0205) avant l'entretien : le récapitulatif
de l'année, l'atteinte des objectifs, les autres réalisations, les
préoccupations et les souhaits. Le N+1 la lit ensuite pour l'évaluer. Le
bouton « M'auto-évaluer » de l'accueil y mène (ADR-0214).

## Décision

**Les objectifs sur la fiche de l'année.** La migration 0138 ajoute
`fiches_entretien.objectifs` : les objectifs fixés à l'agent pour l'année,
dans l'ordre de la fiche, chacun avec son identifiant, son intitulé et ses
indicateurs. L'import de la DCH les remplira, à l'étape de
l'administration. Les tables `objectifs` et `objectifs_fiches`, de
l'ancienne grille, ne servent pas.

**Le formulaire suit la fiche**, avec les questions de la DCH mot pour mot
(contrats, `entretien-annuel.ts`), en trois cartes :

- « Récapitulatif et faits marquants » : les deux questions du bilan ;
- « Évaluation des résultats » : pour chaque objectif, son niveau (A
  Dépassé, B Réalisé, C Partiellement réalisé, D Non réalisé), choisi comme
  dans la grille de la plateforme, les résultats obtenus et un commentaire ;
  puis les autres réalisations ;
- « Préoccupations et souhaits » : les quatre questions de la fiche et
  « Autres commentaires ».

Sur un grand écran, les questions vont deux par deux, leurs zones de
réponse alignées d'une colonne à l'autre.

**Obligatoires, et marqués d'un astérisque** : les deux questions du
récapitulatif, puis, pour chaque objectif, son niveau et ses résultats
obtenus. La règle vit une seule fois, dans les contrats
(`ceQuiManqueALAutoEvaluation`) : l'écran et l'API l'appliquent.

**L'enregistrement est automatique.** Chaque modification part 1,2 s après
la dernière frappe, un envoi à la fois ; ce qui reste part quand on quitte
la page par un lien, et le navigateur prévient avant de fermer une page qui
n'a pas tout enregistré. Une barre collée au bas de l'écran dit où en est
l'enregistrement (« Brouillon enregistré à 16 h 54 »), ce qui manque, et
porte « Transmettre à mon N+1 », actif une fois tout l'obligatoire rempli.
La transmission se confirme : l'auto-évaluation part au N+1 et ne change
plus. En tête de la page, quatre repères : le N+1, la date limite, le nombre
d'objectifs, l'avancement des réponses obligatoires (puis, transmise, sa
date).

**L'API** : `GET`, `PUT` (le brouillon) et `POST …/transmission` sur
`/v1/campagne/auto-evaluation`, sur sa propre fiche seulement, pendant la
période de l'auto-évaluation et tant qu'elle n'est pas transmise ; sinon,
409 (`campagne.auto_fermee`, `campagne.auto_transmise`). Incomplète, la
transmission est refusée (422, `campagne.auto_incomplete`) et la réponse
dit ce qui manque. L'appréciation d'un objectif absent de la fiche ne
s'enregistre pas. Sans auto-évaluation à faire (au sommet de
l'organigramme, en stage, sans dossier) : 404,
`campagne.sans_auto_evaluation`.

**Le N+1 la lit une fois transmise**, en entier, sur la fiche de l'agent
ouverte depuis sa carte. Le brouillon reste à l'agent.

## Conséquences

- Les objectifs doivent être importés avant l'ouverture de
  l'auto-évaluation : une auto-évaluation transmise sans objectifs n'en
  aura pas.
- L'évaluation par le N+1, les sections 3 à 5 de la fiche, viendra se
  poser sous l'auto-évaluation, sur la même page.
