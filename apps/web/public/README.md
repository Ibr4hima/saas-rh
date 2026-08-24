# Fichiers publics

Servis tels quels à la racine du site (`/logo-apix.svg` → `public/logo-apix.svg`).

## Logo de l'organisation

Déposez ici **`logo-apix.svg`**. Il occupe toute la largeur de la barre
latérale, avec « CAPITAL HUMAIN » juste en dessous, et se réduit dans l'en-tête
mobile et sur l'écran de connexion.

```bash
cp /chemin/vers/votre-logo.svg apps/web/public/logo-apix.svg
```

Le **SVG est le format à privilégier** : net à toutes les tailles, et surtout
réellement transparent — il se pose directement sur la barre, sans plaque
blanche derrière lui. Un `logo-apix.png` est accepté en repli si le SVG est
absent, mais s'il porte un fond blanc, ce fond se verra. Sans aucun des deux
fichiers, l'application affiche l'aplat de marque « CH » — aucune erreur
visible.

Format conseillé : **en largeur** (rapport ~3:1 à 4:1) ; un logo carré
fonctionne aussi, il sera simplement plus petit. En thème sombre, une plaque
blanche est remise automatiquement derrière le logo : sans elle, un logo à
encre foncée disparaîtrait dans le fond.
