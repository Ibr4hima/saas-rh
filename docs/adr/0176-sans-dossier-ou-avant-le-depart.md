# ADR-0176 : Certificat de travail et attestation de stage, sans dossier ou avant le départ

**Statut** : acceptée · 2026-11-06 · précise les [ADR-0089](0089-attestation-de-stage.md), [ADR-0091](0091-certificat-de-travail.md), [ADR-0130](0130-cible-des-documents.md) et [ADR-0137](0137-documents-demandables.md)

## Contexte

Le certificat de travail ne se générait que pour un dossier inactif : il se
délivre au départ (ADR-0091). L'attestation de stage, que pour un stage
enregistré au dossier ; celle d'un stage en cours se génère déjà, jusqu'au
dernier jour prévu au contrat (ADR-0089). Deux cas restaient sans réponse :

- une personne partie avant l'arrivée de l'application, il y a dix ans par
  exemple, revient demander son certificat de travail ; un stage s'est fait
  sur un contrat établi d'une fiche (ADR-0094), sans dossier. Faute de
  dossier, la DCH ne pouvait rien générer ;
- un agent va partir, au terme de son CDD ou après sa démission : la DCH veut
  un certificat prêt pour le dernier jour, pas après.

## Décision

**Le document demande d'abord si la personne a un dossier dans
l'application.** Le certificat de travail et l'attestation de stage
s'ouvrent sur la question « Existe-t-il un dossier de la personne dans
l'application ? », Oui par défaut.

- **Oui** : l'agent se choisit dans la cible du document, comme avant.
- **Non** : la DCH renseigne une fiche avec ce que le document imprime : la
  civilité, le prénom, le nom, le premier et le dernier jour, le poste
  occupé ; pour le certificat, le dernier poste occupé et sa catégorie. Tout
  est obligatoire. Le premier jour n'est pas à venir ; le dernier ne le
  précède pas, et peut être à venir pour un départ déjà prévu. La fiche part à
  l'API, qui la valide. Signe le document la même personne que pour un agent :
  qui dirige le sommet de l'organigramme pour le certificat, qui dirige la DCH
  pour l'attestation. Les deux documents partagent la fiche : ce qui est saisi
  pour l'un se retrouve dans l'autre.

**Le certificat se prépare avant le départ.** Sa cible devient tout dossier
sous contrat de travail, en activité ou non. Pour un agent encore en poste, la
DCH saisit le « Dernier jour de travail » que prévoit le départ, et le
certificat va du début de l'ancienneté à ce jour-là. Sans lui, pas de
certificat (`documents.fin`) ; un dernier jour avant le premier est refusé
(`documents.fin_avant_le_debut`). Pour un dossier inactif, le dernier jour
reste celui du départ, et la saisie ne le remplace pas. La section du
certificat s'intitule « Renseigner l'emploi ».

**Le certificat se demande toujours une fois parti.** « Demander un
document » garde la cible d'avant : les dossiers inactifs, pendant les trente
jours où le portail reste ouvert. Un agent en poste demande une attestation
de travail ; la DCH prépare son certificat sans demande.

## Conséquences

- `POST /documents/generer/:type` reçoit aussi la fiche du certificat de
  travail ou de l'attestation de stage d'une personne sans dossier ; le nom du
  fichier vient du nom de la personne, comme pour les contrats.
- Pour le certificat, la cible de « Générer des documents » et celle de
  « Demander un document » ne sont plus les mêmes.
- Un certificat préparé avant le départ porte la date du jour où il est
  généré, et un dernier jour à venir. Si le départ change, la DCH le génère à
  nouveau.
- Une fiche n'enregistre rien : la personne sans dossier n'entre pas dans le
  personnel.
