# ADR-0087 : L'attestation de revenu : le salaire saisi, le montant en chiffres et en lettres

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0086](0086-modeles-de-l-apix.md)

## Contexte

L'APIX a fourni le modèle de son attestation de revenu : la mise en page de
l'attestation de travail, le numéro « /PR/SG/APIX/DG/DCH », le timbre « Le
Directeur du Capital Humain », un corps où atteste qui dirige la DCH, et le
salaire net mensuel, « ……(……) francs CFA ». Le dossier ne porte pas le
salaire : la paie le connaît, l'application non.

Sur le modèle de l'attestation de travail, le timbre disait « Le Directeur
Général Adjoint » quand le corps fait attester la direction générale.
L'APIX a tranché pour la direction générale.

## Décision

**La DCH saisit le salaire avant de générer.** Sur « Générer des
documents », un document qui demande un salaire ajoute un bloc, « Saisir le
salaire net mensuel », après le choix de l'agent. L'aperçu vient quand la
frappe se pose et suit chaque correction ; « Télécharger » se retire tant
qu'un montant en cours de frappe ne s'y lit pas encore. Le salaire ne
s'enregistre nulle part et ne passe pas d'un agent à l'autre.

**Le montant s'écrit en chiffres, puis en lettres** : « 250 000 (deux cent
cinquante mille) francs CFA ». La conversion est écrite dans le dépôt et
testée, en orthographe traditionnelle, celle des actes : « et » devant un et
onze, quatre-vingts et cents au pluriel quand rien ne les suit, mille
invariable. Des bibliothèques le font ; une dépendance pour quelques
dizaines de lignes, dont l'orthographe se vérifierait de toute façon, ne
vaut pas la peine.

**Le salaire part dans le corps d'un POST**, `POST
/v1/employees/:id/generer/:type`, jamais dans l'adresse : les journaux des
serveurs gardent les adresses. La page lit tous ses aperçus par cette route ;
le GET reste pour les documents sans saisie. Un salaire est un entier, de 1
à 999 999 999 francs CFA ; sans lui, l'attestation de revenu est refusée
(`documents.salaire`).

**L'attestation de revenu reprend le modèle**, mot pour mot, sur la feuille
de l'attestation de travail. Qui atteste dirige la DCH, un blanc à remplir à
la main si la place est vacante ; les accords, timbre compris, suivent son
dossier. Le montant n'est pas en gras, comme sur le modèle. Mêmes règles
que l'attestation de travail : un agent en activité, pas un stage.

**Le timbre de l'attestation de travail nomme qui atteste**, qui dirige le
sommet de l'organigramme : « Le Directeur Général », « La Directrice
Générale », selon son dossier.

**La file des documents ne génère que l'attestation de travail** : elle n'a
pas de quoi saisir un salaire. Une demande d'attestation de revenu s'y traite
comme un document préparé hors de l'application ; le PDF se génère depuis
« Générer des documents ».

## Conséquences

- Les modèles partagent leurs mots (`redaction.ts`), leur lecture du dossier
  (`dossier.ts`) et la mise en page des attestations (`feuille.ts`) : une
  attestation de plus apporte ses textes.
- Une saisie de plus, pour un modèle à venir, s'ajoute au même corps
  (`saisiesDuDocumentSchema`) ; chaque modèle exige les siennes.
- Le montant n'est pas rapproché de la paie : la DCH le vérifie avant de
  signer.
