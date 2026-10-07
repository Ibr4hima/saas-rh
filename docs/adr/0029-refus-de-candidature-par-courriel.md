# ADR-0029 : Le refus d'une candidature part par courriel

**Statut** : acceptée · 2026-10-07

## Contexte

Les boutons « Rejeter » et « Présélectionner » du dossier de candidature
n'agissaient pas : la route existait, mais rien ne disait ce que le geste
déclenchait. Un candidat écarté n'apprenait jamais la décision.

Les candidatures sont chiffrées au repos (0079) : la base ne voit ni le nom
ni l'adresse d'un candidat en clair. La file des courriels, elle, garde
l'adresse du destinataire en clair (0015).

## Décision

**Rejeter, c'est répondre.** Une candidature rejetée vaut au candidat un
courriel de refus, mis en file dans la transaction du geste. Le dossier
demande d'abord confirmation et nomme le prénom et l'adresse qui recevront
le courriel.

**Le courrier.** Objet « Votre candidature au poste de … ». Il remercie,
dit que le dossier a été étudié avec attention et n'a pas été retenu, le
profil ne correspondant pas entièrement aux critères du poste, invite à
suivre les prochaines offres et souhaite bonne continuation. Signé de la
Direction du Capital Humain, avec la référence de l'offre. Ni bouton ni
lien : le candidat n'a pas de compte, rien ne l'attend ailleurs.

**L'adresse ne s'écrit pas en clair.** Le courriel de refus (`kind =
'candidature_refusee'`) ne recopie pas l'adresse : `recipient` reste vide
(migration 0094), `subject_id` désigne la candidature, et l'expéditeur lit
l'adresse chiffrée dans la candidature au moment d'envoyer. Le corps,
chiffré, s'efface au départ comme les autres. Une fois parti, le courriel
ne garde rien du candidat.

**Une seule réponse.** Rejeter une candidature déjà rejetée ne renvoie
rien. Une candidature rejetée ne se rouvre plus (409) : le candidat a reçu
la réponse. Supprimée ou rouverte avant le départ, le courriel est annulé.

## Conséquences

- La présélection reste à décider : le bouton n'agit toujours pas.
- La fiche du dossier et sa carte montrent « Rejetée ».
- Sans serveur de courrier configuré, la candidature est rejetée sans
  courriel, comme les autres envois.
- Échap et Tab ne s'adressent plus qu'à la fenêtre du dessus : une
  confirmation ouverte sur un dossier se ferme seule.
