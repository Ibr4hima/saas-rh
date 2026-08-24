# Fichiers publics

Servis tels quels à la racine du site (`/logo-apix.png` → `public/logo-apix.png`).

## Logo de l'organisation

Déposez ici `logo-apix.png` : il occupe toute la largeur de la barre latérale,
avec « Capital Humain » juste en dessous, et se réduit dans l'en-tête mobile.
Sans ce fichier, l'application retombe sur l'aplat de marque « CH » — aucune
erreur visible.

```bash
cp /chemin/vers/votre-logo.png apps/web/public/logo-apix.png
```

Format conseillé : PNG à fond transparent, **en largeur** (rapport ~3:1 à 4:1),
600 px de large minimum. Il est affiché en `object-contain` sur une plaque
blanche de 56 px de haut : un logo carré fonctionne aussi, il sera simplement
plus petit.
