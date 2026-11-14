# ADR-0130 : Chaque document a sa cible : la liste ne propose que les agents concernés

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0085](0085-generer-des-documents.md), l'[ADR-0093](0093-attestation-de-depart-a-la-retraite.md) et l'[ADR-0105](0105-conge-de-maternite.md)

## Contexte

Dans « Générer des documents », la recherche de l'agent proposait tout le
personnel, quel que soit le document : un stage pour une attestation de
travail, un agent en activité pour un certificat de travail, un dossier au
genre masculin pour un congé de maternité. Le modèle ne refusait qu'ensuite,
une fois le préremplissage validé. Chaque document s'adresse pourtant à des
agents précis, selon le contrat, le genre, l'âge et la situation du dossier.

## Décision

**Chaque document avec agent a sa cible**, écrite une fois au contrat et
partagée par la page et le serveur :

| Document                                                                     | Cible                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Attestations de travail, de revenu, de congé, de reprise après disponibilité | dossier en activité, sous contrat de travail          |
| Cessation de paiement, reprise de service (congé de maternité)               | les mêmes, au genre féminin                           |
| Attestation de départ à la retraite                                          | les mêmes, à 55 ans au moins                          |
| Attestation de stage                                                         | un stage commencé au dossier, en activité ou non      |
| Certificat de travail                                                        | dossier inactif, sous contrat de travail à son départ |

« Sous contrat de travail » : le contrat qui fait foi n'est pas un stage.
C'est le dernier commencé ; pour un dossier inactif, le dernier commencé avant
le départ. Un dossier sans contrat n'est pas écarté, comme avant.

**La liste ne propose que la cible**, jamais son propre dossier. Un clic sur
le champ l'ouvre sur toute la cible, par nom, avant toute frappe ; l'agent
déjà retenu y est désigné. Un nom ou un matricule la resserre. La mention
« Dossier inactif » ne paraît que là où la cible mêle les deux :
l'attestation de stage.

**L'agent choisi reste d'un document à l'autre** quand la cible du nouveau
document comprend cet agent (d'une attestation de travail à une attestation
de revenu) ; sinon, le champ se vide.

**Le serveur refuse hors de la cible**, en le disant : `documents.not_active`,
`documents.en_activite`, `documents.stage` et `documents.sans_stage`, comme
avant ; `documents.genre` et `documents.age`, nouveaux.

**Le congé de maternité suppose le genre féminin** : un dossier sans genre
est refusé, comme un dossier au genre masculin.

**Le départ à la retraite suppose 55 ans au moins**, l'âge de la retraite
anticipée de l'IPRES ; 60 ans est l'âge ordinaire. L'âge se lit
aujourd'hui, à la date de naissance du dossier ; sans elle, le dossier
n'est pas proposé.

## Conséquences

- `GET /documents/generer/:type/agents?q=` donne la cible, et la situation
  de chaque agent (activité, contrat, stage, genre, âge) : la page en tire
  ce qui reste d'un document à l'autre.
- Un dossier sans genre, ou sans date de naissance, se complète avant de
  recevoir un document de maternité ou de retraite.
- « Demander un document », côté agent, propose toujours toute la liste :
  une demande peut précéder la situation (un certificat de travail se
  demande avant le départ).
