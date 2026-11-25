# ADR-0241 : Valider son auto-évaluation, la fiche en PDF, et la barre au bas de la page

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0215](0215-formulaire-d-auto-evaluation.md)

## Contexte

Sous le formulaire de l'auto-évaluation, une barre collée au bas de l'écran
disait où en était l'enregistrement et portait « Transmettre à mon N+1 »,
précédé d'une flèche (ADR-0215). La même barre sert l'évaluation du N+1 et
les commentaires du N+2. L'APIX la veut au bas de la page, sans flèche, et
veut que l'agent relise sa fiche avant de l'envoyer, comme on relit un
document généré avant de le télécharger.

## Décision

**La barre** se place au bas de la page, après la saisie : elle ne se voit
qu'au bout du défilement. Le bouton de transmission perd sa flèche. Sur un
téléphone, ses boutons s'empilent sur toute la largeur. C'est la même barre
pour l'agent, le N+1 et le N+2.

**« Valider »**, à gauche de « Transmettre à mon N+1 », s'ouvre une fois
toutes les réponses obligatoires données. Il replie la saisie, comme le
préremplissage de la génération de documents (ADR-0121), et montre la fiche
de l'agent en PDF, à la largeur de la page : l'identification, le bilan de
l'année, chaque objectif avec son auto-évaluation, et les souhaits ; rien
de ce que remplit le N+1. Au-dessus, « Mes réponses » et « Modifier » ;
dans la barre, « Modifier » prend la place de « Valider ». « Modifier »
rouvre la saisie telle qu'elle était. La transmission se fait depuis la
saisie comme depuis la fiche.

**L'API** compose ce PDF à la demande (`POST
/campagne/auto-evaluation/apercu`), à partir des réponses que porte le
formulaire, enregistrées ou non. Elle n'enregistre rien.

## Conséquences

- Le PDF de la fiche prend une troisième forme : la partie de l'agent
  seule, sections 1, 2 et 6, à côté de la version de l'agent et de la
  version complète.
- La page « Mon évaluation », où l'agent valide l'évaluation de son N+1,
  garde sa barre collée au bas de l'écran.
