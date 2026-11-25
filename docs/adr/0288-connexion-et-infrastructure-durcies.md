# ADR-0288 : La connexion et l'infrastructure durcies après l'audit

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0246](0246-code-au-dossier-en-campagne.md) et l'[ADR-0247](0247-cles-d-acces.md)

## Contexte

L'audit de sécurité du 25 novembre 2026 a relu la connexion par code, les
clés d'accès, le limiteur, la configuration et les fonctions privilégiées
de la base. Chaque point ci-dessous était exploitable, ou le devenait par
une erreur de déploiement.

- **Le code par email.** Plusieurs codes vivaient en même temps, chaque
  connexion ouverte rendait cinq essais neufs, et deux essais simultanés
  passaient tous les deux sous la limite.
- **Un dossier relié à un compte.** Le code partait à l'adresse tapée dès
  que le nom et l'adresse professionnelle du dossier concordaient, même
  quand le compte relié était celui d'une personne protégée (la direction
  de la DCH, le DG, un compte d'administration).
- **Le limiteur.** Base injoignable, il laissait tout passer.
- **Les clés d'accès.** Une session volée pouvait poser une clé, qui
  survivait au changement de mot de passe.
- **La configuration.** `TRUST_PROXY=0.0.0.0/0` faisait croire l'en-tête
  `X-Forwarded-For` de n'importe qui. La clé de développement publiée
  passait en production dès que `NODE_ENV` était oublié.
- **Le chiffrement.** Un tag GCM raccourci était accepté.
- **La base.** Les fonctions `SECURITY DEFINER` cherchaient d'abord dans
  le schéma temporaire de la session. Le rôle de l'application pouvait
  écrire lui-même dans le journal d'audit.
- **Un compte réembauché.** L'accès se lisait sur un dossier pris au
  hasard : l'ancien dossier, fermé, pouvait couper le nouveau.

## Décision

**Le code par email.**

- Seul le dernier code est valable : en demander un nouveau périme les
  précédents, et leurs courriels pas encore partis ne partent pas.
- Douze codes par jour au plus pour une même personne (son couple nom et
  adresse), trois par quart d'heure comme avant.
- L'essai se compte avant la comparaison, dans la même écriture : une
  rafale simultanée ne dépasse jamais cinq essais par connexion.
- Dix codes faux par heure au plus pour une même personne, toutes
  connexions confondues : ouvrir une connexion de plus ne rend pas
  d'essais. Un code juste efface ce compte.

**Un dossier relié à un compte à une autre adresse** (ADR-0246) ne reçoit
plus de code quand ce compte est protégé (direction de la DCH, DG, compte
d'administration), ni quand l'adresse tapée est celle d'un autre compte.

**Le limiteur ferme la porte** trente secondes quand la base ne répond
pas, au lieu de couper toutes les limites.

**Les clés d'accès** se créent dans le quart d'heure qui suit la
connexion : au-delà, `403 auth.connexion_recente` (« Reconnectez-vous pour
créer votre clé d'accès. »). La réinitialisation du mot de passe efface
les clés du compte avec ses sessions.

**La configuration refuse de démarrer** :

- avec un réseau de confiance plus large qu'un /8 en IPv4 ou un /7 en
  IPv6 dans `TRUST_PROXY` ;
- avec la clé de développement dès que `PUBLIC_WEB_URL` sort de la
  machine ou du réseau du bureau (localhost, 127.0.0.0/8, ::1,
  10/8, 172.16/12, 192.168/16), `NODE_ENV` réglé ou non.

**Le chiffrement** exige un tag de seize octets, et une valeur vide se
chiffre et se relit.

**La base.**

- La migration 0148 fige le `search_path` des fonctions `SECURITY
DEFINER` : `pg_catalog, public, pg_temp`. Un test vérifie toutes les
  fonctions de ce type, présentes et à venir.
- La migration 0150 fait tourner les quatre déclencheurs d'audit avec les
  droits de leur propriétaire, et retire au rôle de l'application le
  droit d'écrire dans `audit_log` : seule une écriture métier y laisse
  une trace.

**Un compte réembauché** : le dossier en cours décide de son accès, sinon
le dernier parti.

## Conséquences

- Une personne qui redemande un code doit saisir le dernier reçu.
- Un poste qui garde une session ouverte depuis plus d'un quart d'heure
  ne propose plus la création d'une clé : il faut se reconnecter.
- Une adresse publique avec la clé de développement ne démarre plus :
  générer une clé (`openssl rand -base64 32`).
- Restent à faire, hors de cette décision : chiffrer les numéros de CNI
  et les RIB avec le contexte de leur ligne, comme les pièces (il faut
  rechiffrer l'existant), et donner aux fonctions privilégiées un
  propriétaire qui ne soit pas superutilisateur, au déploiement.
