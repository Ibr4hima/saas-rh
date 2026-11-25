# ADR-0270 : Remettre à zéro les fiches de la campagne après des essais

**Statut** : acceptée · 2026-11-24 · complète l'[ADR-0211](0211-mode-campagne-et-accueil.md) et l'[ADR-0222](0222-administration-de-la-campagne.md)

## Contexte

Avant d'ouvrir la campagne, l'APIX la teste sur sa propre base : une
auto-évaluation, l'évaluation du N+1, la validation, parfois jusqu'à la
DCH. Une fiche validée ne change plus (ADR-0217, ADR-0267), et rien dans
l'application ne permet de la rouvrir. Pour recommencer, il fallait
écrire du SQL à la main.

## Décision

**Une commande, sur le modèle de `pnpm personnel:vider`** (ADR-0159) :

```bash
pnpm campagne:reinitialiser                                  # essai à blanc
pnpm campagne:reinitialiser --confirmer                      # toutes les fiches de l'année
pnpm campagne:reinitialiser --confirmer --agent <adresse>    # la fiche d'un seul agent
```

`--agent` prend l'adresse professionnelle de l'agent, ou celle de son
compte. `--annee` vise une autre année que celle de la campagne
(`CAMPAGNE_D_EVALUATION`, sinon l'année en cours), `--organisation` une
organisation quand la base en compte plusieurs. Une option sans sa valeur
arrête tout : `--agent` seul ne remet pas toutes les fiches à zéro.

**Remis à zéro**, sur les fiches de l'année : l'auto-évaluation, l'évaluation
du N+1 et la partie réservée, la validation par l'agent, les commentaires
du N+2, la reprise au N+2 et la transmission à la DCH, avec leurs dates et
leurs auteurs.

**Gardé** : les objectifs de l'année, l'évaluateur choisi par
l'administration (ADR-0222), les dates de la campagne, les comptes et
leurs clés d'accès. Le journal d'audit garde la trace de la remise à zéro,
avec ce que chaque fiche contenait.

Tout se joue dans une seule transaction. À blanc, elle s'annule à la fin,
et la commande liste les fiches qui repartiraient de zéro, avec l'étape
qu'elles avaient atteinte.

## Conséquences

- La commande sert aux essais. Pendant la vraie campagne, elle effacerait
  le travail des agents et des N+1 : l'essai à blanc et `--confirmer`
  sont là pour qu'on la lance en connaissance de cause.
- Rien dans l'application ne rouvre une fiche validée. Si l'APIX en a
  besoin pendant la campagne, ce sera un geste de l'administration, avec
  sa propre décision.
