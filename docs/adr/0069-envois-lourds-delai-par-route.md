# ADR-0069 : Les envois lourds : un délai par route

**Statut** : acceptée · 2026-10-12

## Contexte

Une leçon d'APIX Academy est une vidéo de douze minutes au plus, envoyée en
flux jusqu'au disque de l'API. Éprouvée avec une vidéo de douze minutes en
1080p (1,36 Go, 15 Mbit/s) envoyée à 4 Mo/s, le débit d'une bonne connexion
de bureau, elle a été coupée en 408 au bout de 5 min 15.

Node arrête toute requête dont le corps n'est pas arrivé en entier en cinq
minutes (`requestTimeout`). Aucune vidéo qui demandait plus de cinq minutes
d'envoi ne pouvait donc arriver : 1,36 Go à 4 Mo/s, 700 Mo à 2 Mo/s. La RH
recommençait, et échouait de nouveau.

## Décision

1. **Le serveur n'a plus de délai global pour le corps d'une requête.** Les
   en-têtes gardent le leur : une minute.
2. **La porte des corps tient ce délai, route par route.** Tout corps arrive
   en entier en cinq minutes au plus, comme avant ; au-delà, 408 et la
   connexion se ferme.
3. **La vidéo d'une leçon a ses propres délais.** Un envoi lent va à son
   terme ; un envoi qui ne reçoit plus un octet pendant une minute est
   abandonné, et aucun ne dure plus de quatre heures (2 Go à 150 Ko/s). Le
   fichier partiel est effacé, la leçon le dit.
4. **Sur la route de la vidéo, la réponse ferme la connexion.** Refusé avant
   d'être lu, le reste du fichier n'arrive pas pour rien : Node le lirait
   sinon jusqu'au bout pour réutiliser la connexion.
5. **Le filtre d'erreurs n'écrit plus sur une réponse déjà partie** (un corps
   coupé après son 408, dont la lecture échoue ensuite).

## Mesures

Vidéos de douze minutes en 1080p, 15 Mbit/s, sur la base de 3 000 agents :

- Le même envoi à 4 Mo/s aboutit en 5 min 25. Six envois simultanés
  (8,2 Go) passent en 35 s ; la mémoire de l'API reste sous 220 Mo, la
  santé répond en 8 ms et la liste du personnel en 114 ms pendant ce temps.
- Une vidéo de 12 min 00,9 s est acceptée ; 12 min 02 s, 13, 14 et 15 min
  sont refusées (422), avec leur durée dans le message.
- Un fichier annoncé à 2,2 Go est refusé (413) avant le premier octet ; un
  fichier qui n'est pas une vidéo, refusé (422) ; un envoi figé,
  abandonné au bout de 61 s ; un envoi coupé ne laisse aucun fichier
  partiel, et le suivant passe.
- En lecture, une instance sert 100 spectateurs au débit de la vidéo
  (1,7 Gbit/s) sans un retard. À 300, elle plafonne à 2,5 Gbit/s : la
  lecture prend du retard, et les écrans de la RH ralentissent (la liste
  du personnel passe à 1,5 s).

## Conséquences

- Une connexion très lente peut garder un envoi ouvert jusqu'à quatre
  heures. Seule une session habilitée à l'Academy le peut : la porte des
  corps vérifie la session et l'habilitation avant de lire un octet.
- Le stockage local reste celui du développement et de la démonstration :
  chaque spectateur tire la vidéo entière de l'API, sans qualité adaptée à
  sa connexion. La cible reste un fournisseur vidéo.
