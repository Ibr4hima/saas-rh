/**
 * Schéma Drizzle : miroir typé des tables créées par les migrations SQL
 * (src/db/sql). La source de vérité du DDL est le SQL — ce fichier ne sert
 * qu'au typage des requêtes. Toute divergence est un bug.
 */
import {
  char,
  customType,
  date,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** daterange Postgres, manipulé sous forme textuelle `[start,end)`. */
export const daterange = customType<{ data: string }>({
  dataType() {
    return 'daterange';
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  status: text('status').notNull().default('active'),
  mfaTotpSecret: text('mfa_totp_secret'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  countryCode: char('country_code', { length: 2 }).notNull().default('SN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userTenantMemberships = pgTable('user_tenant_memberships', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgUnits = pgTable('org_units', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  parentId: uuid('parent_id'),
  unitType: text('unit_type').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  gender: text('gender'),
  birthDate: date('birth_date'),
  personalEmail: text('personal_email'),
  phone: text('phone'),
  addressLine: text('address_line'),
  city: text('city'),
  countryCode: char('country_code', { length: 2 }).notNull().default('SN'),
  maritalStatus: text('marital_status'),
  birthPlace: text('birth_place'),
  nationality: char('nationality', { length: 2 }).notNull().default('SN'),
  nationalIdEncrypted: text('national_id_encrypted'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  personId: uuid('person_id').notNull(),
  employeeNumber: text('employee_number').notNull(),
  hiredOn: date('hired_on').notNull(),
  status: text('status').notNull().default('active'),
  workEmail: text('work_email'),
  workPhone: text('work_phone'),
  customFields: jsonb('custom_fields').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  orgUnitId: uuid('org_unit_id'),
  positionTitle: text('position_title').notNull(),
  validity: daterange('validity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable('contracts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  contractType: text('contract_type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  trialPeriodEnd: date('trial_period_end'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id'),
  tableName: text('table_name').notNull(),
  rowId: uuid('row_id'),
  action: text('action').notNull(),
  actorUserId: uuid('actor_user_id'),
  oldData: jsonb('old_data'),
  newData: jsonb('new_data'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
