#!/usr/bin/env node
/**
 * Jeu de données de démonstration : organisation APIX, unités, employés,
 * types/fériés/circuit de congés, demandes approuvées et en attente.
 * Usage : node scripts/seed-demo.mjs [http://localhost:3001]
 * Idempotence : à lancer sur une base vide (sinon l'email admin existe déjà).
 */
import { CODE_DU_TRAVAIL, REGLEMENT_INTERIEUR } from './seed-textes.mjs';

const BASE = (process.argv[2] ?? 'http://localhost:3001') + '/v1';

let cookie = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} : ${data?.title ?? text}`);
  }
  return data;
}

const ADMIN = { email: 'demo@apix.sn', password: 'MotDePasseSolide123!' };

console.log('→ Organisation et admin');
await call('POST', '/auth/register', {
  organizationName: 'APIX',
  givenName: 'Ibrahima',
  familyName: 'Ba',
  ...ADMIN,
});

console.log('→ Unités');
// La Direction Générale tient le sommet ; les directions métier lui sont
// rattachées. Sans elle, l'organigramme était une rangée de racines sans lien.
const dg = await call('POST', '/org-units', {
  name: 'Direction Générale',
  unitType: 'direction',
  shortName: 'DG',
});
const drh = await call('POST', '/org-units', {
  name: 'Direction du Capital Humain',
  unitType: 'direction',
  shortName: 'DCH',
  parentId: dg.id,
});
const etudes = await call('POST', '/org-units', {
  name: 'Département Études',
  unitType: 'department',
  parentId: drh.id,
});
const dfin = await call('POST', '/org-units', {
  name: 'Direction Financière et Comptable',
  unitType: 'direction',
  shortName: 'DFC',
  parentId: dg.id,
});
const compta = await call('POST', '/org-units', {
  name: 'Service Comptabilité',
  unitType: 'service',
  parentId: dfin.id,
});
// Les autres directions de l'agence. Elles n'ont ni employé ni département à
// ce stade, mais sans elles l'organigramme se résume à deux branches — et une
// démonstration à deux branches ne dit rien de ce qu'il fait d'un organisme
// réel : la barre de liaison, le repli, la mise à l'échelle du cadre.
for (const [name, shortName] of [
  ['Direction de la Promotion des Investissements', 'DPI'],
  ["Direction de l'Intelligence et des Perspectives Économiques", 'DIPE'],
  ["Direction des Systèmes d'information et de la Digitalisation", 'DSID'],
  ['Direction des Passations de Marchés', 'DPM'],
  ['Direction des Moyens Généraux', 'DMG'],
]) {
  await call('POST', '/org-units', { name, unitType: 'direction', shortName, parentId: dg.id });
}

console.log('→ Textes de référence');
// Le règlement intérieur et le Code du travail, dans leur écran de lecture.
// Le contenu est une démonstration : la RH dépose ensuite le texte officiel.
await call('PUT', '/reference-texts/reglement-interieur', REGLEMENT_INTERIEUR);
await call('PUT', '/reference-texts/code-du-travail', CODE_DU_TRAVAIL);

console.log('→ Employés');
/**
 * L'agence se peuple DE HAUT EN BAS, et ce n'est pas un choix d'écriture.
 *
 * La règle hiérarchique de l'APIX exige un n+1 pour chaque agent — seul le
 * directeur général n'en a pas — et ce n+1 dans la même direction. On crée
 * donc le directeur général, on le désigne à la tête de la Direction
 * Générale, puis chaque directeur (rattaché au DG pendant que sa direction
 * est sans tête), puis les agents sous leur directeur.
 */
const seedEmployee = (person, employee, positionTitle, orgUnitId, contract) =>
  call('POST', '/employees', {
    person,
    employee,
    assignment: { positionTitle, orgUnitId, startDate: employee.hiredOn },
    contract: contract ?? { contractType: 'cdi', startDate: employee.hiredOn },
  });

/** Un directeur : son dossier, puis sa désignation à la tête de sa direction. */
async function seedDirecteur(person, employee, positionTitle, uniteId, dgId) {
  const dossier = await seedEmployee(
    person,
    { ...employee, ...(dgId ? { managerEmployeeId: dgId } : {}) },
    positionTitle,
    uniteId,
  );
  await call('PATCH', `/org-units/${uniteId}`, { managerEmployeeId: dossier.id });
  return dossier;
}

const dgAgent = await seedDirecteur(
  { givenName: 'Cheikh', familyName: 'Mbaye', gender: 'male', phone: '770000001' },
  { employeeNumber: 'EMP-000', hiredOn: '2019-03-01', workEmail: 'c.mbaye@apix.sn' },
  'Directeur général',
  dg.id,
  null,
);
const directriceRh = await seedDirecteur(
  { givenName: 'Mariama', familyName: 'Cissé', gender: 'female', phone: '770000002' },
  { employeeNumber: 'EMP-004', hiredOn: '2021-09-01', workEmail: 'm.cisse@apix.sn' },
  'Directrice du Capital Humain',
  drh.id,
  dgAgent.id,
);
const directeurFin = await seedDirecteur(
  { givenName: 'Ousmane', familyName: 'Fall', gender: 'male', phone: '770000003' },
  { employeeNumber: 'EMP-005', hiredOn: '2020-11-02', workEmail: 'o.fall@apix.sn' },
  'Directeur financier et comptable',
  dfin.id,
  dgAgent.id,
);

const awa = await seedEmployee(
  { givenName: 'Awa', familyName: 'Diop', gender: 'female', phone: '771234567' },
  {
    employeeNumber: 'EMP-001',
    hiredOn: '2024-01-15',
    workEmail: 'a.diop@apix.sn',
    managerEmployeeId: directriceRh.id,
  },
  'Cheffe de service études',
  etudes.id,
);
const moussa = await seedEmployee(
  { givenName: 'Moussa', familyName: 'Ndiaye', gender: 'male', phone: '779876543' },
  {
    employeeNumber: 'EMP-002',
    hiredOn: '2023-06-01',
    workEmail: 'm.ndiaye@apix.sn',
    managerEmployeeId: awa.id,
  },
  "Chargé d'études",
  etudes.id,
);
// Fatou est en CDD finissant dans ~20 jours : l'échéance apparaît dans les
// notifications RH et sur le tableau de bord (démonstration du suivi).
const in20Days = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const fatou = await seedEmployee(
  { givenName: 'Fatou', familyName: 'Sall', gender: 'female' },
  {
    employeeNumber: 'EMP-003',
    hiredOn: '2025-02-01',
    workEmail: 'f.sall@apix.sn',
    managerEmployeeId: directeurFin.id,
  },
  'Comptable',
  compta.id,
  { contractType: 'cdd', startDate: '2025-02-01', endDate: in20Days },
);

console.log('→ Responsables des unités');
await call('PATCH', `/org-units/${etudes.id}`, { managerEmployeeId: awa.id });
await call('PATCH', `/org-units/${compta.id}`, { managerEmployeeId: fatou.id });

console.log('→ Congés : types (seed auto), fériés, circuit à 2 niveaux');
const types = await call('GET', '/absence-types');
const typeId = (name) => types.find((t) => t.name === name).id;
const year = new Date().getFullYear();
const tabaski = `${year}-08-26`;
await call('POST', '/holidays', { year, day: tabaski, label: 'Tabaski' }).catch(() => {});

// Fête mobile placée pour que la démo montre le rappel automatique : on prend
// le premier jour ouvré à venir dont le rappel (J−2 reculé au dernier jour
// ouvré) est déjà échu, quel que soit le jour où le seed tourne.
const iso = (d) => d.toISOString().slice(0, 10);
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const todayUtc = new Date(`${iso(new Date())}T00:00:00Z`);
let magalOn = null;
for (let ahead = 1; ahead <= 21 && !magalOn; ahead += 1) {
  const day = new Date(todayUtc);
  day.setUTCDate(day.getUTCDate() + ahead);
  if (isWeekend(day) || iso(day) === tabaski) continue; // date déjà prise
  const remind = new Date(day);
  remind.setUTCDate(remind.getUTCDate() - 2);
  while (isWeekend(remind)) remind.setUTCDate(remind.getUTCDate() - 1);
  if (remind > todayUtc) continue; // rappel pas encore dû : on essaie le suivant
  // Fin décembre, le premier jour ouvré à venir bascule sur l'année suivante :
  // le férié se range sous SON année, pas sous celle du jour où le seed tourne.
  await call('POST', '/holidays', {
    year: Number(iso(day).slice(0, 4)),
    day: iso(day),
    label: 'Magal de Touba',
  });
  magalOn = iso(day);
}
if (!magalOn) console.warn('  ⚠ aucun férié de démonstration placé (rappel non illustré)');

// Le socle sénégalais — six dates civiles, huit fêtes mobiles — n'est PAS
// saisi ici : c'est le produit qui le pose, à la première lecture d'une année
// par la RH. Le poser à la main donnait des « Nouvel an » et des « Noël »
// enregistrés comme fêtes MOBILES, puisque la création d'un férié ne déclare
// pas la date civile — et la démonstration laissait alors déplacer Noël.
// Deux années : le tableau de bord montre une fenêtre — le dernier férié passé
// et les trois à venir — qu'une seule année ne remplit pas toujours.
//
// L'ordre compte : les fêtes datées ci-dessus portent des noms du socle, et
// c'est leur présence qui empêche le produit d'en créer un second exemplaire
// non daté.
for (const an of [year, year + 1]) await call('GET', `/holidays?year=${an}`);
// Le circuit des congés n'est pas un réglage : le N+1 de l'agent vise
// d'abord, puis la Direction du Capital Humain — la direction du personnel,
// que l'organigramme désigne. Mariama, qui la dirige, traite les demandes.
await call('PATCH', `/org-units/${drh.id}`, { directionDuPersonnel: true });

console.log('→ Portails employés : Awa, Moussa, Fatou, Mariama et le DG activent leur compte');
// Les demandes sont posées par les employés EUX-MÊMES (aucune saisie RH) :
// chaque dossier reçoit une invitation, le compte est activé, puis la
// demande part depuis ce compte — avec justificatif PDF quand le type l'exige.
const PASSWORDS = {
  [awa.id]: ['a.diop@apix.sn', 'MotDePasseAwa1234!'],
  [moussa.id]: ['m.ndiaye@apix.sn', 'MotDePasseMoussa1!'],
  [fatou.id]: ['f.sall@apix.sn', 'MotDePasseFatou12!'],
  // La n+1 d'Awa : dans « Mon équipe » de l'Academy, elle voit Awa — et pas
  // Moussa, qui rend compte à Awa. Chacun ne voit que ses directs.
  [directriceRh.id]: ['m.cisse@apix.sn', 'MotDePasseMariama1!'],
  // Le directeur général : il fixe les objectifs de l'APIX et des directions.
  [dgAgent.id]: ['c.mbaye@apix.sn', 'MotDePasseCheikh1!'],
};
const employeeCookies = {};
for (const [employeeId, [, password]] of Object.entries(PASSWORDS)) {
  const invite = await call('POST', `/employees/${employeeId}/invite`, { role: 'employee' });
  const token = invite.invitePath.split('/').pop();
  const res = await fetch(`${BASE}/invitations/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`activation ${employeeId} → ${res.status}`);
  employeeCookies[employeeId] = res.headers.get('set-cookie').split(';')[0];
}

