# ADR-0290 : Plateforme : l'API fermée hors campagne, et les abus bornés

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

L'audit du 25 novembre 2026 a relu ce que la plateforme expose autour de
la campagne.

- **Le mode campagne ne fermait que les écrans** (ADR-0211, « l'API garde
  toutes ses routes »). Or la connexion par code ouvre un compte à tout
  agent de la campagne (ADR-0246), sans l'invitation de la DCH : depuis
  la console du navigateur, un agent lisait l'annuaire du personnel,
  déposait des demandes, et un N+1 décidait des congés de son équipe.
- **L'évaluation de la plateforme** écrit dans la même période que la
  campagne. La personne qui dirige la DCH pouvait en changer les dates
  fixées par l'administration, un N+1 pouvait remplir une seconde grille
  de la même année, et la veille annonçait l'ouverture de l'évaluation de
  la plateforme à tous les N+1.
- **L'import Excel** construisait une expression régulière avec un
  identifiant lu dans le fichier (une valeur piégée bloquait le serveur
  pour toutes les organisations), et décompressait sans plafond réel.
- **L'acceptation d'une invitation** calculait Argon2id avant même de
  chercher le lien, sans compter les liens inconnus : de quoi saturer le
  serveur sans rien connaître.
- **Les candidatures publiques** : le prénom saisi partait tel quel dans
  l'accusé de réception (un lien à la place du prénom, dans un courriel
  signé de la DCH), la limite se comptait par offre choisie par le
  client, et un dossier de 35 Mo se lisait avant de savoir si l'offre
  existait.
- **Une demande confiée** restait ouverte, documents et lettres compris,
  à la personne qui l'avait traitée : même close, même après son départ
  de la DCH.
- **Qui avait saisi un congé pour un agent** l'annulait à vie, comme
  l'agent, sans motif ni trace de son nom.

## Décision

**En campagne, l'API se ferme comme les écrans.** Un compte qui n'est pas
d'administration n'atteint que sa session (`/v1/me`), la campagne
(`/v1/campagne/…`) et la connexion (`/v1/auth/…`) ; le reste répond `403
campagne.hors_campagne`. L'administration garde toute l'API.

**Une année de la campagne ne s'évalue pas sur la plateforme** : l'année
du mode campagne, ou une année dont des fiches de la campagne sont
commencées. Ses dates ne se changent pas depuis la plateforme, aucune
grille neuve ne s'y ouvre (`409 evaluations.annee_de_la_campagne`), et la
veille n'annonce pas son ouverture. Une grille commencée avant reste.

**L'import Excel** lit chaque relation attribut par attribut, sans
expression régulière construite ; la décompression s'arrête au plafond,
quoi que l'archive annonce ; un caractère hors d'Unicode reste tel quel.

**L'acceptation d'une invitation** cherche le lien d'abord : inconnu,
expiré ou déjà servi, il est refusé sans calcul de mot de passe. Chaque
refus se compte par adresse réseau, comme un mot de passe faux : vingt par
quart d'heure.

**Les candidatures publiques.**

- Trente par heure au plus pour une même adresse réseau, toutes offres
  confondues, en plus des dix par offre.
- L'offre doit exister et recevoir des candidatures avant que le dossier
  ne soit lu.
- Une seule candidature en cours d'envoi par adresse : `429
recruitment.envoi_en_cours`.
- La salutation de l'accusé de réception ne reprend le prénom que s'il
  s'écrit comme un prénom (lettres, trait d'union, apostrophe) ; sinon,
  « Bonjour, ».

**Une demande confiée** ne s'ouvre à la personne à qui elle l'est que tant
qu'elle est en cours, et que cette personne est à la DCH : comme dans la
file.

**Saisir un congé pour un agent** ne donne la main sur ce congé que tant
que la personne qui l'a saisi gère les congés de l'agent. L'annulation
porte alors le nom de cette personne, et une notification l'annonce à
l'agent.

## Conséquences

- Pendant la campagne, un agent qui appelle une autre route de l'API
  reçoit un refus clair ; les écrans de la campagne ne changent pas.
- Les comptes ouverts par le code pendant la campagne gardent leur accès
  après : les fermer à la fin de la campagne reste une décision à
  prendre.
- Un poste partagé (cybercafé, bureau) n'envoie qu'une candidature à la
  fois.
