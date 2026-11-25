# ADR-0210 : La page de connexion de l'administration, à l'adresse et au mot de passe

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0204](0204-connexion-par-code.md)

## Contexte

Pour la campagne d'évaluation de 2026, la plateforme ne montrera que
l'évaluation annuelle, et les agents se connectent par leur code : leur nom
de famille et leur adresse @apix.sn (ADR-0204). Le compte d'administration
n'a pas d'adresse de l'APIX : il ne peut pas entrer par là. Il lui faut sa
propre page, à l'adresse et au mot de passe, comme avant le code.

Avant ces changements, l'état complet de la plateforme est gardé : le commit
`4632481` du 20 novembre 2026 est le point de retour après l'évaluation.

## Décision

**Une page à part : `/admin/connexion`.** L'adresse et le mot de passe, sur
le même écran que celui des agents : la scène de la charte, la carte, ses
champs. Le formulaire est le composant de `/login/mot-de-passe`, partagé.
Aucun écran des agents n'y mène.

**Seul un compte d'administration y ouvre sa session.** La page envoie
`administration` avec l'adresse et le mot de passe, et l'API refuse tout
autre compte (403, `auth.reserve_a_l_administration`) : « Ce compte n'a pas
accès à l'administration de la plateforme. » Un mauvais mot de passe reste
« Email ou mot de passe incorrect », sans rien dire du rôle du compte.

La connexion par mot de passe des agents, `/login/mot-de-passe`, ne change
pas.

## Conséquences

- La session ouverte est la même que par les autres pages. La suite de la
  campagne dira vers quel écran elle mène ; pour l'instant, le tableau de
  bord.
- Un compte d'administration qui oublie son mot de passe passe par « Mot de
  passe oublié » : le lien part à son adresse, quelle qu'elle soit.
