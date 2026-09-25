#!/usr/bin/env node
/**
 * Charge deux formations de démonstration dans APIX Academy :
 *   · Microsoft PowerPoint (Bureautique) — 3 modules, 8 leçons, 2 supports ;
 *   · Macroéconomie (Économie) — 3 modules, 8 leçons, 3 supports.
 *
 * Tout passe par l'API, comme si la RH le faisait à l'écran : création,
 * modules, leçons, dépôt des vidéos, supports PDF, banque de questions de
 * l'évaluation finale, publication. Rien n'est
 * écrit directement en base — les règles (12 minutes au plus, formation
 * complète avant publication) s'appliquent donc exactement comme en vrai.
 *
 * Usage :
 *   node scripts/seed-academy.mjs [http://localhost:3001]
 *
 * Le compte utilisé doit être RH ou administrateur :
 *   ACADEMY_EMAIL=… ACADEMY_PASSWORD=… node scripts/seed-academy.mjs
 * (par défaut, le compte de démonstration demo@apix.sn). Si ce compte
 * appartient à plusieurs organisations, préciser ACADEMY_ORG=<slug>.
 *
 * Relancer le script ne crée pas de doublon : une formation qui porte déjà
 * le même titre est laissée telle quelle — sauf si elle n'a pas encore de
 * questions, auquel cas elle reçoit sa banque d'évaluation.
 *
 * Pour les retirer ensuite : Gérer le catalogue › la formation ›
 * « Retirer du catalogue », puis « Supprimer ».
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATIONS, fichierVideo } from './demo-academy/formations.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? 'http://localhost:3001') + '/v1';
const EMAIL = process.env.ACADEMY_EMAIL ?? 'demo@apix.sn';
const MOT_DE_PASSE = process.env.ACADEMY_PASSWORD ?? 'MotDePasseSolide123!';
const ORGANISATION = process.env.ACADEMY_ORG;

let cookie = '';

async function appel(methode, chemin, corps, { type } = {}) {
  const binaire = Buffer.isBuffer(corps);
  const res = await fetch(chemin.startsWith('http') ? chemin : BASE + chemin, {
    method: methode,
    headers: {
      ...(corps !== undefined
        ? { 'Content-Type': type ?? (binaire ? 'application/octet-stream' : 'application/json') }
        : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: corps === undefined ? undefined : binaire ? corps : JSON.stringify(corps),
  });
  const posee = res.headers.get('set-cookie');
  if (posee) cookie = posee.split(';')[0];
  const texte = await res.text();
  const donnees = texte ? JSON.parse(texte) : undefined;
  if (!res.ok) {
    const detail = donnees?.detail ? ` — ${donnees.detail}` : '';
    throw new Error(`${methode} ${chemin} → ${res.status} : ${donnees?.title ?? texte}${detail}`);
  }
  return donnees;
}

// ———————————————————————————— un support PDF lisible

/**
 * Les polices standard du PDF lisent le WinAnsi, pas l'UTF-8 : un « é » ou
 * un « ’ » doit y être écrit par son code, en octal. Les caractères propres
 * à Windows-1252 (apostrophe courbe, tiret cadratin, œ…) ont leur table.
 */
