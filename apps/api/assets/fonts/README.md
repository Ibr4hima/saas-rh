# Polices des documents PDF

Fichiers GÉNÉRÉS par `scripts/fetch-pdf-fonts.mjs` — ne pas modifier à la main.

    pnpm --filter @teranga/api fonts:fetch

pdfkit ne lit ni le woff2 ni le SVG : le web et les PDF ont chacun leur
copie de Google Sans, dans le format que leur moteur sait ouvrir.
