# ADR-0022 : Mot de passe oublié

**Statut** : acceptée · 2026-10-06

## Contexte

L'écran « Mot de passe oublié » existait, mais rien n'était envoyé : il
simulait un code à six caractères. Un agent qui avait oublié son mot de
passe devait passer par la DCH.

## Décision

**Un lien par courriel, valable une heure, qui sert une fois.** On donne
l'adresse de son compte ; le lien part à l'adresse du compte (l'adresse
professionnelle pour un agent) et mène à `/reinitialisation/<jeton>`, où
l'on choisit le nouveau mot de passe, avec la même politique qu'ailleurs.
Un lien plutôt qu'un code : un seul geste depuis la boîte, et rien à
recopier.

- **Rien ne dit si l'adresse a un compte.** La réponse est la même dans
  tous les cas, et elle part avant que le travail ne commence : ni son
  contenu ni son délai ne trahissent un compte.
- **Le lien remplace un mot de passe, il n'en rend pas un.** Un compte sans
  mot de passe (parti depuis plus de trente jours, ADR-0016), dont l'accès
  est coupé ou fermé, ne reçoit rien ; un lien déjà parti ne sert plus si
  le compte se ferme entre-temps. Ce compte-là revient par une invitation.
- **Un seul lien à la fois.** Une nouvelle demande fait tomber la
  précédente ; son courriel, s'il attend encore, ne part plus.
- **Le nouveau mot de passe ferme toutes les sessions** du compte, sur tous
  ses appareils, et efface les essais de connexion manqués.
- **Des limites** : trois liens par heure pour une même adresse, dix par
  heure depuis une même adresse IP (le limiteur en base, migration 0078).

Les liens vivent dans `password_resets`, table globale comme `sessions`
(migration 0089) : un compte vaut pour toutes ses organisations. Le jeton
n'y est gardé que haché. Le courriel passe par la file des courriels
(ADR-0015), dans l'organisation où le compte se connecte encore, son corps
chiffré jusqu'à l'envoi.

## Conséquences

- Sans serveur de courrier configuré, aucun lien n'est créé : la DCH reste
  le recours.
- `password_resets` n'a pas de déclencheur d'audit : la ligne ne dit rien
  d'autre qu'une demande, et le journal garderait le haché d'un jeton pour
  toujours. Les liens passés depuis un jour s'effacent à la demande
  suivante ; l'effacement définitif d'un compte emporte les siens.
