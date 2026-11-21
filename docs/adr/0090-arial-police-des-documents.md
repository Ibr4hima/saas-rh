# ADR-0090 : Arial, police principale des documents de la DCH, prise là où la machine l'a

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0086](0086-modeles-de-l-apix.md)

## Contexte

L'ADR-0086 avait fait de Google Sans la police principale des documents,
comme dans apix-e-voting. L'APIX retient finalement Arial, celle de ses
modèles Word, et veut Comic Sans MS d'origine pour ce que ses modèles
écrivent avec elle.

Arial (Monotype) et Comic Sans MS (Microsoft) se diffusent avec Windows et
macOS, et par les paquets officiels de Microsoft. Leur licence n'en permet pas
la redistribution hors de ces paquets : des fichiers copiés depuis un dépôt
tiers n'en donnent pas le droit, et les versionner ici en ferait une
redistribution.

## Décision

**Les documents de la DCH sont en Arial ; leur timbre, en Comic Sans MS.** Le
générateur prend ces polices là où la machine les a : déposées dans
`apps/api/assets/` sous leur nom Windows ; à défaut, sur le système
(`C:\Windows\Fonts`, `/System/Library/Fonts/Supplemental`, ou
`/usr/share/fonts/truetype/msttcorefonts` après le paquet Debian et Ubuntu
`ttf-mscorefonts-installer`, qui les télécharge chez Microsoft et en fait
accepter la licence).

**Le dépôt ne versionne ni Arial ni Comic Sans MS.** Sur une machine qui ne
les a pas, Arimo et Comic Relief, libres (OFL) et dessinées aux mêmes
chasses, tiennent leur place : chaque mot garde sa largeur, chaque ligne se
coupe au même endroit ; seul le dessin de quelques lettres diffère. La
résolution se fait coupe par coupe.

**Le certificat d'APIX Academy garde Google Sans**, la police du site.

## Conséquences

- Sur un poste Windows ou macOS, les documents sortent en Arial et en Comic
  Sans MS d'origine sans rien faire ; sur un serveur Linux, une commande
  (`sudo apt install ttf-mscorefonts-installer`) ou quatre fichiers déposés.
- Arimo revient dans `fonts/`, régénéré avec les autres par `fonts:fetch`.
