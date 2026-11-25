# ADR-0247 : Les clés d'accès : le code à la première connexion, puis Face ID ou l'empreinte

**Statut** : acceptée · 2026-11-22 · complète les ADR [0204](0204-connexion-par-code.md) et [0246](0246-code-au-dossier-en-campagne.md)

## Contexte

Chaque connexion demandait un code reçu par email : un courriel à attendre
à chaque fois, qui peut tarder ou finir dans les courriers indésirables.
L'APIX veut le code à la première connexion seulement, puis une clé
d'accès : Face ID, l'empreinte, le code de l'appareil. Très sûre, et très
simple pour les agents.

## Décision

**Après le premier code, la clé d'accès.** Sur un appareil qui sait en
créer, l'écran qui suit le code propose « Créer ma clé d'accès » : un geste,
et le système demande Face ID, Touch ID, l'empreinte, Windows Hello ou le
code de l'appareil. « Plus tard » laisse passer ; la prochaine connexion
par code la proposera de nouveau. Une clé déjà sur l'appareil n'est pas
créée deux fois.

**Les fois suivantes, la clé seule.** Sur un appareil qui a déjà servi une
clé, la page de connexion propose d'abord « Se connecter avec ma clé
d'accès », et « Recevoir un code par email » en dessous. Ailleurs, « Se
connecter avec une clé d'accès » se tient sous « Recevoir mon code » : la
clé d'un téléphone à côté, ou une clé synchronisée par iCloud ou Google.

**Le code reste le recours** : un nouvel appareil sans clé synchronisée, une
clé perdue. Il ouvre la session, puis propose la clé de cet appareil.

**Très sûre.**

- La norme WebAuthn : la clé privée ne quitte jamais l'appareil, le serveur
  ne garde que la clé publique. Une clé ne vaut que pour le site qui l'a
  créée : une page qui imite la plateforme ne peut pas s'en servir.
- L'appareil doit avoir reconnu la personne (biométrie ou code), pas
  seulement constaté sa présence.
- Chaque création, chaque connexion répond à un défi de 32 octets tiré au
  hasard, gardé cinq minutes derrière un cookie (`tg_defi`, aux attributs
  de celui de la session) et pris une seule fois : une réponse rejouée ne le
  trouve plus.
- À chaque connexion : la signature, l'origine, le domaine, et le compteur
  de signatures, qui ne doit pas reculer (sinon une copie de la clé
  circule). Une clé synchronisée garde son compteur à 0.
- Aucune attestation n'est demandée : la clé s'ajoute à un compte dont la
  session vient de s'ouvrir par un code, et ne prouve rien de plus.
- La connexion ne nomme aucune clé : rien ne dit au navigateur quels comptes
  existent. L'identifiant du compte que l'appareil garde est une empreinte
  HMAC, qui ne dit rien de la personne.
- Une clé n'ouvre qu'un compte qui se connecte encore : actif, accès ni
  coupé ni fermé. Parti depuis plus de trente jours, l'agent perd ses clés
  avec son mot de passe ; un compte supprimé perd les siennes.
- Les gestes de connexion par clé se comptent par adresse réseau : mille par
  quart d'heure, comme les demandes de code.

**Sans bibliothèque.** La vérification (CBOR, données de l'appareil, clé
publique COSE, signatures ES256, EdDSA et RS256) s'écrit avec la
cryptographie de Node, comme le reste de l'authentification (ADR-0009).

**Le domaine des clés** est celui de `PUBLIC_WEB_URL`, et l'origine
attendue la sienne. La migration 0144 crée deux tables globales, comme les
sessions : `cles_d_acces` et `defis_de_cle`.

## Conséquences

- Les navigateurs réservent les clés d'accès au HTTPS (et à `localhost`) :
  servie en HTTP sur un poste du réseau, la page ne les propose pas, et la
  connexion par code reste.
- Changer le domaine de la plateforme rend les clés existantes
  inutilisables : chaque agent repasse par un code, puis crée la clé du nouveau
  domaine.
- La liste de ses clés, et leur retrait, viendront avec une page du compte.
- L'administration se connecte toujours par mot de passe : aucune clé n'est
  proposée sur sa page de connexion.
