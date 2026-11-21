# ADR-0230 : L'adresse professionnelle de la connexion, sans les propositions du navigateur

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0229](0229-pied-droit-et-nom-en-capitales.md)

## Contexte

Sur l'écran de connexion, le nom de famille ne reçoit plus les propositions
du navigateur (ADR-0229) ; l'adresse professionnelle les recevait encore.
L'APIX les veut retirées là aussi.

## Décision

Le champ de l'adresse professionnelle ne propose plus rien : ni les
adresses déjà saisies sur le poste, ni celles des fiches du navigateur, ni
celles d'un gestionnaire de mots de passe. Le reste ne change pas : la
partie avant « @ » seule, le domaine posé dans le champ, une adresse
complète de l'APIX collée y perdant son domaine.

## Conséquences

- Sur un poste partagé, l'écran de connexion ne montre plus ni le nom ni
  l'adresse de la personne qui s'y est connectée avant.
- L'écran de connexion de l'administration, à l'adresse et au mot de passe
  (ADR-0210), garde les propositions et le gestionnaire de mots de passe.
