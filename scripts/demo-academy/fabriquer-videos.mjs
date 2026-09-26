#!/usr/bin/env node
/**
 * Fabrique les vidéos de démonstration d'APIX Academy.
 *
 * Inutile pour charger la démonstration — les vidéos sont déjà dans
 * `videos/`. Ce script dit seulement COMMENT elles ont été faites, pour qu'on
 * puisse les refaire si un titre change dans `formations.mjs`.
 *
 * Chaque vidéo est une carte-titre : le fond bleu de la marque, la famille,
 * le titre de la leçon, sa formation, sa place dans le programme, et une
 * barre qui avance d'un bout à l'autre sur la durée exacte de la leçon.
 * Deux images par seconde, sans son : quelques dizaines de kilo-octets par
 * minute, et une lecture qui ressemble à une vraie.
 *
 * Usage : FFMPEG=/chemin/vers/ffmpeg node scripts/demo-academy/fabriquer-videos.mjs
 * (ffmpeg doit être compilé avec libass — c'est le cas des versions courantes.)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATIONS, fichierVideo } from './formations.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'videos');
const POLICES = resolve(ICI, '../../apps/api/assets/fonts');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const FAMILLES = {
  bureautique: 'BUREAUTIQUE',
  digital: 'DIGITAL ET INFORMATIQUE',
  economie: 'ÉCONOMIE',
  droit: 'DROIT ET FISCALITÉ',
  metier: 'MÉTIER DE L’APIX',
  management: 'MANAGEMENT',
  projets: 'GESTION DE PROJET',
  communication: 'COMMUNICATION',
  langues: 'LANGUES',
  conformite: 'CONFORMITÉ',
};

/** ASS n'aime ni les accolades ni les retours à la ligne dans un texte. */
const ass = (t) => t.replace(/[{}]/g, '').replace(/\n/g, ' ');

function sousTitres({ famille, titre, formation, place, duree }) {
  const ms = duree * 1000;
  // La barre : un rectangle dessiné, dont la découpe s'élargit sur toute la
  // durée — c'est libass qui l'anime, image par image.
  const rect = 'm 80 474 l 880 474 880 478 80 478';
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 960
PlayResY: 540
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sur,Google Sans,30,&H00FFE3C6,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,3,0,1,0,0,7,0,0,0,1
Style: Titre,Google Sans,${titre.length > 38 ? 70 : 88},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Sous,Google Sans,38,&H00F5E6D8,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Pied,Google Sans,27,&H00E0C8B0,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Barre,Google Sans,10,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.00,Sur,,0,0,0,,{\\pos(80,150)}APIX ACADEMY  ·  ${famille}
Dialogue: 0,0:00:00.00,9:59:59.00,Titre,,0,0,0,,{\\pos(80,180)}${ass(titre)}
Dialogue: 0,0:00:00.00,9:59:59.00,Sous,,0,0,0,,{\\pos(80,282)}${ass(formation)}
Dialogue: 0,0:00:00.00,9:59:59.00,Sous,,0,0,0,,{\\pos(80,318)\\1a&H40&}${ass(place)}
Dialogue: 0,0:00:00.00,9:59:59.00,Pied,,0,0,0,,{\\pos(80,436)}Vidéo de démonstration — à remplacer par l’enregistrement de la leçon
Dialogue: 0,0:00:00.00,9:59:59.00,Barre,,0,0,0,,{\\pos(0,0)\\1a&HC0&\\p1}${rect}{\\p0}
Dialogue: 1,0:00:00.00,9:59:59.00,Barre,,0,0,0,,{\\pos(0,0)\\clip(80,470,80,482)\\t(0,${ms},\\clip(80,470,880,482))\\p1}${rect}{\\p0}
`;
}

mkdirSync(SORTIE, { recursive: true });
const travail = mkdtempSync(join(tmpdir(), 'academy-'));
try {
  for (const f of FORMATIONS) {
    let numero = 0;
    f.modules.forEach((m, i) => {
      m.lessons.forEach((l, j) => {
        numero += 1;
        const ficAss = join(travail, 'lecon.ass');
        writeFileSync(
          ficAss,
          sousTitres({
            famille: FAMILLES[f.category],
            titre: l.title,
            formation: f.title,
            place: `Module ${i + 1}  ·  Leçon ${numero}`,
            duree: l.duree,
          }),
        );
        const sortie = join(SORTIE, fichierVideo(f, i, j));
        // Le filtre `subtitles` lit ses chemins dans sa propre syntaxe : on
        // se place dans le répertoire de travail pour n'y passer que des noms.
        execFileSync(
          FFMPEG,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            `gradients=s=960x540:c0=0x00325f:c1=0x0a6cc2:x0=0:y0=0:x1=960:y1=540:speed=0:r=2:d=${l.duree}`,
            '-vf',
            `subtitles=lecon.ass:fontsdir=${POLICES}`,
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-tune',
            'stillimage',
            '-crf',
            '32',
            '-g',
            '240',
            '-pix_fmt',
            'yuv420p',
            '-an',
            '-movflags',
            '+faststart',
            sortie,
          ],
          { cwd: travail, stdio: 'inherit' },
        );
        console.log(`✓ ${fichierVideo(f, i, j)}  ${l.title}`);
      });
    });
  }
} finally {
  rmSync(travail, { recursive: true, force: true });
}
