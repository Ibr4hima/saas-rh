# ADR-0094 : Le contrat de stage : sans agent, la personne et le stage renseignés par la DCH

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0085](0085-generer-des-documents.md) et l'[ADR-0087](0087-attestation-de-revenu.md)

## Contexte

L'APIX a fourni le modèle, encore à l'état de brouillon, de son contrat de
stage d'adaptation : trois pages, l'en-tête de la République, les deux
parties, huit articles, puis les signatures. L'APIX y est représentée par
qui dirige la DCH ; la personne y figure avec son état civil (sexe, date et
lieu de naissance, numéro de la carte nationale d'identité, filiation,
adresse), le stage avec la formation suivie, le poste, la durée, les dates,
l'allocation mensuelle et la catégorie. Le contrat se signe avant l'arrivée :
la personne n'est pas encore dans l'application, et « Générer des
documents » partait toujours d'un agent (ADR-0085).

## Décision

**Le contrat de stage se génère sans agent.** Choisi dans la page, il
remplace le choix de l'agent par deux blocs : « Renseigner l'état civil »
(civilité, prénom, nom, date et lieu de naissance, numéro de la CNI, prénom
du père, prénom et nom de la mère, adresse) et « Renseigner le stage »
(formation suivie, poste, date de début, durée en mois, catégorie,
allocation mensuelle TTC en chiffres). L'aperçu vient quand la fiche est
complète, comme pour les saisies de l'ADR-0087. Les documents sans agent
sont listés dans les contrats (`DOCS_SANS_AGENT`) ; la fiche y a son schéma
(`ficheStagiaireSchema`), commun à la page et à l'API.

**Une route à part, en POST** : `POST /v1/documents/generer/contrat_stage`,
la fiche dans le corps, jamais dans l'adresse. Les routes d'un agent
refusent un document sans agent (`documents.sans_agent`), celle-ci un
document d'agent (`documents.avec_agent`). Les droits sont ceux de la page :
qui dirige la DCH. Rien n'est enregistré : la fiche vit dans la page.

**Ce qui se déduit ne se saisit pas.** La civilité donne le sexe, « Fils »
ou « Fille », « dénommé » ou « dénommée ». La fin du stage est la veille du
même quantième, autant de mois plus tard (du 19 août au 18 novembre) ; si ce
quantième n'existe pas, le dernier jour du mois (`finDuStage`, partagée par
la page et l'API). L'allocation s'écrit en lettres puis en chiffres, en
gras, comme la durée : « trois (03) mois ». La catégorie s'imprime en
capitales. La CNI compte treize chiffres ; un stage dure de un à
vingt-quatre mois.

**L'adresse, la formation suivie et le poste sont facultatifs** : laissés
vides, ils s'impriment en pointillés, à remplir à la main.

**Le modèle se reprend mot pour mot**, en Arial (ADR-0090) : « APIX-S.A. »
devient « APIX-SA » (ADR-0088), « en qualité de » s'élide devant une
voyelle, le contrat est fait à Dakar le jour de la génération, en quatre
exemplaires. Qui dirige la DCH représente l'APIX et signe, au genre de son
dossier ; la place vacante laisse un blanc. Le fichier porte le nom de la
personne, sans accents : `contrat-stage-BA-Aida.pdf`.

**Une feuille de plusieurs pages se numérote comme les modèles Word de
l'APIX** : le numéro seul, sur la marge de gauche, à la hauteur du logo du
pied de page ; « Page 1 sur 3 » disparaît. Une feuille d'une page reste sans
numéro.

## Conséquences

- La feuille commune gagne les blocs d'un contrat : l'en-tête de la
  République seul, le titre souligné, le saut de page, les puces, les
  signatures en deux colonnes.
- La file des documents ne le génère pas : personne ne le demande.
- Le dossier de la personne se crée à son arrivée, comme tout dossier ; le
  contrat généré n'y est pas rattaché.
- Un autre document sans agent s'ajoute à `DOCS_SANS_AGENT`, avec sa fiche.
