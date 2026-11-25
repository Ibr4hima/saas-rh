# ADR-0161 : Les intitulés de poste sortent de l'import sans faute, accordés à la personne

**Statut** : acceptée · 2026-11-02

## Contexte

Les 135 intitulés de poste du fichier de la DCH ont été relus un à un. Après
les corrections de l'ADR-0160, il restait des fautes que le dictionnaire ne
voit pas : des sigles écrits en minuscules (« Coordonnateur pli sud »,
« Chargé d'appui au projet ter »), des abréviations (« CHEF DEPART.
TECHNIQUE », « SYST. ELEC »), des mots écornés (« A » pour « à », « ES » pour
« des »), des villes en deux mots (« SAINT LOUIS »), plusieurs écritures
d'une même expression (« passation marchés », « passation de marchés »), et
des intitulés qui ne s'accordent ni entre eux ni avec la personne
(« Conseiller spéciale chargée », « Assistant RH » pour une femme). Deux
fautes cachaient même un poste de responsable : « CHEF DE DPARTEMENT », et
« DIRECTEUR DU GUICHET UNIQUE ET ES PLATEFORMES », dont la direction n'était
pas reconnue.

## Décision

**Les règles de l'ADR-0160 valent aussi pour les intitulés de poste, sigles
courts compris** : un mot de trois lettres au plus qui n'est pas un mot
courant est un sigle (« projet TER », « PLI », « SPV »). Les sigles plus
longs, qui ne se devinent pas, s'ajoutent à la liste (ZFID, ORFA).

**L'intitulé s'écrit comme on l'écrit à la main.** Les abréviations se
développent (« département », « systèmes électroniques »). « A » redevient
« à », sauf la lettre d'une catégorie, et « ES » redevient « des ». La forme
de la société suit son sigle (« APIX SA »), les villes en plusieurs mots
prennent leurs tirets (« Saint-Louis »), et un point cardinal derrière un
sigle prend sa capitale (« PLI Sud »). Une même expression s'écrit d'une
seule façon : « passation des marchés », « relations presse »,
« chauffeur-coursier », « back-office », « chef du service … », « bureau
régional de Kaolack ».

**L'intitulé s'accorde au sexe de la personne** : le métier et les mots qui
s'accordent avec ce métier (« Assistante administrative », « Conseillère
spéciale chargée de… », « Ingénieure financière »), pas ce qui qualifie autre
chose (« Assistante du directeur général », « Cheffe de marché financier »).
« Agent » reste « Agent ». Sans sexe connu, la majorité des mots de
l'intitulé décide.

**Une faute ne cache plus un poste de responsable.** Les mots qui disent la
nature du poste (département, service, directeur…) se reconnaissent à une
lettre près, « DEPART. » se lit département, et « ES » ne compte pas pour
reconnaître une direction.

## Conséquences

- Le poste d'un responsable désigné reste celui que l'organigramme compose
  (« Chef du département Aménagement », ADR-0159) : le second rôle que le
  fichier ajoute n'y figure pas.
- Un intitulé déjà écrit en minuscules et capitales garde son écriture, mais
  s'accorde à la personne.
- Les intitulés abrégés que l'usage admet restent tels quels (« Assistant
  passation des marchés », « Agent contrôle de gestion »).
