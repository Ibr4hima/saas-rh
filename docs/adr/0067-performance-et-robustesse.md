# ADR-0067 : Performance à l'échelle et robustesse

**Statut** : acceptée · 2026-10-12

## Contexte

La plateforme a été mesurée sur une copie de sa base portée à 3 000 agents :
905 000 notifications, 150 000 demandes d'absence, 2 millions de lignes
d'audit, 25 000 candidatures. L'API tournait compilée, comme en production,
avec vingt requêtes simultanées par route.

- **La cloche de la DCH dépassait 60 s.** Sa relève relisait tout le circuit
  des congés, et chaque demande relue parcourait la table des notifications
  entière : sous la RLS, un `LIKE` ne descend jamais dans un index, faute
  d'être « leakproof ». Le tout tenait des verrous qui bloquaient les autres
  requêtes de l'organisation, plusieurs minutes durant.
- **La liste du personnel prenait 23 à 41 s** sous charge : 3,4 s de
  compilation JIT de Postgres par requête, et la direction de chaque agent
  recalculée trois fois par ligne.
- **Les compteurs de validation**, relus chaque minute par chaque
  responsable, envoyaient 1 300 requêtes par appel.
- **Côté robustesse**, une connexion au repos qui tombait aurait arrêté le
  processus, une requête bloquée retenait une connexion sans limite, la
  santé répondait 200 base coupée, et l'API compilée ne démarrait pas du
  tout (une injection résolue en mode développement seulement).

## Décision

1. **La base.** Les connexions de l'application tournent sans JIT. La
   migration 0107 ajoute huit index, chacun mesuré avant et après. Les
   recherches de clés de notification par préfixe passent de `LIKE` à `^@`
   (commence par), seul opérateur de préfixe leakproof : sous la RLS, lui
   seul sert un index.
2. **La veille.** Ce que le temps change sans que personne n'écrive (fins
   de contrat, alertes d'échéance, circuit des congés, relances) passe
   chaque minute en tâche de fond, pour chaque organisation, une étape par
   transaction. Chaque étape prend un verrou qu'elle n'attend pas : deux
   instances de l'API ne font pas le travail deux fois. Les lectures (la
   cloche, la liste du personnel, le tableau de bord) ne déclenchent plus
   rien ; la cloche garde les seuls rappels propres à la personne qui
   relève (fériés, titres qui expirent). Cela précise ADR-0021 : les
   déclencheurs au fil de la journée sont désormais la veille.
3. **Les requêtes.** La direction de chaque unité se calcule une fois par
   requête. Les compteurs de validation ne relisent que les demandes qui
   peuvent attendre la personne : celles de ses agents directs, ou toutes
   si elle traite les congés pour la DCH. Une mémoire le temps d'un calcul
   en lecture (`avecMemoire`) lit une seule fois la DCH, les détenteurs
   d'une habilitation, chaque N+1 et ses absences, pour toute une file.
4. **La robustesse.** Une requête est arrêtée après 60 s, un verrou attendu
   après 20 s, une transaction oubliée après 60 s ; une connexion libre
   s'attend 10 s au plus. Ces refus et une base absente répondent 503,
   réessayable, au lieu de 500. Le pool écoute ses erreurs, la santé
   répond 503 quand la base ne répond pas, l'arrêt laisse finir les
   requêtes en cours avant de fermer la base, et la CI démarre l'API
   compilée.

## Mesures

Même base, même API compilée : un appel seul, puis vingt requêtes
simultanées pendant huit secondes (médiane).

| Route                        | Un appel, avant | Après  | Sous charge, avant | Après  |
| ---------------------------- | --------------- | ------ | ------------------ | ------ |
| Cloche de la DCH             | plus de 60 s    | 55 ms  | 2,7 s, un échec    | 244 ms |
| Cloche d'un agent            | 272 ms          | 49 ms  | 1,1 s, un échec    | 164 ms |
| Liste du personnel, page 1   | 4,3 s           | 281 ms | 26,4 s             | 1,5 s  |
| Liste du personnel, page 100 | 7,2 s           | 290 ms | 41,5 s             | 1,5 s  |
| Personnel inactif            | 4,1 s           | 273 ms | 23,0 s             | 991 ms |
| Historique d'un dossier      | 399 ms          | 48 ms  | 2,4 s              | 112 ms |
| Congés à traiter (DCH)       | 745 ms          | 96 ms  | 4,4 s              | 565 ms |
| Compteurs de validation      | 1,2 s           | 296 ms | 7,0 s              | 1,3 s  |
| Demandes de documents (DCH)  | 861 ms          | 298 ms | 4,7 s              | 1,2 s  |
| Soldes d'un agent            | 144 ms          | 94 ms  | 768 ms             | 218 ms |

Les autres routes ne bougent pas : celles d'un agent restent sous 50 ms
pour un appel. Un tour de veille coûte environ 200 ms de base par minute à
cette échelle. Base arrêtée, la santé répond 503 en 5 ms et les routes 503
en 9 ms, sans que le processus tombe ; relancée, la requête suivante répond.
Un verrou tenu ailleurs rend un 503 au bout de 20 s, transaction annulée.
Un arrêt demandé laisse finir la requête en cours.

## Conséquences

- Une fin de contrat, une alerte d'échéance ou un appel à viser paraissent
  au plus une minute après le changement de jour ou d'état, et non plus au
  moment où quelqu'un relève sa cloche.
- Le nombre de connexions par instance se règle (`DB_POOL_MAX`, 10 par
  défaut) ; le total des instances reste sous le plafond de la base.
- Les migrations gardent leurs propres délais : un index sur une grande
  table peut demander plus d'une minute.
- La page des candidatures non retenues charge encore toutes les
  candidatures, déchiffrées à chaque appel : 1,4 s pour 6 200 dossiers, et
  sous charge des 503 faute de connexion libre. Sa recherche porte sur les
  noms, chiffrés au repos, que la base ne peut pas filtrer.
