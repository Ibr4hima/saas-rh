# Fichiers publics

Servis tels quels à la racine du site (`/logo-apix.png` → `public/logo-apix.png`).

## Logo de l'organisation

Déposez ici `logo-apix.png` : il s'affiche dans la barre latérale et l'en-tête
mobile. Sans ce fichier, l'application retombe sur la tuile « T » — aucune
erreur visible.

```bash
cp /chemin/vers/votre-logo.png apps/web/public/logo-apix.png
```

Format conseillé : PNG à fond transparent, carré ou proche, 256 px minimum
(il est affiché en 28–32 px, `object-contain`).
