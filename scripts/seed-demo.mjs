#!/usr/bin/env node
/**
 * Jeu de données de démonstration : organisation APIX, unités, employés,
 * types/fériés/circuit de congés, demandes approuvées et en attente.
 * Usage : node scripts/seed-demo.mjs [http://localhost:3001]
 * Idempotence : à lancer sur une base vide (sinon l'email admin existe déjà).
 */
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

const ADMIN = { email: 'demo@apix.sn', password: 'MotDePasseSolide123' };

console.log('→ Organisation et admin');
await call('POST', '/auth/register', {
  organizationName: 'APIX',
  givenName: 'Ibrahima',
  familyName: 'Ba',
  ...ADMIN,
});

console.log('→ Unités');
const drh = await call('POST', '/org-units', {
  name: 'Direction du Capital Humain',
  unitType: 'direction',
  shortName: 'DCH',
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
});
const compta = await call('POST', '/org-units', {
  name: 'Service Comptabilité',
  unitType: 'service',
  parentId: dfin.id,
});

console.log('→ Employés');
const seedEmployee = (person, employee, positionTitle, orgUnitId, contract) =>
  call('POST', '/employees', {
    person,
    employee,
    assignment: { positionTitle, orgUnitId, startDate: employee.hiredOn },
    contract: contract ?? { contractType: 'cdi', startDate: employee.hiredOn },
  });
const awa = await seedEmployee(
  { givenName: 'Awa', familyName: 'Diop', gender: 'female', phone: '771234567', city: 'Dakar' },
  { employeeNumber: 'EMP-001', hiredOn: '2024-01-15', workEmail: 'a.diop@apix.sn' },
  'Cheffe de service études',
  etudes.id,
);
const moussa = await seedEmployee(
  { givenName: 'Moussa', familyName: 'Ndiaye', gender: 'male', phone: '779876543' },
  { employeeNumber: 'EMP-002', hiredOn: '2023-06-01', workEmail: 'm.ndiaye@apix.sn' },
  "Chargé d'études",
  etudes.id,
);
// Fatou est en CDD finissant dans ~20 jours : l'échéance apparaît dans les
// notifications RH et sur le tableau de bord (démonstration du suivi).
const in20Days = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const fatou = await seedEmployee(
  { givenName: 'Fatou', familyName: 'Sall', gender: 'female' },
  { employeeNumber: 'EMP-003', hiredOn: '2025-02-01', workEmail: 'f.sall@apix.sn' },
  'Comptable',
  compta.id,
  { contractType: 'cdd', startDate: '2025-02-01', endDate: in20Days },
);

console.log('→ Rattachements hiérarchiques');
// Awa encadre Moussa (même département) ; Fatou relève d'Awa.
await call('PATCH', `/employees/${moussa.id}`, {
  employee: { managerEmployeeId: awa.id },
});
await call('PATCH', `/employees/${fatou.id}`, {
  employee: { managerEmployeeId: awa.id },
});

console.log('→ Responsables des unités');
await call('PATCH', `/org-units/${etudes.id}`, { managerEmployeeId: awa.id });
await call('PATCH', `/org-units/${compta.id}`, { managerEmployeeId: fatou.id });

console.log('→ Congés : types (seed auto), fériés, circuit à 2 niveaux');
const types = await call('GET', '/absence-types');
const typeId = (name) => types.find((t) => t.name === name).id;
const year = new Date().getFullYear();
const tabaski = `${year}-08-26`;
await call('POST', '/holidays', { day: tabaski, label: 'Tabaski' }).catch(() => {});

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
  await call('POST', '/holidays', { day: iso(day), label: 'Magal de Touba' });
  magalOn = iso(day);
}
if (!magalOn) console.warn('  ⚠ aucun férié de démonstration placé (rappel non illustré)');
await call('PUT', '/approval-chain', { levels: ['hr', 'admin'] });

console.log('→ Portails employés : Awa, Moussa et Fatou activent leur compte');
// Les demandes sont posées par les employés EUX-MÊMES (aucune saisie RH) :
// chaque dossier reçoit une invitation, le compte est activé, puis la
// demande part depuis ce compte — avec justificatif PDF quand le type l'exige.
const PASSWORDS = {
  [awa.id]: ['a.diop@apix.sn', 'MotDePasseAwa1234'],
  [moussa.id]: ['m.ndiaye@apix.sn', 'MotDePasseMoussa1'],
  [fatou.id]: ['f.sall@apix.sn', 'MotDePasseFatou12'],
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

console.log('→ Demandes posées par les employés (2 approuvées, 1 en attente)');
const fakePdfDoc = (name) => ({
  filename: name,
  contentBase64: Buffer.from('%PDF-1.4 justificatif de démonstration Teranga RH').toString(
    'base64',
  ),
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
const approve = async (id, times) => {
  for (let i = 0; i < times; i += 1) {
    await call('POST', `/absence-requests/${id}/decision`, { decision: 'approved' });
  }
};
const r1 = await request(
  awa.id,
  'Congé annuel',
  `${year}-08-24`,
  `${year}-08-28`,
  'Congés famille',
);
await approve(r1.id, 2);
const r2 = await request(
  moussa.id,
  'Mission',
  `${year}-08-19`,
  `${year}-08-21`,
  'Mission Thiès',
  fakePdfDoc('ordre-de-mission-thies.pdf'),
);
await approve(r2.id, 2);
await request(
  fatou.id,
  'Maladie',
  `${year}-08-31`,
  `${year}-09-02`,
  'Grippe',
  fakePdfDoc('attestation-medicale.pdf'),
);

console.log('→ Pièce justificative : Awa dépose une attestation (à valider par la RH)');
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
const fakePdf = Buffer.from('%PDF-1.4 document de démonstration Teranga RH').toString('base64');
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
          contentBase64: fakePdf,
        },
        {
          label: 'Lettre de motivation',
          filename: `lettre-${familyName.toLowerCase()}.pdf`,
          contentType: 'application/pdf',
          contentBase64: fakePdf,
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
// Awa : demande toute fraîche, en attente de traitement.
await requestDocs(awa.id, ['attestation_travail'], 'Pour ouvrir un compte bancaire.');
// Moussa : prise en charge, en cours de préparation.
const dr2 = await requestDocs(
  moussa.id,
  ['attestation_travail', 'attestation_salaire'],
  'Dossier de visa Schengen.',
);
await call('POST', `/document-requests/${dr2.id}/advance`, { status: 'processing' });
// Fatou : prête, l'employée est prévenue du lieu de retrait.
const dr3 = await requestDocs(fatou.id, ['contrat_travail'], 'Copie pour mes archives.');
await call('POST', `/document-requests/${dr3.id}/advance`, { status: 'processing' });
await call('POST', `/document-requests/${dr3.id}/advance`, {
  status: 'ready',
  pickupContact: 'Mme Fatou Sall',
  message: 'bureau 204, du lundi au vendredi 9h–16h',
});

console.log(`
✔ Démo prête.
  Admin       : ${ADMIN.email} / ${ADMIN.password}
  Employés    : a.diop@apix.sn / MotDePasseAwa1234 (idem Moussa1, Fatou12)
  Employés    : Awa (EMP-001, ${awa.id}), Moussa (EMP-002, ${moussa.id}), Fatou (EMP-003, ${fatou.id})
  Recrutement : offre « Chargé d'affaires investissement » publiée
                lien candidat → http://localhost:3002/postuler/${job.publicSlug}
  À tester    : Documents → file d'attente RH ; espace employé → « Demander un document ».`);
