# ADR-0147 : Deux N+1 : le hiérarchique suit l'organigramme, le fonctionnel se choisit

**Statut** : acceptée · 2026-10-20 · remplace la règle de direction (ADR-0013, ADR-0034) ; précise l'[ADR-0034](0034-n-plus-un-des-chefs-d-unite.md), l'[ADR-0037](0037-directeur-remplace-son-equipe-passe.md) et l'[ADR-0076](0076-evaluation-annuelle.md)

## Contexte

Un seul n+1 servait à tout : viser les congés, fixer les objectifs, évaluer.
Pour tenir la chaîne de validation, la plateforme l'enfermait dans des règles
strictes : le n+1 dans la même direction que l'agent, un rattachement d'office
à la tête de direction, une équipe à confier à chaque départ, une mutation vers
une autre direction impossible à programmer. Le travail réel ne suit pas ces
règles : une personne travaille pour une autre direction, un projet traverse
plusieurs unités. La DCH distingue deux N+1 : le hiérarchique, qui valide, et
le fonctionnel, qui encadre le travail.

## Décision

**Le N+1 hiérarchique se calcule à partir de l'organigramme. Ce N+1 ne se
saisit pas.**

- Les têtes de direction (le Secrétariat général compris) et le DGA relèvent
  du DG. Le DG ne relève de personne.
- La tête d'un département relève de la tête de sa direction.
- La tête d'un service relève de la tête du département qui le contient,
  sinon de la tête de sa direction.
- Les autres agents relèvent de la tête de leur unité : leur service, sinon
  leur département, sinon leur direction.
- Un poste vacant renvoie au premier niveau occupé au-dessus, jusqu'au DG.
- **Exception, la Direction Générale.** Les têtes des départements et des
  services rattachés directement à la Direction Générale, et les agents qui y
  sont rattachés directement, relèvent du DG par défaut. La DCH peut choisir à
  la place le DGA ou la tête d'une autre unité : une responsabilité, jamais une
  personne sans responsabilité. Le choix désigne une place, pas une personne :
  il suit qui l'occupe, et le DG reprend le temps d'une vacance.

La chaîne se recalcule après chaque geste qui touche l'organigramme, les
affectations, les têtes ou les dossiers, et à chaque passage de la veille pour
ce que le temps change : une affectation qui commence, un contrat qui finit. Il
n'y a plus de cascade à décrire : ce qui relevait de la tête d'une unité relève
de la nouvelle tête.

**Le N+1 fonctionnel se choisit librement.**

- Par défaut, c'est le N+1 hiérarchique : rien à saisir.
- La DCH peut désigner tout agent actif, de n'importe quelle direction, sauf
  une personne en stage.
- Le N+1 fonctionnel fixe les objectifs, reçoit l'auto-évaluation, évalue et
  valide. Le N+1 hiérarchique, quand c'est une autre personne, voit
  l'évaluation sans pouvoir la modifier.
- Quand ce N+1 ne peut plus l'être (départ, contrat échu, stage, boucle),
  l'agent revient au N+1 hiérarchique, et la DCH en est prévenue.

**Garde-fous communs** : on n'est pas son propre N+1 ; pas de boucle ; un N+1
actif, sous contrat, jamais en stage.

**Structure** : une direction se rattache uniquement à la Direction Générale.

## Conséquences

- La règle de direction disparaît : rien n'oblige un N+1 fonctionnel à être
  dans la direction de l'agent.
- Les écrans ne demandent plus de n+1 à la création, à la mutation ni au
  départ, ni de personne pour reprendre une équipe. Une mutation vers une autre
  direction peut se programmer : la chaîne change le jour venu.
- L'import ne lit plus la colonne du N+1 : le N+1 découle de l'organigramme.
- L'ordre des désignations ne compte plus : un DGA peut être désigné avant le
  DG, la chaîne se complète à l'arrivée du DG.
- Le circuit des congés, l'équipe de l'espace agent et les rappels gardent le
  N+1 hiérarchique. Les objectifs et l'évaluation passent au N+1 fonctionnel.
- Le contrôle de la chaîne ne signale plus que ce qui empêche le calcul : un
  agent sans unité, l'absence de DG, une direction hors de la Direction
  Générale. Il liste aussi les agents dont le N+1 a changé avec la règle : la
  DCH peut garder l'ancien comme N+1 fonctionnel.
