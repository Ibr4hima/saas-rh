# ADR-0091 : Le certificat de travail : l'emploi d'un dossier inactif, la catégorie saisie

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0087](0087-attestation-de-revenu.md)

## Contexte

L'APIX a fourni le modèle de son certificat de travail : la mise en page des
attestations, le numéro « /PR/SG/APIX/DG/DCH », le timbre « Le Directeur
Général », un paragraphe où qui dirige l'APIX certifie l'emploi de l'agent,
« sur la période allant du … au …, en qualité de … », puis la catégorie du
poste dans la Convention Collective du Commerce. Le dossier porte l'emploi ;
il ne porte pas la catégorie.

Le modèle place la catégorie avant le mot (« classé à la XXX catégorie »), en
rouge : deux erreurs du brouillon, d'après l'APIX.

## Décision

**La DCH saisit la catégorie avant de générer**, comme le salaire de
l'attestation de revenu : un bloc « Saisir la catégorie du poste », après le
choix de l'agent, un texte de quarante caractères au plus (« 7B », « M2 »). La
phrase devient « Ce poste de … est classé à la catégorie 7B de la Convention
Collective du Commerce. », en noir. Les lettres de la catégorie s'impriment en
capitales, quelle que soit la saisie, et le champ les montre ainsi. Sans
catégorie, le certificat est refusé (`documents.categorie`).

**Les saisies se déclarent par document** (`saisiesDe`) : la page pose un bloc
par saisie demandée, dans l'ordre déclaré, et ne montre l'aperçu qu'une fois
toutes remplies. Elles partent ensemble dans le corps du POST.

**Le certificat se délivre au départ** : le dossier doit être inactif. Un
dossier en activité relève de l'attestation de travail
(`documents.en_activite`), un stage de l'attestation de stage
(`documents.stage`).

**L'emploi va du début de l'ancienneté au dernier jour d'activité.** Le
dernier jour est celui que porte le dossier (son départ) ; le premier, le
début de l'ancienneté à ce jour-là (ADR-0083), qui ne compte pas un stage, à
défaut l'embauche. Le poste est le dernier occupé pendant cet emploi ; la
phrase de la catégorie le reprend.

**Qui certifie dirige le sommet de l'organigramme**, au genre de son dossier,
timbre compris : « Directrice Générale de la Société APIX-SA ». « APIX-S.A. »
devient « APIX-SA » (ADR-0088). Les noms et les dates sont en gras, comme sur
le modèle ; la catégorie ne l'est pas.

## Conséquences

- La file des documents ne génère pas le certificat : une demande s'y traite
  comme un document préparé hors de l'application (ADR-0087).
- Après un départ, un retour puis un nouveau départ, le certificat cite le
  dernier emploi, comme l'ancienneté le compte.
