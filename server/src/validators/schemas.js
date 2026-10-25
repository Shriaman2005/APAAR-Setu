// Request body schemas. All objects are strict: unknown fields cause a 422 instead of being ignored.
// Business rules (scope, state, ownership) are checked again in the services.
const { z } = require('zod');
const { ALL_ROLES, ENROLMENT_STATE } = require('../config/constants');

const text = (min, max, label) =>
  z.string({ error: `${label} is required.` })
    .trim()
    .min(min, { error: `${label} must be at least ${min} characters.` })
    .max(max, { error: `${label} must be at most ${max} characters.` });

const reason = text(10, 500, 'Reason');
const optionalNote = z.string().trim().max(300).optional();
const shortId = z.string().trim().min(1).max(80);

const bucketSchema = z.object({
  code: z.string().trim().min(2).max(30),
  capacity: z.number().int().min(0).max(10000),
  countsWithinIntake: z.boolean(),
}).strict();

const scopeSchema = z.object({
  institutionCode: z.string().trim().min(2).max(40),
  courseCode: z.string().trim().min(1).max(20),
  buckets: z.array(bucketSchema).min(1).max(20),
}).strict();

const admissionWindow = z.object({
  opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use YYYY-MM-DD.' }),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use YYYY-MM-DD.' }),
}).strict();

module.exports = {
  login: z.object({
    email: z.string({ error: 'Email is required.' }).trim().min(3, { error: 'Email is required.' }).max(254),
    password: z.string({ error: 'Password is required.' }).min(1, { error: 'Password is required.' }).max(200),
  }).strict(),
  demoLogin: z.object({
    email: z.string({ error: 'Choose a demo account.' }).trim().min(3, { error: 'Choose a demo account.' }).max(254),
  }).strict(),
  changePassword: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).strict(),
  setPassword: z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(1).max(200) }).strict(),

  // Batches
  rowCorrection: z.object({ changes: z.record(z.string().max(40), z.string().max(200)) }).strict(),
  exclusion: z.object({ reason }).strict(),
  justification: z.object({ justification: text(10, 500, 'Justification') }).strict(),
  markReady: z.object({ note: optionalNote }).strict(),
  returnBatch: z.object({ reason }).strict(),
  dispositions: z.object({ issueIds: z.array(z.string().max(40)).min(1).max(200), reason }).strict(),
  certify: z.object({ declarationAccepted: z.boolean(), confirmBatchId: z.string().max(80) }).strict(),
  discard: z.object({ reason }).strict(),

  // Enrolments and conflicts
  enrolmentState: z.object({ toState: z.enum(Object.values(ENROLMENT_STATE)), reason }).strict(),
  conflictResolve: z.object({
    action: z.enum(['SUBMIT_FACTS', 'WITHDRAW_OWN_ENROLMENT', 'TRANSFER_OWN_ENROLMENT', 'SUBMIT_JUSTIFICATION', 'ACCEPT_JUSTIFICATION', 'REJECT_JUSTIFICATION', 'ADD_NOTE']),
    reason,
  }).strict(),
  escalate: z.object({ reason }).strict(),

  // Risk
  riskAssign: z.object({ assigneeId: shortId }).strict(),
  riskNote: z.object({ text: text(3, 1000, 'Note') }).strict(),
  riskReview: z.object({ summary: text(10, 1000, 'Review summary') }).strict(),
  riskReason: z.object({ reason }).strict(),

  // Admin
  createUser: z.object({
    email: z.email({ error: 'Enter a valid email address.' }).max(254),
    displayName: text(2, 120, 'Display name'),
    role: z.enum(ALL_ROLES, { error: 'Choose a role from the allowed list.' }),
    institutionId: z.string().max(40).optional(),
    regionIds: z.array(z.string().max(40)).max(10).optional(),
    organisationId: z.string().max(40).optional(),
    studentCode: z.string().max(40).optional(),
  }).strict(),
  updateUser: z.object({
    displayName: text(2, 120, 'Display name').optional(),
    institutionId: z.string().max(40).optional(),
    regionIds: z.array(z.string().max(40)).max(10).optional(),
    organisationId: z.string().max(40).optional(),
    role: z.string().max(40).optional(), // accepted only so the service can explain that roles cannot change
  }).strict(),
  statusChange: z.object({ reason }).strict(),
  orgDecision: z.object({ reason: text(5, 300, 'Reason') }).strict(),
  verifierOrganisation: z.object({
    name: text(3, 160, 'Organisation name'),
    verifierCategory: z.enum(['EMPLOYER', 'EDUCATION_INSTITUTION', 'SCHOLARSHIP_PROVIDER', 'FINANCIAL_INSTITUTION']),
    description: z.string().trim().max(500).optional(),
  }).strict(),
  policyDraft: z.object({
    academicYear: z.string().regex(/^\d{4}-\d{2}$/, { error: 'Use the format 2026-27.' }),
    version: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/, { error: 'Version may use letters, digits, dot, dash and underscore.' }),
    sourceReference: text(3, 200, 'Source reference'),
    notes: z.string().trim().max(1000).optional(),
    admissionWindow,
    scopes: z.array(scopeSchema).min(1).max(200),
  }).strict(),
  policyUpdate: z.object({
    sourceReference: text(3, 200, 'Source reference').optional(),
    notes: z.string().trim().max(1000).optional(),
    admissionWindow: admissionWindow.optional(),
    scopes: z.array(scopeSchema).min(1).max(200).optional(),
  }).strict(),
  policyReject: z.object({ reason }).strict(),
  settings: z.object({ changes: z.record(z.string().max(60), z.union([z.string().max(60), z.number()])), reason }).strict(),

  // Verification, consent, credentials
  verificationRequest: z.object({
    studentRef: z.string().trim().min(5).max(80),
    purpose: z.string().max(60),
    requestedFields: z.array(z.string().max(40)).min(1).max(10),
    expiryDays: z.number().int(),
  }).strict(),
  consentApprove: z.object({ approvedFields: z.array(z.string().max(40)).min(1).max(10), note: optionalNote }).strict(),
  consentDecision: z.object({ note: optionalNote }).strict(),
  issueCredential: z.object({ enrolmentRef: shortId, credentialType: z.string().max(60) }).strict(),
  revokeCredential: z.object({ reason }).strict(),
  credentialRequest: z.object({ enrolmentRef: shortId }).strict(),
  correctionRequest: z.object({
    enrolmentRef: shortId,
    correctionType: z.enum(['NAME_CORRECTION', 'ENROLMENT_DETAIL']),
    explanation: text(20, 1000, 'Explanation'),
    evidenceNote: z.string().trim().max(300).optional(),
    proposedValue: z.string().trim().max(120).optional(),
  }).strict(),
  correctionDecision: z.object({ decision: z.enum(['ACCEPT', 'REJECT']), response: text(5, 500, 'Response') }).strict(),
};
