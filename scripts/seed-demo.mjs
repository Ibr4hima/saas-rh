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
await call('POST', '/org-units', {
  name: 'Département Études',
  unitType: 'department',
  parentId: drh.id,
});

console.log('→ Employés');
const seedEmployee = (person, employee, positionTitle) =>
  call('POST', '/employees', {
    person,
    employee,
    assignment: { positionTitle, orgUnitId: drh.id, startDate: employee.hiredOn },
    contract: { contractType: 'cdi', startDate: employee.hiredOn },
  });
const awa = await seedEmployee(
  { givenName: 'Awa', familyName: 'Diop', gender: 'female', phone: '771234567', city: 'Dakar' },
  { employeeNumber: 'EMP-001', hiredOn: '2024-01-15', workEmail: 'a.diop@apix.sn' },
  'Cheffe de service études',
);
const moussa = await seedEmployee(
  { givenName: 'Moussa', familyName: 'Ndiaye', gender: 'male', phone: '779876543' },
  { employeeNumber: 'EMP-002', hiredOn: '2023-06-01', workEmail: 'm.ndiaye@apix.sn' },
  "Chargé d'études",
);
const fatou = await seedEmployee(
  { givenName: 'Fatou', familyName: 'Sall', gender: 'female' },
  { employeeNumber: 'EMP-003', hiredOn: '2025-02-01', workEmail: 'f.sall@apix.sn' },
  'Comptable',
);

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

console.log(`
✔ Démo prête.
  Admin     : ${ADMIN.email} / ${ADMIN.password}
  Employés  : Awa (EMP-001, ${awa.id}), Moussa (EMP-002, ${moussa.id}), Fatou (EMP-003, ${fatou.id})
  À tester  : fiche employé → « Accès au portail » → générer un lien d'invitation.`);
