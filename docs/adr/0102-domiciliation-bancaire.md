# ADR-0102 : La domiciliation bancaire : la fiche saisie, le RIB saisi deux fois

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0100](0100-decisions-de-disponibilite.md)

## Contexte

L'APIX a fourni le modèle de sa lettre de domiciliation bancaire : qui
dirige la DCH annonce à qui dirige la banque de la personne l'ordre de
virement irrévocable de son salaire, et l'APIX s'engage à l'exécuter. Une page : l'en-tête, le timbre « Le Directeur du Capital
Humain » en Comic Sans MS, l'objet, l'appel, cinq paragraphes et, en bas à
gauche, le destinataire. Le modèle laisse à remplir la civilité et le nom de
la personne, le jour où son contrat a commencé, sa fonction, son type de
contrat, le jour de sa demande, son RIB (« n° SN… »), sa banque, son salaire
mensuel net en lettres et en chiffres, et la qualité de qui dirige la
banque.

## Décision

**La domiciliation se génère sans agent** (ADR-0094, ADR-0100), d'une fiche
en deux blocs. « Renseigner l'agent » : civilité, prénom, nom, fonction,
type de contrat, date de début du contrat. « Renseigner la domiciliation » :
banque, destinataire (Directeur Général ou Directrice Générale), RIB et sa
confirmation, salaire mensuel net, date de la demande. Tout est
obligatoire. Le schéma est dans les contrats (`ficheDomiciliationSchema`).

**La banque se choisit dans la liste de la DCH** (`BANQUES`, vingt banques)
et se nomme selon l'usage : avec l'article (« tenu sur les livres de la
CBAO », « à la BNDE »), sans article pour les marques (« d'Ecobank », « à
Orabank », « de BGFIBank Sénégal »), l'article pris dans le nom (« de La
Banque Agricole »). Seul le nom va en gras, comme sur le modèle.

**Le RIB a vingt-quatre caractères et commence par « SN »**, déjà écrit dans
le champ ; les vingt-deux chiffres qui suivent se groupent à la frappe comme
sur le relevé, code de la banque, du guichet, numéro du compte et clé
(« SN012 01001 036123456789 54 »), et s'impriment ainsi. **Il se saisit deux
fois, comme un mot de passe** : « Valider » masque la première saisie et
ouvre la seconde, où coller et déposer sont refusés ; la lettre ne se
génère que si les deux sont identiques. « Modifier » rouvre la première et
vide la seconde.

**Ce qui s'accorde vient de la fiche et de l'organigramme.** La civilité
accorde « l'intéressée » et « envers elle » ; le destinataire, l'appel, la
formule de politesse et le destinataire en bas de page (« Madame la
Directrice Générale de la CBAO ») ; le dossier de qui dirige la DCH, le
timbre. Le salaire s'écrit en lettres puis en chiffres, « (650 000) francs
CFA » en gras, comme sur le modèle.

**Une page, aux retraits du modèle** : Arial 12 points, le texte à 40 points
de la marge de gauche. À droite, il va 8 points plus loin que sur le modèle,
pour que la formule de politesse tienne sur sa première ligne jusqu'à
« considération », à l'appel masculin comme féminin.

**Les coquilles se corrigent** (ADR-0095) : « À » accentué devant le
destinataire ; l'espace double de « l'ordre de virement » ; les virgules de
l'incise (« que Madame Awa DIOP, qui fait partie de notre personnel… ») et
de la date de la demande (« nous a donné, le 15 octobre 2026, l'ordre ») ;
la virgule après la banque, devant « toutes sommes » ; « la fonction
d'Assistante de direction », élidée devant une voyelle ; l'espace insécable
de « 25 % » et « 75 % » ; les accords ; « Sénégal » aligné sur le
destinataire.

## Conséquences

- La feuille prend un retrait à droite pour les paragraphes, un retrait pour
  le timbre ; le bloc en bas à gauche, une police, un retrait et une
  étiquette (« À »).
- Une banque s'ajoute à la liste avec la forme que l'usage lui donne.
