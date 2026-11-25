# ADR-0160 : L'import écrit les unités sans faute, et lit le fichier comme la DCH le tient

**Statut** : acceptée · 2026-11-02

## Contexte

Le premier essai sur le vrai fichier de la DCH (ADR-0159) a montré trois
écarts. Les dates d'entrée y sont du texte, au format qu'Excel affiche en
français : « 01-mars-04 ». L'import ne le lisait pas et se rabattait sur la
colonne Ancienneté, en retard sur un fichier qui n'est pas mis à jour chaque
jour. Les agents sans adresse professionnelle portent « NA », signalé comme
une adresse fausse sur chaque ligne. Et les unités que l'import crée d'après
les postes gardaient les fautes du fichier : « Moyens genereaux »,
« Portefeuillle et recouvrement », « Competitivite », « Service Bce »,
« Aménagement et chef de projet ZES diass ». Un nom faux se propage : le
poste du responsable (« Chef du département … ») se compose à partir de ce
nom, et renommer l'unité ensuite ne corrige pas ce poste.

## Décision

**Une date « 01-mars-04 » se lit comme la date qu'elle est** : le mois en
lettres, en français ou en anglais, l'année sur deux ou quatre chiffres
(« 04 » est 2004, « 85 » est 1985). L'ancienneté du fichier ne sert que sans
date d'entrée : la fiche calcule l'ancienneté chaque jour d'après la date
d'entrée.

**« NA », « N/A », « ND », « sans objet » ou « - » valent une case vide**,
sans avertissement. Pour un nombre d'enfants ou d'épouses, « néant » et « - »
gardent leur sens : 0.

**Le nom d'une unité se prend dans le poste tel que le fichier l'écrit**,
virgules et apostrophes comprises, sans le second rôle qui le suit (« … et
chef de projet ZES Diass ») ni l'intérim.

**Il s'écrit sans faute.** Les accents des mots connus reviennent
(« Compétitivité », « Ingénierie urbaine et foncière », « État »),
l'apostrophe perdue aussi (« d’entreprise »), et les villes prennent leur
capitale (« Diass »). Une faute de frappe sur un mot connu se corrige : une
lettre de trop, de moins, changée ou intervertie, jamais dans les deux
dernières, où s'écrivent le pluriel et le féminin ; une lettre triplée
redevient double. Dans un nom d'unité, un mot de trois lettres au plus qui
n'est pas un mot courant est un sigle (« Service BCE »). Les intitulés de
poste suivent les mêmes règles, sans celle des sigles courts.

**Ce que la correction ne trouve pas se corrige dans l'aperçu.** Chaque
unité à créer y a son champ. Le nom corrigé part avec le fichier, l'aperçu
se rejoue, et l'unité naît avec ce nom, le poste de son responsable aussi.
Une unité qui ne peut pas naître, parce qu'une voisine porte déjà ce nom, le
dit dans la liste.

**Les directions ne se créent pas à l'import.** Le fichier les désigne par
leur sigle ou leur nom, et l'import retrouve celles de l'organigramme, à une
faute près (ADR-0159) : leur nom est celui de l'organigramme.

## Conséquences

- Un mot que le dictionnaire ne connaît pas n'est pas corrigé : le champ de
  l'aperçu reste le dernier recours.
- La clé d'une unité à créer tient au nom tiré du fichier : elle reste la
  même d'un aperçu à l'autre, et la correction tient jusqu'à l'import.
- Diass et Sandiara rejoignent la liste des villes, dans la région de Thiès.
