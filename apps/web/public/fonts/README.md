# Police d'icônes

`material-symbols-outlined.subset.woff2` — **Material Symbols Outlined**
(Google), sous licence Apache 2.0, réduit aux seules icônes employées par
l'application (cf. `components/icon-font.manifest.json`).

Le fichier est versionné volontairement : une police d'icônes chargée depuis un
CDN et bloquée par un réseau filtrant n'affiche pas des icônes ternes, elle
affiche le nom des ligatures en toutes lettres dans le menu.

Régénérer après toute modification de `ICON_NAMES` (`components/icons.tsx`) :

```bash
pnpm --filter @teranga/web icons:fetch
```