const CP1252 = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
  œ: 0x9c,
  Œ: 0x8c,
};
function pdfTexte(s) {
  let out = '';
  // L'espace fine insécable devient insécable, le signe moins un tiret demi-
  // cadratin : ni l'un ni l'autre n'existe en WinAnsi.
  for (const c of s.replace(/\u202f/g, '\u00a0').replace(/\u2212/g, '\u2013')) {
    let code = CP1252[c] ?? c.codePointAt(0);
    if (code > 255) code = 0x3f;
    if (c === '(' || c === ')' || c === '\\') out += `\\${c}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += c;
  }
  return out;
}

/** Coupe une phrase en lignes d'au plus `largeur` caractères. */
function couper(phrase, largeur) {
  const lignes = [];
  let courante = '';
  for (const mot of phrase.split(' ')) {
    if (courante && (courante + ' ' + mot).length > largeur) {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = courante ? `${courante} ${mot}` : mot;
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

function supportPdf({ titre, formation, lecon, lignes }) {
  const flux = [
    // Le titre, dans le bleu de la marque, et son filet.
    'BT /F2 20 Tf 0 0.31 0.57 rg 60 770 Td',
    `(${pdfTexte(titre)}) Tj ET`,
    'BT /F1 10 Tf 0.35 0.37 0.46 rg 60 750 Td',
    `(${pdfTexte(`${formation} — ${lecon}`)}) Tj ET`,
    '0 0.31 0.57 RG 1.2 w 60 738 m 535 738 l S',
    'BT /F1 12 Tf 0.11 0.13 0.2 rg 60 708 Td 19 TL',
  ];
  let premiere = true;
  for (const phrase of lignes) {
    couper(phrase, 78).forEach((morceau, i) => {
      const puce = i === 0 ? '•  ' : '    ';
      flux.push(`${premiere ? '' : 'T* '}(${pdfTexte(puce + morceau)}) Tj`);
      premiere = false;
    });
    flux.push('T*');
  }
  flux.push('ET');
  flux.push(
    'BT /F1 9 Tf 0.5 0.52 0.6 rg 60 50 Td',
    `(${pdfTexte('APIX Academy — support de démonstration')}) Tj ET`,
  );
  const contenu = flux.join('\n');

  const objets = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let sortie = '%PDF-1.4\n';
  const decalages = [];
  for (let i = 1; i < objets.length; i += 1) {
    decalages[i] = sortie.length;
    sortie += `${i} 0 obj\n${objets[i]}\nendobj\n`;
  }
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objets.length; i += 1) {
    sortie += `${String(decalages[i]).padStart(10, '0')} 00000 n \n`;
  }
  sortie += `trailer\n<< /Size ${objets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, 'latin1');
}

// ———————————————————————————— le chargement

console.log(`→ Connexion (${EMAIL})`);
await appel('POST', '/auth/login', {
  email: EMAIL,
  password: MOT_DE_PASSE,
  ...(ORGANISATION ? { organizationSlug: ORGANISATION } : {}),
});

const existantes = await appel('GET', '/academy/gestion/courses');

/** La banque de questions d'une formation, et son réglage. */
async function chargerEvaluation(courseId, evaluation) {
  await appel('PUT', `/academy/courses/${courseId}/evaluation`, {
    questionCount: evaluation.questionCount,
    certificateValidityMonths: null,
  });
  for (const q of evaluation.questions) {
    await appel('POST', `/academy/courses/${courseId}/questions`, {
      prompt: q.prompt,
      kind: q.kind,
      options: q.options.map(([text, correct]) => ({ text, correct })),
    });
  }
  console.log(
    `   ✓ évaluation : ${evaluation.questions.length} questions, ${evaluation.questionCount} par tentative`,
  );
}

/**
 * Le nom court d'une formation — ce qui précède les deux-points. Une formation
 * renommée à la main (« Macroéconomie » au lieu du titre complet) reste
 * reconnue, et ne se retrouve pas en double.
 */
const nomCourt = (titre) =>
  titre
    .split(/\s*:\s*/)[0]
    .trim()
    .toLocaleLowerCase('fr');

for (const f of FORMATIONS) {
  const deja = existantes.find((c) => nomCourt(c.title) === nomCourt(f.title));
  if (deja) {
    // Une formation chargée avant l'évaluation reçoit sa banque — si elle
    // n'en a pas encore : on ne double jamais les questions.
    const vue = await appel('GET', `/academy/gestion/courses/${deja.id}`);
    if (vue.quiz.questions.length === 0 && f.evaluation) {
      console.log(`→ ${deja.title} (existante)`);
      await chargerEvaluation(deja.id, f.evaluation);
    } else {
      console.log(`= « ${deja.title} » existe déjà — laissée telle quelle`);
    }
    continue;
  }
  console.log(`→ ${f.title}`);
  const { id } = await appel('POST', '/academy/courses', {
    title: f.title,
    summary: f.summary,
    category: f.category,
  });

  for (const [i, m] of f.modules.entries()) {
    const module = await appel('POST', `/academy/courses/${id}/modules`, { title: m.title });
    for (const [j, l] of m.lessons.entries()) {
      const lecon = await appel('POST', `/academy/modules/${module.id}/lessons`, {
        title: l.title,
      });
      const nom = fichierVideo(f, i, j);
      const video = readFileSync(join(ICI, 'demo-academy', 'videos', nom));
      const cible = await appel('POST', `/academy/lessons/${lecon.id}/video`, {
        filename: nom,
        size: video.length,
        contentType: 'video/mp4',
      });
      if (cible.mode !== 'local') {
        throw new Error(
          `Le stockage vidéo « ${cible.mode} » n'est pas encore pris en charge par ce script.`,
        );
      }
      await appel(cible.method, cible.url, video, { type: 'video/mp4' });
      if (l.support) {
        const pdf = supportPdf({ ...l.support, formation: f.title, lecon: l.title });
        const fichier = `${l.support.titre}.pdf`;
        await appel(
          'POST',
          `/academy/lessons/${lecon.id}/support?filename=${encodeURIComponent(fichier)}`,
          pdf,
          { type: 'application/pdf' },
        );
      }
      console.log(`   ✓ ${i + 1}.${j + 1}  ${l.title}${l.support ? '  (+ support PDF)' : ''}`);
    }
  }

  if (f.evaluation) await chargerEvaluation(id, f.evaluation);
  await appel('POST', `/academy/courses/${id}/publication`, { published: true });
  console.log(`   ✔ publiée`);
}

console.log(`
✔ Academy prête.
  Catalogue  : http://localhost:3002/academy
  Atelier RH : http://localhost:3002/academy/gerer
  Pour les retirer : la formation › « Retirer du catalogue », puis « Supprimer ».`);
