/**
 * Schéma Drizzle : miroir typé des tables créées par les migrations SQL
 * (src/db/sql). La source de vérité du DDL est le SQL — ce fichier ne sert
 * qu'au typage des requêtes. Toute divergence est un bug.
 */
import {
  boolean,
  char,
  customType,
  date,
  inet,
  integer,
  jsonb,
  numeric,
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
  /** Abrégé d'une direction (« DCH ») — NULL pour les autres types. */
  shortName: text('short_name'),
  managerEmployeeId: uuid('manager_employee_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const profileChangeRequests = pgTable('profile_change_requests', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  changes: jsonb('changes').notNull(),
  previous: jsonb('previous').notNull(),
  note: text('note'),
  status: text('status').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  handledByUserId: uuid('handled_by_user_id'),
  hrMessage: text('hr_message'),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  idDocumentType: text('id_document_type'),
  idDocumentIssuedOn: date('id_document_issued_on'),
  idDocumentExpiresOn: date('id_document_expires_on'),
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
  /** À qui l'agent rend compte — distinct du responsable d'unité. */
  managerEmployeeId: uuid('manager_employee_id'),
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

export const absenceTypes = pgTable('absence_types', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  deductsBalance: boolean('deducts_balance').notNull().default(true),
  defaultAnnualDays: numeric('default_annual_days', { precision: 5, scale: 2 }),
  requiresDocument: boolean('requires_document').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absenceBalances = pgTable('absence_balances', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  absenceTypeId: uuid('absence_type_id').notNull(),
  year: integer('year').notNull(),
  entitledDays: numeric('entitled_days', { precision: 5, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalChains = pgTable('approval_chains', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  requestType: text('request_type').notNull().default('absence'),
  levels: text('levels').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absenceRequests = pgTable('absence_requests', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  absenceTypeId: uuid('absence_type_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  daysCount: numeric('days_count', { precision: 5, scale: 2 }).notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  currentLevel: integer('current_level').notNull().default(0),
  requestedByUserId: uuid('requested_by_user_id'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absenceApprovals = pgTable('absence_approvals', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  requestId: uuid('request_id').notNull(),
  level: integer('level').notNull(),
  decision: text('decision').notNull(),
  decidedByUserId: uuid('decided_by_user_id').notNull(),
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  personId: uuid('person_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedByUserId: uuid('invited_by_user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

// ---------- Recrutement ----------

export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const jobPostings = pgTable('job_postings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  orgUnitId: uuid('org_unit_id'),
  contractType: text('contract_type').notNull(),
  location: text('location'),
  deadline: date('deadline'),
  requiredDocuments: text('required_documents').array().notNull(),
  status: text('status').notNull().default('draft'),
  publicSlug: text('public_slug').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  jobPostingId: uuid('job_posting_id').notNull(),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  message: text('message'),
  stage: text('stage').notNull().default('received'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applicationDocuments = pgTable('application_documents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  applicationId: uuid('application_id').notNull(),
  label: text('label').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const absenceDocuments = pgTable('absence_documents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  requestId: uuid('request_id').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull().default('application/pdf'),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Pièces justificatives & notifications ----------

export const employeeDocuments = pgTable('employee_documents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  category: text('category').notNull(),
  label: text('label').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  status: text('status').notNull().default('pending'),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  uploadedBySide: text('uploaded_by_side').notNull(),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewComment: text('review_comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  recipientUserId: uuid('recipient_user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  dedupeKey: text('dedupe_key'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentRequests = pgTable('document_requests', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  docTypes: text('doc_types').array().notNull(),
  note: text('note'),
  status: text('status').notNull().default('received'),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  handledByUserId: uuid('handled_by_user_id'),
  pickupContact: text('pickup_contact'),
  hrMessage: text('hr_message'),
  processingAt: timestamp('processing_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
