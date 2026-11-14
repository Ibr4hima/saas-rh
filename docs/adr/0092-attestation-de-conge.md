# ADR-0092 : L'attestation de congé : les dates saisies, la reprise au premier jour ouvré

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0091](0091-certificat-de-travail.md)

## Contexte

L'APIX a fourni le modèle, encore à l'état de brouillon, de son attestation
de congé : la mise en page des autres attestations, le numéro
« /PR/SG/APIX/DG/DCH », le timbre « Le Directeur du Capital Humain », puis :
l'agent, « … (poste) …, jouira de ses congés administratifs à partir du … »,
et « reprendra service le (jour de semaine et date complète : mercredi 30
septembre 2026) ». Le dossier ne porte pas ces dates : la DCH les saisit.

## Décision

**La DCH saisit le premier et le dernier jour du congé**, comme on pose un
congé dans l'application (« Du », « Au (inclus) ») : deux blocs, « Saisir la
date de début du congé » et « Saisir la date de fin du congé », chacun une
date. La fin ne se choisit pas avant le début ; à rebours ou incomplètes, les
dates sont refusées (`documents.dates`).

**L'attestation dit la reprise de service, le premier jour ouvré après le
dernier jour du congé** : ni samedi, ni dimanche, ni férié du calendrier
qu'administre la DCH. Les fériés de la période sont semés avant d'être lus,
comme pour une demande de congé. La reprise porte son jour de la semaine,
comme le demande le modèle : « reprendra service le mercredi 30 septembre
2026 ».

**Le modèle se reprend mot pour mot** : qui atteste dirige la DCH, au genre de
son dossier, timbre compris ; le poste en apposition, omis si le dossier n'en
porte pas ; les noms et les dates en gras. Le titre prend son accent :
« ATTESTATION DE CONGÉ ». Mêmes règles que l'attestation de travail : un
agent en activité, sous contrat de travail.

## Conséquences

- Générer une attestation de congé peut poser au calendrier les fériés d'une
  année que personne n'avait encore ouverte, comme le ferait une demande de
  congé.
- Les dates ne sont pas rapprochées des congés posés dans l'application : la
  DCH les vérifie avant de signer.
- La file des documents ne la génère pas (ADR-0087).
