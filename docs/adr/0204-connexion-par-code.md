# ADR-0204 : La connexion par code, sur le modèle du vote électronique

**Statut** : acceptée · 2026-11-18 · complète l'[ADR-0009](0009-auth-maison.md)

## Contexte

La campagne d'évaluation annuelle, du 15 au 30 décembre, fait se connecter
chaque personne qui a un N+1, beaucoup pour la première fois. Retenir un mot
de passe, activer un compte depuis une invitation : autant d'obstacles le
jour où tout le monde doit entrer. Le vote électronique de l'APIX a montré
une connexion simple, qui a plu : le nom de famille, l'adresse
professionnelle, un code reçu par email.

## Décision

**Le premier écran demande le nom de famille et l'adresse professionnelle.**
Seule la partie avant « @ » se saisit, le domaine @apix.sn est posé dans le
champ. Une adresse complète de l'APIX, collée ou proposée par le navigateur,
y perd son domaine ; une adresse d'un autre domaine est refusée. Le nom se
compare sans accents, majuscules, espaces, tirets ni apostrophes, à celui du
compte comme à celui du dossier.

**Si le couple correspond à un compte qui se connecte, un code de six
caractères part à cette adresse.** Les caractères sont ceux de la base 32 de
Crockford, sans I, L, O ni U ; à la saisie, O se lit 0, I et L se lisent 1.
Un compte se connecte s'il est actif et que son accès n'est ni coupé ni
fermé. Un compte sans mot de passe reçoit son code.

**Rien ne distingue un couple juste d'un faux.** La réponse est la même et
part tout de suite ; le compte se cherche après elle. Un code est créé dans
tous les cas et ne part que si le couple est juste. L'écran suivant dit :
« Si vos informations sont correctes, un code de 6 caractères vient d'être
envoyé à a.••••@apix.sn. »

**Un code est lié à la personne, pas à la demande.** Tout code encore
valable de la personne ouvre la session ; l'un d'eux sert, tous tombent. Un
code vaut tant que dure la connexion qui l'a demandé, une heure au plus.

**Les limites sont celles du vote électronique.** Cinq essais par connexion
en cours, puis on la reprend depuis le début. Trois codes par quart d'heure
pour un même couple nom et adresse, quarante-cinq secondes entre deux ;
seuls comptent les codes qui n'ont pas servi, et une connexion réussie remet
le compteur à zéro. Par adresse réseau, tout un bureau se connectant
derrière la même : mille demandes, six cents essais et trois cents renvois
par quart d'heure.

**Le courriel du code** a pour objet « Votre code de vérification », sans le
code ; son aperçu dit « Ouvrez ce message pour lire votre code. ». Ni bouton
ni lien : le code s'y lit en grand, et un clic le sélectionne. Il passe en
tête de la file des courriels ; un code qui a servi ou expiré ne part plus.

**La connexion par mot de passe reste**, à `/login/mot-de-passe`, par un
lien discret sous le bouton du premier écran.

**Rien n'est gardé en clair** (migration 0136). La connexion en cours vit en
base derrière un cookie (`tg_attente`, aux attributs de celui de la session,
une heure), son jeton haché. Le couple nom et adresse et le code ne sont
gardés qu'en empreinte HMAC, d'une clé dérivée de la clé de chiffrement.

## Conséquences

- `/login` devient la connexion par code. L'ancien écran passe à
  `/login/mot-de-passe`, où mènent aussi la réinitialisation et le mot de
  passe oublié.
- La file des courriels envoie le code avant tout autre courriel, et repart
  aussitôt quand un lot de vingt était plein : une vague de connexions
  n'attend pas trente secondes de plus à chaque lot.
- Sans serveur de courrier, aucun code ne part : seule la connexion par mot
  de passe reste.
- La campagne d'évaluation s'appuie sur cette connexion. L'ouverture des
  comptes à évaluer et le mode campagne feront l'objet d'une décision à
  part.
