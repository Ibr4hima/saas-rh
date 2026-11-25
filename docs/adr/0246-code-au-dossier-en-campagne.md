# ADR-0246 : En campagne, le code part à l'adresse du dossier, et le compte s'ouvre au premier code

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0204](0204-connexion-par-code.md)

## Contexte

La connexion par code n'envoyait un code qu'à un compte de la plateforme
dont l'adresse était celle saisie (ADR-0204). Or un compte n'existe qu'une
fois l'invitation au portail acceptée. Pendant la campagne, la plupart des
agents n'en ont pas ; d'autres ont un portail activé mais une invitation
jamais acceptée, ou un compte à une autre adresse que leur adresse
professionnelle. Pour ces agents, aucun code ne partait, et rien ne le disait :
l'écran répond de la même façon que le couple nom et adresse soit juste ou
non, par construction.

Quand un envoi échouait (serveur de courrier qui refuse, ne répond pas), le
journal ne le disait qu'au huitième essai, quatre heures plus tard.

L'ADR-0204 annonçait une décision à part pour l'ouverture des comptes à
évaluer : la voici.

## Décision

**En campagne, le dossier reçoit son code.** L'adresse saisie se cherche
d'abord parmi les comptes, comme avant ; puis parmi les dossiers en activité
qui portent cette adresse professionnelle. Le nom saisi doit être celui du
dossier, ou celui du compte qui lui est relié. Un seul dossier doit
répondre : deux dossiers à la même adresse et au même nom, rien ne part.

- Le dossier est relié à un compte qui se connecte encore : le code part à
  l'adresse du dossier, et c'est ce compte qui s'ouvre.
- Le dossier n'a pas de compte : le code part à l'adresse du dossier. Au
  premier code juste, le compte s'ouvre, sans mot de passe, aux noms du
  dossier, à son adresse, avec le rôle d'agent, relié au dossier, comme
  après une invitation acceptée. Une adresse qui sert déjà à un autre
  compte n'ouvre rien.
- La connexion en cours retient le dossier (migration 0143) : un code
  redemandé repart à la même adresse.

**Hors campagne, rien ne change** : seuls les comptes reçoivent un code, et
un compte s'ouvre par invitation.

**Rien ne change à l'écran** : la même réponse, que le couple soit juste ou
non.

**Le journal du serveur dit pourquoi un code ne part pas**, sans l'adresse
ni le nom : aucun compte ni dossier à cette adresse, un autre nom, un compte
qui ne se connecte plus, plusieurs dossiers, une adresse déjà prise, aucun
serveur de courrier. Chaque envoi manqué s'y écrit aussitôt, avec la réponse
du serveur de courrier, et le délai avant le nouvel essai.

## Conséquences

- La DCH n'a plus à activer les portails un à un pour la campagne :
  l'adresse professionnelle du dossier suffit. Elle doit être juste ; un
  dossier sans adresse professionnelle ne se connecte pas.
- Un compte ouvert ainsi reste après la campagne, sans mot de passe : une
  invitation au portail permettra d'en choisir un.
- La base dit quels dossiers portent une adresse, par leur identifiant
  seulement (`dossiers_a_l_adresse`) ; le reste se lit sous la RLS de
  l'organisation.