/** Un appel au nom d'un agent, depuis son portail. */
const enTantQue = async (employeeId, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie: employeeCookies[employeeId] },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} : ${await res.text()}`);
  const texte = await res.text();
  return texte ? JSON.parse(texte) : undefined;
};

console.log('→ Délégations : Mariama confie à Awa une partie des documents, et les dossiers');
// Tout le monde est agent ; ce qu'on fait de plus vient de l'organigramme.
// Mariama dirige la DCH : tout lui revient. Elle confie à Awa, membre de sa
// direction, les attestations de travail, les contrats et les certificats,
// et la consultation des dossiers. Les bulletins et attestations de salaire
// — sensibles —, les congés, les informations, les pièces restent chez elle.
for (const capacite of [
  'demandes.documents.attestation_travail',
  'demandes.documents.contrat_travail',
  'demandes.documents.certificat_travail',
  'personnel.consulter',
]) {
  await enTantQue(directriceRh.id, 'PUT', '/habilitations', {
    employeeId: awa.id,
    capacite,
    accordee: true,
  });
}

console.log('→ Demandes posées par les employés (2 approuvées, 2 en attente)');
const echappe = (t) => t.replace(/([()\\])/g, '\\$1');

/**
 * Un PDF minimal mais VALIDE, écrit à la main : le jeu de démonstration en
 * produisait un faux de 46 octets (« %PDF-1.4 justificatif de… »), que le
 * navigateur affichait en page blanche et qu'un vrai lecteur refuse.
 */
function pdfDemo(titre, lignes = []) {
  const objets = [];
  const pages = [
    [`(${titre}) Tj`, ...lignes.map((l) => `T* (${echappe(l)}) Tj`)],
    ['(Page 2) Tj', 'T* (Document de demonstration Teranga RH.) Tj'],
  ];
  const idPage = (i) => 3 + i * 2;
  const idFlux = (i) => 4 + i * 2;

  objets[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objets[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${idPage(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const idPolice = 3 + pages.length * 2;
  pages.forEach((contenu, i) => {
    const flux = `BT /F1 16 Tf 72 760 Td 22 TL\n${contenu.join('\n')}\nET`;
    objets[idPage(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${idFlux(i)} 0 R /Resources << /Font << /F1 ${idPolice} 0 R >> >> >>`;
    objets[idFlux(i)] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`;
  });
  objets[idPolice] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

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

const fakePdfDoc = (name) => ({
  filename: name,
  contentBase64: pdfDemo(name).toString('base64'),
});
const request = async (employeeId, type, startDate, endDate, reason, document) => {
  const res = await fetch(`${BASE}/absence-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: employeeCookies[employeeId] },
    body: JSON.stringify({
      employeeId,
      absenceTypeId: typeId(type),
      startDate,
      endDate,
      reason,
      document,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`demande ${type} → ${res.status} : ${data.title}`);
  return data;
};
/** Un visa, par le compte de qui vise : le n+1 (depuis son portail), puis la RH. */
const viser = async (id, parEmployeeId) => {
  const res = await fetch(`${BASE}/absence-requests/${id}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: parEmployeeId ? employeeCookies[parEmployeeId] : cookie,
    },
    body: JSON.stringify({ decision: 'approved' }),
  });
  if (!res.ok) throw new Error(`visa ${id} → ${res.status} : ${(await res.json()).title}`);
};
const r1 = await request(
  awa.id,
  'Congé annuel',
  `${year}-08-24`,
  `${year}-08-28`,
  'Congés famille',
);
// Awa → Mariama, sa N+1.
// Sa N+1 dirige la DCH : un seul visa suffit.
await viser(r1.id, directriceRh.id);
const r2 = await request(
  moussa.id,
  'Mission',
  `${year}-08-19`,
  `${year}-08-21`,
  'Mission Thiès',
  fakePdfDoc('ordre-de-mission-thies.pdf'),
);
// Moussa → Awa (sa N+1), puis Mariama pour la DCH.
await viser(r2.id, awa.id);
await viser(r2.id, directriceRh.id);
// Le N+1 de Fatou (Ousmane Fall) n'a pas d'accès au portail : sa demande
// va directement à la DCH, chez Mariama.
await request(
  fatou.id,
  'Maladie',
  `${year}-08-31`,
  `${year}-09-02`,
  'Grippe',
  fakePdfDoc('attestation-medicale.pdf'),
);
// Et une demande qui attend son n+1 : Awa la trouve dans « Congés de
// l'équipe », prévenue par une notification.
const dansUnMois = new Date(Date.now() + 30 * 86_400_000);
while ([0, 6].includes(dansUnMois.getUTCDay())) dansUnMois.setUTCDate(dansUnMois.getUTCDate() + 1);
const finDansUnMois = new Date(dansUnMois);
finDansUnMois.setUTCDate(finDansUnMois.getUTCDate() + 2);
while ([0, 6].includes(finDansUnMois.getUTCDay()))
  finDansUnMois.setUTCDate(finDansUnMois.getUTCDate() + 1);
await request(
  moussa.id,
  'Congé annuel',
  dansUnMois.toISOString().slice(0, 10),
  finDansUnMois.toISOString().slice(0, 10),
  'Mariage d’un proche à Saint-Louis',
);

console.log('→ Pièce justificative : Awa dépose une attestation (à vérifier par la DCH)');
// Un VRAI PDF pour la démo : l'attestation de travail générée par la plateforme.
const attRes = await fetch(`${BASE}/employees/${awa.id}/attestation`, {
  headers: { cookie },
});
const attPdf = Buffer.from(await attRes.arrayBuffer()).toString('base64');
const depotRes = await fetch(`${BASE}/employees/${awa.id}/documents`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: employeeCookies[awa.id] },
  body: JSON.stringify({
    category: 'attestation_travail',
    label: 'Attestation employeur précédent',
    filename: 'attestation-2023.pdf',
    contentType: 'application/pdf',
    contentBase64: attPdf,
  }),
});
if (!depotRes.ok) throw new Error(`dépôt pièce → ${depotRes.status}`);

console.log('→ Recrutement : offre publiée + candidatures dans le pipeline');
const job = await call('POST', '/jobs', {
  title: "Chargé d'affaires investissement",
  description:
    "Au sein de la Direction Financière, vous instruisez les dossiers d'investissement, " +
    'accompagnez les porteurs de projets et suivez les conventions signées.\n\n' +
    'Profil : Bac+5 finance ou équivalent, 3 ans d’expérience minimum, français exigé.',
  orgUnitId: dfin.id,
  contractType: 'cdi',
  location: 'Dakar',
  requiredDocuments: ['CV', 'Lettre de motivation'],
});
await call('PATCH', `/jobs/${job.id}`, { status: 'published' });

const applyAs = async (givenName, familyName, email, phone, message) => {
  const res = await fetch(`${BASE}/public/jobs/${job.publicSlug}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      givenName,
      familyName,
      email,
      phone,
      message,
      documents: [
        {
          label: 'CV',
          filename: `cv-${familyName.toLowerCase()}.pdf`,
          contentType: 'application/pdf',
          contentBase64: pdfDemo(`CV — ${givenName} ${familyName}`, [
            'Parcours, diplomes et experiences.',
            'Document de demonstration.',
          ]).toString('base64'),
        },
        {
          label: 'Lettre de motivation',
          filename: `lettre-${familyName.toLowerCase()}.pdf`,
          contentType: 'application/pdf',
          contentBase64: pdfDemo(`Lettre de motivation — ${givenName} ${familyName}`, [
            'Madame, Monsieur,',
            'Je vous adresse ma candidature.',
          ]).toString('base64'),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`candidature ${email} → ${res.status}`);
};
await applyAs(
  'Aminata',
  'Sow',
  'aminata.sow@gmail.com',
  '775556677',
  "Diplômée de l'ESP, 4 ans d'expérience en financement de projets.",
);
await applyAs(
  'Ousmane',
  'Diallo',
  'ousmane.diallo@yahoo.fr',
  '764443322',
  'Actuellement analyste, disponible sous un mois.',
);
await applyAs('Mariama', 'Ba', 'mariama.ba@outlook.com', undefined, undefined);
const candidates = await call('GET', `/jobs/${job.id}/applications`);
const byEmail = (email) => candidates.find((a) => a.email === email);
await call('PATCH', `/applications/${byEmail('aminata.sow@gmail.com').id}`, {
  stage: 'screening',
});
await call('PATCH', `/applications/${byEmail('ousmane.diallo@yahoo.fr').id}`, {
  stage: 'interview',
});

console.log('→ Demandes de documents (circuit DCH : demandée → traitée → prête)');
const requestDocs = async (employeeId, docTypes, note) => {
  const res = await fetch(`${BASE}/document-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: employeeCookies[employeeId] },
    body: JSON.stringify({ docTypes, note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`demande documents → ${res.status} : ${data.title}`);
  return data;
};
// Awa : demande toute fraîche. Elle traite les attestations de travail,
// mais pas la sienne : sa demande va à Mariama, qui dirige la DCH.
await requestDocs(awa.id, ['attestation_travail'], 'Pour ouvrir un compte bancaire.');
// Moussa : deux documents, donc deux demandes. L'attestation de travail
// va à Awa, qui la prend en charge ; l'attestation de salaire reste chez
// Mariama.
const [attestationMoussa] = (
  await requestDocs(
    moussa.id,
    ['attestation_travail', 'attestation_salaire'],
    'Dossier de visa Schengen.',
  )
).ids;
await enTantQue(awa.id, 'POST', `/document-requests/${attestationMoussa}/advance`, {
  status: 'processing',
});
// Fatou : prête, l'employée est prévenue du lieu de retrait.
const [dr3] = (await requestDocs(fatou.id, ['contrat_travail'], 'Copie pour mes archives.')).ids;
await enTantQue(awa.id, 'POST', `/document-requests/${dr3}/advance`, {
  status: 'processing',
});
await enTantQue(awa.id, 'POST', `/document-requests/${dr3}/advance`, {
  status: 'ready',
  pickupContact: 'Awa Diop',
  message: 'bureau 204, du lundi au vendredi 9h–16h',
});

console.log(
  '→ Objectifs : le DG fixe ceux de l’APIX et des directions ; les n+1, ceux de leurs agents',
);
// Ils descendent l'organigramme : les orientations de l'APIX (à tous, ou aux
// directeurs seulement), les objectifs de chaque direction, puis ceux que
// chaque n+1 fixe à ses directs.
const anneeObjectifs = new Date().getFullYear();
for (const o of [
  {
    niveau: 'apix',
    diffusion: 'tous',
    titre: 'Faire de l’APIX le guichet unique de référence de l’investisseur',
    description: 'Un seul interlocuteur, de l’intention d’investir à l’installation.',
  },
  {
    niveau: 'apix',
    diffusion: 'directeurs',
    titre: 'Ramener à 30 jours le délai moyen de traitement des dossiers d’agrément',
  },
  {
    niveau: 'direction',
    directionId: drh.id,
    titre: 'Former chaque agent au moins une fois dans l’année',
    echeance: `${anneeObjectifs}-12-31`,
  },
  {
    niveau: 'direction',
    directionId: drh.id,
    titre: 'Mettre en place l’entretien annuel d’évaluation',
    echeance: `${anneeObjectifs}-11-30`,
  },
  {
    niveau: 'direction',
    directionId: dfin.id,
    titre: `Clôturer les comptes ${anneeObjectifs} avant le 31 mars ${anneeObjectifs + 1}`,
  },
]) {
  await enTantQue(dgAgent.id, 'POST', '/objectifs', o);
}
// Les objectifs d'un agent : la fiche que son n+1 rédige, à la manière d'une
// page Notion — des titres, des cases à cocher, des échéances.
const texte = (t) => ({ type: 'text', text: t, styles: {} });
const echeance = (date) => ({ type: 'echeance', props: { date } });
const bloc = (type, contenu, props = {}) => ({ type, props, content: contenu, children: [] });
await enTantQue(directriceRh.id, 'PUT', `/objectifs/equipe/${awa.id}/fiche`, {
  contenu: [
    bloc('heading', [texte('Études et veille')], { level: 2 }),
    bloc('checkListItem', [
      texte('Livrer l’étude sur l’attractivité des zones économiques spéciales — pour le '),
      echeance(`${anneeObjectifs}-12-15`),
    ]),
    bloc('checkListItem', [texte('Accompagner Moussa sur la note de conjoncture')]),
  ],
});
await enTantQue(awa.id, 'PUT', `/objectifs/equipe/${moussa.id}/fiche`, {
  contenu: [
    bloc('heading', [texte('Priorités du quatrième trimestre')], { level: 2 }),
    bloc('checkListItem', [
      texte('Produire la note de conjoncture trimestrielle — pour le '),
      echeance(`${anneeObjectifs}-10-31`),
    ]),
    bloc('checkListItem', [
      texte('Présenter les intentions d’investissement au comité de direction — pour le '),
      echeance(`${anneeObjectifs}-11-20`),
    ]),
    bloc('checkListItem', [texte('Mettre à jour la base des projets agréés')], { checked: true }),
    bloc('heading', [texte('Critères de réussite')], { level: 3 }),
    bloc('bulletListItem', [texte('Données du troisième trimestre, sources citées.')]),
    bloc('bulletListItem', [texte('Intentions d’investissement ventilées par secteur.')]),
    bloc('quote', [texte('Point d’étape avec Awa début novembre.')]),
  ],
});

console.log(`
✔ Démo prête.
  Admin       : ${ADMIN.email} / ${ADMIN.password}
  DG          : c.mbaye@apix.sn / MotDePasseCheikh1! (Objectifs de l’APIX)
  DCH         : m.cisse@apix.sn / MotDePasseMariama1! (dirige la DCH — Délégations)
  Employés    : a.diop@apix.sn / MotDePasseAwa1234! (idem Moussa1!, Fatou12!)
  Employés    : Awa (EMP-001, ${awa.id}), Moussa (EMP-002, ${moussa.id}), Fatou (EMP-003, ${fatou.id})
  Recrutement : offre « Chargé d'affaires investissement » publiée
                lien candidat → http://localhost:3002/postuler/${job.publicSlug}
  À tester    : Mariama → « Demandes à traiter », « Délégations » ; Awa → documents confiés.`);
