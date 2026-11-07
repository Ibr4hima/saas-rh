# Polices des documents PDF

Fichiers GÉNÉRÉS par `scripts/fetch-pdf-fonts.mjs` — ne pas modifier à la main.

    pnpm --filter @teranga/api fonts:fetch

pdfkit ne lit ni le woff2 ni le SVG : ces TTF sont une copie distincte
de celle du site. Google Sans, la police du site, ne sert plus ici
qu'aux sous-titres des vidéos de démonstration d'APIX Academy.

Arimo et Tinos tiennent la place d'Arial et de Times New Roman, que leur
licence interdit de versionner : mêmes chasses, licence OFL (fichiers
`*-OFL.txt`). Les polices d'origine se déposent à la racine de `assets/`
(cf. `assets/README.md`).

Allura, une écriture manuscrite (OFL), trace les paraphes des
signataires des grilles d'évaluation.

Raleway, Anton et Exo (OFL) sont les polices de la charte de l'APIX,
celles des documents de la DCH : le texte, les titres, le pied de page.

Les pictogrammes du pied de page sont les Material Symbols de l'application,
réduits à cinq icônes (`material-symbols.ttf`, licence Apache 2.0).
