# ADR-0044 : Demander un document : un bloc, une fenêtre, sans précision

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0039](0039-bulletin-de-salaire-avec-ses-mois.md)

## Contexte

La page « Demander un document » montrait tout le formulaire d'emblée, avec
un champ « Précision » pour le motif (banque, visa). « Poser une demande »,
sa voisine des congés, tient en un bloc dont le « + » ouvre la fiche en
fenêtre.

## Décision

**La page s'ouvre comme « Poser une demande ».** Un bloc « Demander un
document » et son « + », qui ouvre la fiche en fenêtre : les documents à
cocher, puis les mois du bulletin s'il en fait partie. Après l'envoi, le
bloc dit combien de demandes sont parties et mène au suivi. Les deux pages
partagent le même bloc.

**Le champ « Précision » disparaît.** Une demande de document part sans
motif.

## Conséquences

- L'ADR-0039 gardait la précision pour le motif : elle n'est plus saisie.
- Les demandes faites avant gardent leur précision, lisible au suivi et
  dans la file de la DCH.
- « Autre document » part sans dire lequel : la DCH ne le sait qu'en le
  demandant à l'agent.
- L'API accepte encore une précision ; l'écran n'en envoie plus.
