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
  name: 'Direction des Ressources Humaines',
  unitType: 'direction',
});
const etudes = await call('POST', '/org-units', {
  name: 'Département Études',
  unitType: 'department',
  parentId: drh.id,
});
const dfin = await call('POST', '/org-units', {
  name: 'Direction Financière',
  unitType: 'direction',
});
const compta = await call('POST', '/org-units', {
  name: 'Service Comptabilité',
  unitType: 'service',
  parentId: dfin.id,
});

console.log('→ Employés');
const seedEmployee = (person, employee, positionTitle, orgUnitId) =>
  call('POST', '/employees', {
    person,
    employee,
    assignment: { positionTitle, orgUnitId, startDate: employee.hiredOn },
    contract: { contractType: 'cdi', startDate: employee.hiredOn },
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
const fatou = await seedEmployee(
  { givenName: 'Fatou', familyName: 'Sall', gender: 'female' },
  { employeeNumber: 'EMP-003', hiredOn: '2025-02-01', workEmail: 'f.sall@apix.sn' },
  'Comptable',
  compta.id,
);

console.log('→ Responsables des unités');
await call('PATCH', `/org-units/${etudes.id}`, { managerEmployeeId: awa.id });
await call('PATCH', `/org-units/${compta.id}`, { managerEmployeeId: fatou.id });

console.log('→ Congés : types (seed auto), férié, circuit à 2 niveaux');
const types = await call('GET', '/absence-types');
const typeId = (name) => types.find((t) => t.name === name).id;
const year = new Date().getFullYear();
await call('POST', '/holidays', { day: `${year}-08-26`, label: 'Tabaski' }).catch(() => {});
await call('PUT', '/approval-chain', { levels: ['hr', 'admin'] });

console.log('→ Demandes (2 approuvées, 1 en attente)');
const request = (employeeId, type, startDate, endDate, reason) =>
  call('POST', '/absence-requests', {
    employeeId,
    absenceTypeId: typeId(type),
    startDate,
    endDate,
    reason,
  });
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
const r2 = await request(moussa.id, 'Mission', `${year}-08-19`, `${year}-08-21`, 'Mission Thiès');
await approve(r2.id, 2);
await request(fatou.id, 'Maladie', `${year}-08-31`, `${year}-09-02`, 'Grippe');

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

console.log(`
✔ Démo prête.
  Admin       : ${ADMIN.email} / ${ADMIN.password}
  Employés    : Awa (EMP-001, ${awa.id}), Moussa (EMP-002, ${moussa.id}), Fatou (EMP-003, ${fatou.id})
  Recrutement : offre « Chargé d'affaires investissement » publiée
                lien candidat → http://localhost:3002/postuler/${job.publicSlug}
  À tester    : fiche employé → « Accès au portail » ; Recrutement → pipeline.`);
