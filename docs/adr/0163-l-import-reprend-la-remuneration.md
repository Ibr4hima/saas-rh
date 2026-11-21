# ADR-0163 : L'import reprend la rémunération, la banque, l'IPRES et la filiation

**Statut** : acceptée · 2026-11-02

## Contexte

L'import laissait de côté quinze colonnes du fichier de la DCH (ADR-0159) :
la rémunération, la banque et l'IPRES, à saisir sur la fiche, sauf la prime
de transport (ADR-0162), et la filiation, dont le contenu restait à
confirmer (ADR-0158). Le fichier actuel ne les remplit pas encore. La DCH
va le compléter, puis le renvoyer : ce qu'il porte doit arriver sur la fiche
sans être recopié à la main, agent par agent.

## Décision

**Ces quinze colonnes s'importent.** Les montants, le nombre de parts, la
banque, le RIB, la domiciliation et le numéro IPRES vont dans la
rémunération de la fiche, « Fils/Fille » dans sa filiation. À la création
comme au réimport : un changement se liste dans l'aperçu (« Salaire de
base : 450 000 F CFA → 500 000 F CFA »), et une case vide n'efface rien.

**Chaque valeur se lit comme la DCH l'écrit :**

- les montants, comme la prime de transport : 450000, « 450 000 »,
  « 450.000 FCFA » ;
- le nombre de parts, de 1 à 5 par demi-part : « 2,5 » ou « 2.5 parts » ;
- la banque, l'une des banques de la liste (ADR-0102), par son nom, son
  sigle (« BHS ») ou son ancien nom (« CNCAS » pour La Banque Agricole),
  fautes de frappe comprises : « Ecobank Sénégal » est Ecobank ;
- le RIB, « SN » puis vingt-deux chiffres, avec ou sans espaces : le « SN »
  oublié revient, et un IBAN donne son RIB. Un RIB qu'Excel garde comme un
  nombre a perdu ses derniers chiffres : il est écarté ;
- les autres avantages, la domiciliation et le numéro IPRES, tels quels.

**La filiation se lit comme l'état civil l'écrit** : « Fils de Moussa et de
Awa Diop », « Moussa Ndiaye et Awa Diop », « Moussa / Awa Diop ». Le premier
nom est celui du père, dont seul le prénom reste : son nom de famille est
celui de l'agent. Le second est celui de la mère : son prénom, puis son
nom, au dernier mot. Un seul nom est celui du père. « Fils » ou « Fille »
seul compte pour vide : le sexe a sa colonne.

**Ce qui ne se lit pas est écarté et signalé**, et le reste de la ligne
s'importe (ADR-0159).

**La rémunération reste réservée à l'accès aux données sensibles**
(ADR-0158). Sans cet accès, ses colonnes ne s'importent pas, et l'aperçu
les nomme une fois, en tête, au lieu de le redire sur chaque ligne. La
filiation n'est pas une donnée sensible : elle s'importe.

## Conséquences

- Plus aucune colonne n'attend d'être saisie sur la fiche, sauf la date et
  le motif de sortie : un départ ferme le dossier, avec les garde-fous de
  la fiche (ADR-0159).
- La DCH n'a pas encore confirmé ce qu'elle écrit dans « Fils/Fille ». Une
  filiation qui ne se lit pas est signalée sur sa ligne : le premier fichier
  rempli dira s'il faut lire d'autres écritures.
