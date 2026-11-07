# ADR-0068 : Les dernières routes lentes

**Statut** : acceptée · 2026-10-12

## Contexte

Après ADR-0067, sur la même base de 3 000 agents, trois écrans restaient
lents :

- **La liste du personnel** (281 ms par appel) cherchait l'affectation de
  chaque agent deux fois par agent, et ses listes déroulantes relisaient la
  vue entière trois fois : pour chaque agent, ses contrats, son équipe et
  son n+1, que ces listes n'affichent pas.
- **Les compteurs de la DCH et les demandes de documents** envoyaient 342
  et 230 requêtes par appel : une lecture récursive des subordonnés par
  demande en attente.
- **Les candidatures non retenues** se chargeaient toutes, déchiffrées à
  chaque appel : 1,4 s et 4,5 Mo pour 6 200 dossiers. Sous vingt appels
  simultanés, la page prenait toutes les connexions et répondait 503.

## Décision

1. **La liste du personnel.** L'affectation qui fait foi se lit en un seul
   passage pour toute la liste. Les listes déroulantes ne lisent que les
   trois colonnes qui les font, et le nom d'un manager une fois par
   manager.
2. **Les subordonnés.** Dans une portée de lecture (ADR-0067), la chaîne
   des N+1 se lit une fois et chaque agent s'y parcourt en mémoire. Hors
   portée, pour un seul agent, la lecture récursive reste.
3. **Les candidatures non retenues.** L'écran demande une page de quinze
   dossiers et sa recherche au serveur. Sans recherche, la base pagine.
   Avec, l'API déchiffre les seuls prénoms et noms, hors de toute
   transaction, et filtre avec la règle de l'écran, désormais partagée
   (`correspond`) ; seuls les quinze dossiers de la page se lisent en
   entier. La lecture se trace pour les offres dont la page montre des
   dossiers. Cela précise ADR-0067, qui laissait cette page à paginer.

## Mesures

Même base, même banc qu'ADR-0067 : un appel seul, puis vingt requêtes
simultanées pendant huit secondes (médiane).

| Route                       | Un appel, avant | Après        | Sous charge, avant | Après  |
| --------------------------- | --------------- | ------------ | ------------------ | ------ |
| Liste du personnel, page 1  | 281 ms          | 81 ms        | 1,5 s              | 376 ms |
| Personnel inactif           | 273 ms          | 71 ms        | 991 ms             | 305 ms |
| Compteurs de validation     | 296 ms          | 147 ms       | 1,3 s              | 700 ms |
| Demandes de documents (DCH) | 298 ms          | 99 ms        | 1,2 s              | 582 ms |
| Candidatures non retenues   | 1,4 s, 4,5 Mo   | 52 ms, 11 Ko | 11,7 s, trois 503  | 257 ms |

Une recherche parmi les 6 200 candidatures non retenues répond en 200 à
270 ms.

## Conséquences

- Une recherche sur les candidatures non retenues déchiffre encore tous les
  noms. Au-delà de quelques dizaines de milliers de dossiers, un index de
  recherche aveugle (les empreintes des mots du nom) la ferait descendre en
  base.
- La recherche part un quart de seconde après la dernière touche, comme sur
  la liste du personnel.
- Le journal des consultations ne trace plus que les offres de la page
  affichée, et non toutes les offres à chaque ouverture de la page.
