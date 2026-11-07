# ADR-0189 : La lettre de demande, jointe par l'agent, lue et reprise par qui traite la demande

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0084](0084-documents-de-la-dch.md), [ADR-0085](0085-generer-des-documents.md) et [ADR-0174](0174-fiches-depuis-le-dossier.md)

## Contexte

Une mise en disponibilité, son renouvellement et une domiciliation bancaire
se demandent par lettre. Les documents qui y répondent la citent : la
décision écrit « Vu la demande de … par lettre en date du … », la
domiciliation reprend le jour où l'agent a donné l'ordre de virement.
Jusqu'ici, l'agent demandait le document sans joindre sa lettre, et la DCH
tapait la date de la demande en établissant le document (ADR-0174).

Une lettre peut être écrite le 2 novembre et remise le 6. La décision cite
la date écrite sur la lettre ; la domiciliation, le jour de l'envoi.

Générer ces documents revenait à qui dirige la DCH (ADR-0085) : un membre de
la DCH qui traitait la demande préparait le document hors de l'application.

## Décision

**Pour ces trois documents, la lettre accompagne la demande.** Dans
« Demander un document », chacun ouvre sa ligne avec « Lettre de demande » :
un PDF de 5 Mo au plus, obligatoire. Les deux décisions y ajoutent « Date de
la lettre », obligatoire, au plus tard aujourd'hui. La domiciliation n'a pas
de date à saisir : elle reprend le jour de l'envoi. « Envoyer ma demande »
attend chaque lettre et chaque date. Une demande porte une seule lettre.

**La lettre se lit là où la demande se traite.** « Lettre de demande »
l'ouvre dans la fenêtre d'aperçu : sur la ligne de la demande dans
« Demandes de documents », en tête de la page du document, et dans « Suivi
de mes demandes » pour l'agent. La lisent l'agent qui l'a jointe, qui dirige
la DCH, qui traite ce document pour la DCH et la personne à qui la demande
est confiée. Elle est chiffrée au repos, comme les pièces des dossiers, et
s'efface avec la demande annulée ou le compte effacé.

**Le document se génère depuis la demande.** « Générer le document », sur la
ligne d'une demande ouverte et dans « Prévisualiser », ouvre la page
« Générer le document » : celle de « Générer des documents », pour ce seul
document et l'agent qui l'a demandé. En tête, le document, l'agent, le jour
de l'envoi et la lettre. La fiche s'ouvre remplie : le dossier de l'agent
(ADR-0174), puis la date de la demande, celle de la lettre pour une
décision, le jour de l'envoi pour la domiciliation. Tout se corrige.

**Qui traite la demande en génère le document, sans « Générer des
documents ».** Le droit tient à la demande : ouverte, de ce document, et
confiée à la personne. Il s'éteint avec elle. Le dossier lu pour la fiche
est celui de l'agent de la demande, et aucun autre ; la fiche doit nommer
cet agent (prénom et nom, sans compter accents et majuscules), un autre nom
est refusé.

## Conséquences

- Migration 0133 : `document_request_lettres`, une lettre par demande,
  chiffrée, sous RLS, journalisée (`audit_piece`), avec la date de la lettre
  pour une décision.
- `POST /document-requests` reçoit les lettres en base64, la limite du corps
  à la mesure de trois lettres. `GET /document-requests/:id` rend une
  demande ; `GET /document-requests/:id/lettre`, sa lettre (`?download=1`
  pour l'enregistrer).
- `POST /documents/generer/:type`, `GET …/agents/:id/fiche` et
  `GET …/preremplissage` acceptent `?demande=` : le chemin de qui traite une
  demande. Sans demande, la génération reste celle de l'ADR-0085.
- La vue d'une demande porte sa lettre (nom, taille, date), jamais son
  contenu.
- Une demande envoyée avant cette décision n'a pas de lettre : la page du
  document reprend le jour de l'envoi.
- La banque et le RIB ne se préremplissent qu'avec l'accès aux données
  sensibles (ADR-0158), comme avant.
- La page de « Générer des documents » devient un composant partagé
  (`GenererDesDocuments`) : la page de la DCH et celle du document d'une
  demande ne peuvent plus diverger.
