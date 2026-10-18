# Fichiers publics

Servis tels quels à la racine du site (`/logo-apix.svg` → `public/logo-apix.svg`).

## Logo de l'organisation

Déposez ici **`logo-apix.svg`**. Il se tient en tête du menu, en ses
couleurs, posé à même le fond de la page (ADR-0115), et se réduit dans
l'en-tête du téléphone et sur l'écran de connexion.

```bash
cp /chemin/vers/votre-logo.svg apps/web/public/logo-apix.svg
```

Le **SVG est le format à privilégier** : net à toutes les tailles, et surtout
réellement transparent : il se pose directement sur le fond, sans plaque
derrière lui. Un `logo-apix.png` est accepté en repli si le SVG est absent,
mais il doit être transparent lui aussi : un fond blanc se verrait sur le gris
de la page, et deviendrait un rectangle blanc en thème sombre. Sans aucun des
deux fichiers, l'application affiche « CH » à sa place, sans erreur
visible.

Format conseillé : **en largeur** (rapport ~3:1 à 4:1) ; un logo carré
fonctionne aussi, il sera simplement plus petit. En thème sombre, le logo
passe au blanc pur : un logo à encre foncée disparaîtrait dans le fond.
