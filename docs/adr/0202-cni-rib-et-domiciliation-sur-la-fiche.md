# ADR-0202 : Sur la fiche d'un agent, la CNI et le RIB se tapent en chiffres, la domiciliation se dit par oui ou non

**Statut** : acceptée · 2026-11-08 · précise les [ADR-0158](0158-la-fiche-recoit-le-fichier-de-la-dch.md), [ADR-0163](0163-l-import-reprend-la-remuneration.md) et [ADR-0201](0201-cni-seule-piece-du-dossier.md)

## Contexte

Dans « Nouvel employé » et « Modifier la fiche », le numéro de la pièce et
le RIB se tapaient en texte libre : des lettres passaient, et une erreur ne
se voyait qu'à l'enregistrement. La génération de documents les saisit déjà
mieux : la CNI en chiffres groupés comme sur la carte, le RIB saisi deux
fois avec « SN » déjà écrit ([ADR-0102](0102-domiciliation-bancaire.md),
[ADR-0174](0174-fiches-depuis-le-dossier.md)). La domiciliation était un
texte libre, alors que la DCH n'y attend qu'un oui ou un non.

## Décision

**Le numéro de la pièce ne prend que des chiffres**, treize au plus, groupés
à la frappe comme sur la carte (« 1 234 1975 00123 »). Quitté incomplet, il
passe en rouge, sans message, et retient l'enregistrement tant qu'il l'est.
Un passeport enregistré avant l'ADR-0201 ne s'y recopie pas : le champ
reste vide, et un numéro saisi le remplace par une CNI.

**Le RIB se saisit deux fois, comme pour la domiciliation bancaire.** « SN »
est déjà écrit, les vingt-deux chiffres se groupent comme sur le relevé.
« Valider » masque le premier et ouvre la confirmation, qui se tape sans
coller ; « Modifier » rouvre le premier et vide la confirmation. Le RIB ne
s'enregistre que saisi deux fois à l'identique : une saisie commencée
retient l'enregistrement, des chiffres vidés effacent le RIB. Un RIB déjà
enregistré arrive validé et confirmé. La fiche et la génération de
documents partagent les mêmes champs.

**La domiciliation se dit par oui ou par non** : le salaire de l'agent
est-il domicilié à sa banque. La fiche propose « Oui » ou « Non » ; tant
que rien n'est choisi, rien n'est dit. L'import lit « Oui » et « Non »,
corrige « O » et « N », et écarte tout autre texte en le signalant.

**« Banque et IPRES » se range par paires** : la banque et la domiciliation,
le RIB et sa confirmation, puis le numéro IPRES sur toute la ligne. Dans
« Rémunération », le nombre de parts fait la paire avec le dernier montant,
et les autres avantages prennent toute leur ligne.

## Conséquences

- La migration 0135 ajoute la colonne `salaire_domicilie` : un « oui » ou
  un « non » déjà saisi s'y reporte, un autre texte attend d'être dit sur
  la fiche. L'ancienne colonne `domiciliation` reste le temps d'une version
  sans être lue ([ADR-0010](0010-conventions-schema.md)), puis partira.
- L'API n'accepte plus de texte pour la domiciliation : oui, non, ou rien.
- Le numéro de la CNI des fiches de la génération de documents perd aussi
  son message « Treize chiffres attendus » : incomplet, il passe en rouge.
- Les listes de l'état civil et la direction affectée ne montrent plus de
  tiret quand rien n'est choisi : « Choisir », « Choisir une situation »,
  « Choisir un pays », « Choisir une direction ».
