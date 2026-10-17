# Polices des documents PDF

Fichiers GÉNÉRÉS par `scripts/fetch-pdf-fonts.mjs` — ne pas modifier à la main.

    pnpm --filter @teranga/api fonts:fetch

pdfkit ne lit ni le woff2 ni le SVG : le web et les PDF ont chacun leur
copie de Google Sans, dans le format que leur moteur sait ouvrir.

Comic Relief tient la place de Comic Sans MS, que sa licence interdit de
versionner : mêmes chasses, licence OFL (fichiers `*-OFL.txt`). Les
fichiers d'origine se déposent à la racine de `assets/` (cf.
`assets/README.md`).
