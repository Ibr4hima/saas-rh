# ADR-0224 : L'en-tête de l'agent : la direction en entier, l'email professionnel, le supérieur hiérarchique

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

L'en-tête d'un agent, dans la campagne, donne sa direction par son abrégé,
« DCH », le nom complet en infobulle, et son N+1 sous le libellé « N+1 »,
avec le poste du N+1 dessous (ADR-0211). Seul dans les repères, l'abrégé
dit moins que le nom complet, qui a la place de s'écrire. L'APIX veut aussi
le N+1 nommé « Supérieur hiérarchique », sans son poste.

## Décision

**Sans département ni service, la direction s'écrit en toutes lettres** :
« Direction du Capital Humain », sur autant de lignes qu'il faut, sans être
coupée, même sur un téléphone. L'email professionnel de l'agent prend la
place du département et du service. **Avec un département ou un service, la
direction garde son abrégé**, le nom complet en infobulle, sans l'email,
comme avant.

**Le repère du N+1 s'appelle « Supérieur hiérarchique »**, accordé au sexe
inscrit au dossier du N+1 : « Supérieure hiérarchique » pour une femme,
« Supérieur hiérarchique » pour un homme. Sans sexe inscrit, « Supérieur·e
hiérarchique », à l'écriture inclusive des libellés de la situation
familiale du dossier (« Veuf·ve »). Le libellé ne se devine jamais d'après
le prénom. Le repère ne donne que le nom, sans le poste dessous.

Ces règles valent partout où ces repères paraissent : l'en-tête d'un agent
(l'accueil, la page du N+1, celle du N+2, la fiche lue par la DCH), et les
en-têtes de « Mon auto-évaluation » et de « Mon évaluation ».

**L'API** : la fiche de l'agent (`AgentDeLaCampagne`) gagne `email`,
l'adresse professionnelle du dossier ; son évaluateur, `genre` (`female`,
`male` ou `null`), lu sur le dossier de l'évaluateur.

## Conséquences

- Les tableaux du suivi de la DCH et de l'administration gardent l'abrégé,
  dans leur colonne « Direction ».
- Ailleurs, la campagne dit toujours « N+1 » : « Mon équipe », « Évaluation
  du N+1 », « Renvoyer à mon N+1 ».
