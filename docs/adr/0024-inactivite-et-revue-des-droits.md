# ADR-0024 : Déconnexion après trois jours d'inactivité, revue des droits d'accès

**Statut** : acceptée · 2026-10-07

## Contexte

Une session durait douze heures fixes, qu'on s'en serve ou non : il
fallait se reconnecter chaque jour, et rien ne distinguait un onglet actif
d'un onglet oublié sur un poste partagé. Et les droits
d'accès n'avaient jamais été relus d'un bout à l'autre, route par route,
avec la question : « qu'est-ce qu'un compte peut faire de plus que ce que
son rôle lui donne ? ».

## Décision

**Une session s'arrête après trois jours sans activité**
(`SESSION_INACTIVITE_HEURES`, 72 par défaut), et au plus tard trente jours
après la connexion (`SESSION_DUREE_MAX_JOURS`). L'activité se lit à chaque
requête (`sessions.last_seen_at`, migration 0091), au plus une écriture par
minute. Les appels que le portail fait seul, en fond (compteurs,
notifications, suivi), portent l'en-tête `X-Arriere-Plan: 1` et ne
comptent pas : un onglet oublié ne garde pas la session ouverte.

**Rien sur soi-même, sous aucune forme.** Personne ne se désigne N+1 d'un
agent, ni repreneur de l'équipe d'un partant : à la création, à la
modification, à la mutation, au départ, à l'import. Seule exception, ce que
la règle fait déjà : le responsable d'une direction est le N+1 d'office de
ses agents.

**Une fin de contrat ne contourne pas la désactivation.** Une fin déjà
passée, saisie par correction ou par un nouveau contrat, ferme le dossier :
les garde-fous de la désactivation s'appliquent (le dernier
administrateur, qui dirige une unité). Rouvrir le compte d'un
administrateur, par réactivation ou par un nouveau contrat, revient à
l'administrateur ou au directeur du Capital Humain, comme son invitation.

**Ce qui est confié ne se voit que tant que c'est ouvert.** Une demande de
congé, de document ou de mise à jour d'informations confiée à un membre de
la DCH sort de sa vue une fois traitée, avec son motif et sa pièce.

**Un délégué ne gère pas le congé de ses chefs.** Il ne l'annule pas, ne
rappelle pas, ne remplace pas le justificatif ; il n'en lit ni le motif
confidentiel, ni le certificat, ni les jours de maladie. Le congé du
directeur du Capital Humain reste géré par les membres de sa direction.

**Qui a vu les réponses d'une évaluation ne la passe pas.** Ouvrir la
banque de questions, écrire une question ou faire corriger un essai se
retient (migration 0092) : l'évaluation reste fermée à cet agent, même sa
délégation à l'Academy retirée.

**Les tentatives se comptent avant d'être vérifiées.** La connexion compte
chaque essai par compte avant de vérifier le mot de passe (des essais
lancés en parallèle ne passent pas entre les mailles), et par adresse
quand il échoue. L'acceptation d'une invitation avec un compte existant
suit les mêmes compteurs. La vérification publique d'un certificat se
limite à soixante par adresse et par dix minutes.

**Les invitations sensibles restent à la direction.** Le directeur du
Capital Humain, le directeur général et les comptes administrateurs ne
sont invités que par l'administrateur ou le directeur du Capital Humain.
Un accès coupé par quelqu'un d'autre ne se rétablit que par eux. Une
adresse utilisée par un compte d'une autre organisation n'est jamais
libérée.

## Conséquences

- `SESSION_TTL_HOURS` n'est plus lu : en production, régler
  `SESSION_INACTIVITE_HEURES` et `SESSION_DUREE_MAX_JOURS`.
- Un appel de fond ajouté au portail doit porter `{ arrierePlan: true }`
  (`lib/api.ts`), sinon il garde les sessions ouvertes.
- Le numéro de la pièce reste saisissable à la création d'un dossier sans
  l'accès aux données sensibles : qui crée le dossier a la pièce en main.
  Il ne se relit, ni ne s'écrase ensuite, qu'avec cet accès.
- Restent à décider : l'authentification à deux facteurs (reportée), et
  trois points produit relevés par la revue (le retour question par
  question des évaluations, la réponse de la page Postuler à une adresse
  qui a déjà candidaté, les notes données par les N+1 précédents).
