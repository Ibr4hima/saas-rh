# ADR-0259 : La lecture des réponses : le oui et ses puces ensemble, les puces au bord, la ponctuation tenue

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0238](0238-reponses-oui-non-et-puces.md)

## Contexte

En lecture, les réponses de l'auto-évaluation se rangent deux par deux, et
chaque question partage ses rangées avec sa voisine (`subgrid`) : la
question, puis la réponse. Sur une question à choix, le « Oui » et ses
puces formaient deux blocs ; les puces tombaient dans la rangée suivante,
sous toute la réponse d'à côté, et laissaient un grand vide sous le
« Oui ». Les puces étaient aussi en retrait du texte, et un intitulé qui
se coupait pouvait laisser son « ? » seul sur la ligne suivante. L'APIX a
relevé ces défauts d'alignement et d'espacement.

## Décision

**Une réponse forme un seul bloc** : le « Oui » et ses puces se suivent,
dans la rangée de la réponse, quelle que soit la longueur de la réponse
d'à côté.

**Les puces s'alignent sur le bord gauche de la réponse**, comme les puces
de la période : un petit point gris au bord, le texte juste après.

**Les espaces devant « ? », « ! », « : » et « ; » sont insécables** dans
les intitulés des questions, en lecture comme dans le formulaire : la
ponctuation reste au bout de la ligne.

## Conséquences

- Vaut partout où l'auto-évaluation se lit : chez l'agent, le N+1, le N+2
  et la DCH, et pour les points forts et les axes de développement du N+1.
- Rien ne change dans l'API ni dans le PDF.
