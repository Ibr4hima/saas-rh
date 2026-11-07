# ADR-0192 : Une demande de document se coche, une seule à la fois

**Statut** : acceptée · 2026-11-07 · précise l'[ADR-0191](0191-une-demande-a-la-fois.md)

## Contexte

L'ADR-0191 a mis « Traiter » et « Décliner » en bout de chaque ligne de
« Demandes de documents ». La DCH préfère la file d'avant : on choisit la
demande, puis on agit depuis l'en-tête. Et dans « Demandes traitées », la
suite donnée d'une demande remise en ligne ajoutait « 1 fichier » sous
« Déposée en ligne ».

## Décision

**La demande se coche, une seule à la fois.** Les cases reviennent dans la
file, sans case « Tout sélectionner ». Cocher une autre demande décoche la
première. Une fois la demande cochée, « Traiter » et « Décliner »
apparaissent en tête de la carte, à côté de « 1 demande sélectionnée » et
de « Désélectionner ». Les boutons en bout de ligne et la colonne
« Décision » disparaissent. La suite ne change pas : « Traiter » ouvre
« Mise à disposition » (ADR-0191).

**La suite donnée ne compte plus les fichiers.** « Déposée en ligne » se
lit seul ; pour qui traite ce document, un clic dessus ouvre les documents
déposés, pour les vérifier ou les corriger (ADR-0040).

## Conséquences

- La sélection des tableaux prend une option `unique` : en cocher une autre
  ligne remplace la précédente.
- La sélection porte, comme avant, sur la page affichée de la file.
