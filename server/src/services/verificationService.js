// Verifier requests and student consent (spec 04 sections 9-10, spec 05 section 5).
// Default prototype policy: NO data is released without the student's current, unexpired consent,
// and only the fields the student approved are returned.
const mongoose = require('mongoose');
const {
  Consent, VerificationRequest, AccessLog, Student, Enrolment, Institution, Course, Organisation,
} = require('../models');
const { ROLES, CONSENT_STATUS, ORG_STATUS } = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult } = require('../utils/pagination');
const { maskStudentRef } = require('../utils/mask');
const { newConsentId, newRequestId, randomCode } = require('../utils/ids');
const { sha256Hex, canonicalJson } = require('../utils/hash');
const { addDays } = require('../utils/dates');
const { dbState } = require('../config/db');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

// Documented demonstration purposes and the fields each may request (server-enforced allow-list).
const PURPOSES = Object.freeze({
  EMPLOYMENT_VERIFICATION: {
    label: 'Employment background check (demo purpose)',
    allowedFields: ['displayName', 'institutionName', 'programName', 'academicYear', 'enrolmentStatus'],
  },
  HIGHER_EDUCATION_ADMISSION: {
    label: 'Higher-education admission check (demo purpose)',
    allowedFields: ['displayName', 'institutionName', 'programName', 'academicYear', 'yearOfStudy', 'enrolmentStatus', 'admittedOn'],
  },
  SCHOLARSHIP_VERIFICATION: {
    label: 'Scholarship eligibility check (demo purpose)',
    allowedFields: ['displayName', 'institutionName', 'programName', 'academicYear', 'yearOfStudy', 'enrolmentStatus'],
  },
  EDUCATION_LOAN_VERIFICATION: {
    label: 'Education loan check (demo purpose)',
    allowedFields: ['displayName', 'institutionName', 'programName', 'academicYear', 'yearOfStudy', 'enrolmentStatus', 'admittedOn'],
  },
});

const FIELD_LABELS = Object.freeze({
  displayName: 'Student name',
  institutionName: 'Institution',
  programName: 'Programme',
  academicYear: 'Academic year',
  yearOfStudy: 'Year of study',
  enrolmentStatus: 'Enrolment status',
  admittedOn: 'Admission date',
});

const EXPIRY_OPTIONS_DAYS = Object.freeze([1, 7, 30]);

function getOptions() {
  return {
    purposes: Object.entries(PURPOSES).map(([code, purpose]) => ({ code, label: purpose.label, allowedFields: purpose.allowedFields })),
    fieldLabels: FIELD_LABELS,
    expiryOptionsDays: EXPIRY_OPTIONS_DAYS,
    policyNote: 'Prototype policy: student consent is required for every request. Bulk verification is not available.',
  };
}

// Marks overdue pending/approved consents as EXPIRED so status is always current when read.
async function expireDue(filter = {}) {
  const now = new Date();
  const due = { ...filter, status: { $in: [CONSENT_STATUS.PENDING, CONSENT_STATUS.APPROVED] }, expiresAt: { $lte: now } };
  await Promise.all([
    Consent.updateMany(due, { $set: { status: CONSENT_STATUS.EXPIRED } }),
    VerificationRequest.updateMany(due, { $set: { status: CONSENT_STATUS.EXPIRED } }),
  ]);
}

async function withOptionalTransaction(work) {
  if (!dbState.transactionsSupported) return work(undefined);
  let result;
  await mongoose.connection.transaction(async (session) => { result = await work(session); });
  return result;
}

async function requireApprovedVerifierOrg(user) {
  if (user.role !== ROLES.VERIFIER) throw forbidden('Only verifier accounts can create verification requests.');
  const org = user.organisationId ? await Organisation.findById(user.organisationId).lean() : null;
  if (!org || org.status !== ORG_STATUS.APPROVED) {
    throw forbidden('Your verifier organisation is not approved yet. Complete onboarding first.', 'ORG_NOT_APPROVED');
  }
  return org;
}

function verifierView(request, consent) {
  return {
    requestId: request.requestId,
    status: request.status,
    purpose: request.purpose,
    purposeLabel: PURPOSES[request.purpose]?.label || request.purpose,
    requestedFields: request.requestedFields,
    approvedFields: consent && consent.status === CONSENT_STATUS.APPROVED ? consent.approvedFields : [],
    studentRefMasked: maskStudentRef(request.studentRef),
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    lastAccessedAt: request.lastAccessedAt || null,
    canViewResult: request.status === CONSENT_STATUS.APPROVED && new Date(request.expiresAt) > new Date(),
    canCancel: request.status === CONSENT_STATUS.PENDING,
  };
}

async function createRequest(user, { studentRef, purpose, requestedFields, expiryDays }) {
  const org = await requireApprovedVerifierOrg(user);
  const purposeRule = PURPOSES[purpose];
  if (!purposeRule) throw unprocessable('PURPOSE_INVALID', 'Choose one of the documented demonstration purposes.');
  const fields = [...new Set(requestedFields)];
  const notAllowed = fields.filter((field) => !purposeRule.allowedFields.includes(field));
  if (fields.length === 0 || notAllowed.length > 0) {
    throw unprocessable('FIELD_NOT_ALLOWED', 'Some requested fields are not allowed for this purpose.', { notAllowed, allowedFields: purposeRule.allowedFields });
  }
  if (!EXPIRY_OPTIONS_DAYS.includes(expiryDays)) throw unprocessable('EXPIRY_INVALID', `Expiry must be one of ${EXPIRY_OPTIONS_DAYS.join(', ')} days.`);

  // Knowing a reference does not reveal anything: the reply never includes record details.
  const student = await Student.findOne({ studentRef }, { studentRef: 1 }).lean();
  const hasRecord = student ? await Enrolment.exists({ studentRef }) : null;
  if (!student || !hasRecord) throw unprocessable('STUDENT_REFERENCE_NOT_FOUND', 'No register record matches this student reference.');

  const duplicate = await VerificationRequest.exists({ verifierUserId: user.id, studentRef, purpose, status: CONSENT_STATUS.PENDING });
  if (duplicate) throw conflict('DUPLICATE_PENDING_REQUEST', 'You already have a pending request for this student and purpose.');

  const expiresAt = addDays(new Date(), expiryDays);
  const requestId = newRequestId();
  const consentId = newConsentId();
  await withOptionalTransaction(async (session) => {
    const options = session ? { session } : {};
    await Consent.create([{ consentId, requestId, studentRef, verifierUserId: user.id, verifierOrgId: org._id, purpose, requestedFields: fields, expiresAt }], options);
    await VerificationRequest.create([{ requestId, consentId, studentRef, verifierUserId: user.id, verifierOrgId: org._id, purpose, requestedFields: fields, expiresAt }], options);
    await recordAudit({
      actor: user, action: 'VERIFICATION_REQUESTED', entityType: 'VerificationRequest', entityRef: requestId,
      payload: { purpose, fields, expiryDays, studentRefMasked: maskStudentRef(studentRef), verifierOrg: org.orgCode },
    }, options);
  });
  await notifications.safely(notifications.notifyStudent(studentRef, {
    type: 'CONSENT_REQUESTED', message: `${org.name} requested your consent to verify ${fields.length} field(s) for: ${purposeRule.label}.`,
    entityType: 'Consent', entityRef: consentId, link: '/student/consents',
  }), 'consent-request');
  const request = await VerificationRequest.findOne({ requestId }).lean();
  return verifierView(request, null);
}

async function listForVerifier(user, query) {
  if (user.role !== ROLES.VERIFIER) throw forbidden('Only verifiers can list verification requests.');
  await expireDue({ verifierUserId: user.id });
  const filter = { verifierUserId: user.id };
  if (Object.values(CONSENT_STATUS).includes(query.status)) filter.status = query.status;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    VerificationRequest.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    VerificationRequest.countDocuments(filter),
  ]);
  const consents = await Consent.find({ consentId: { $in: items.map((item) => item.consentId) } }).lean();
  const byId = new Map(consents.map((consent) => [consent.consentId, consent]));
  return pageResult(items.map((item) => verifierView(item, byId.get(item.consentId))), total, pagination);
}

async function studentConsentView(consent) {
  const org = await Organisation.findById(consent.verifierOrgId, { name: 1, verifierCategory: 1 }).lean();
  return {
    consentId: consent.consentId,
    requestId: consent.requestId,
    status: consent.status,
    requester: { name: org?.name || 'Unknown organisation', category: org?.verifierCategory || null },
    purpose: consent.purpose,
    purposeLabel: PURPOSES[consent.purpose]?.label || consent.purpose,
    requestedFields: consent.requestedFields,
    approvedFields: consent.approvedFields,
    expiresAt: consent.expiresAt,
    createdAt: consent.createdAt,
    approvedAt: consent.approvedAt || null,
    deniedAt: consent.deniedAt || null,
    revokedAt: consent.revokedAt || null,
    receiptHash: consent.receiptHash || null,
    mode: consent.mode,
    modeNote: 'Prototype consent record. It is stored with a plain hash receipt and is NOT a digitally signed consent artefact.',
  };
}

// GET /api/verification-requests/:id - each side sees only its own view.
async function getRequest(user, requestId) {
  if (typeof requestId !== 'string' || requestId.length > 40) throw notFound('Request not found.');
  if (user.role === ROLES.VERIFIER) {
    await expireDue({ requestId });
    const request = await VerificationRequest.findOne({ requestId, verifierUserId: user.id }).lean();
    if (!request) throw notFound('Request not found.');
    const consent = await Consent.findOne({ consentId: request.consentId }).lean();
    return verifierView(request, consent);
  }
  if (user.role === ROLES.STUDENT) {
    await expireDue({ requestId });
    const consent = await Consent.findOne({ requestId, studentRef: user.studentRef }).lean();
    if (!consent) throw notFound('Request not found.');
    return studentConsentView(consent);
  }
  throw forbidden('Your role cannot view verification requests.');
}

// Builds the disclosed values from the CURRENT register (never from a cached copy).
async function buildDisclosure(studentRef, fields) {
  const [student, enrolment] = await Promise.all([
    Student.findOne({ studentRef }, { displayName: 1 }).lean(),
    Enrolment.findOne({ studentRef }, { history: 0, contactToken: 0 }).sort({ createdAt: -1 }).lean(),
  ]);
  const [institution, course] = enrolment
    ? await Promise.all([Institution.findById(enrolment.institutionId, { name: 1 }).lean(), Course.findById(enrolment.courseId, { programName: 1 }).lean()])
    : [null, null];
  const all = {
    displayName: student?.displayName,
    institutionName: institution?.name,
    programName: course?.programName,
    academicYear: enrolment?.academicYear,
    yearOfStudy: enrolment?.yearOfStudy,
    enrolmentStatus: enrolment?.state,
    admittedOn: enrolment?.admittedOn,
  };
  const disclosed = {};
  for (const field of fields) disclosed[field] = all[field] ?? null;
  return disclosed;
}

async function getResult(user, requestId) {
  if (user.role !== ROLES.VERIFIER) throw forbidden('Only the requesting verifier can view a verification result.');
  await expireDue({ requestId });
  const request = await VerificationRequest.findOne({ requestId, verifierUserId: user.id }).lean();
  if (!request) throw notFound('Request not found.');
  const consent = await Consent.findOne({ consentId: request.consentId, requestId }).lean();
  // Consent is checked on EVERY read: approved, not expired, not revoked.
  if (!consent || consent.status !== CONSENT_STATUS.APPROVED || new Date(consent.expiresAt) <= new Date()) {
    throw forbidden(`No active consent for this request (status ${consent ? consent.status : 'missing'}). No student data is released.`, 'CONSENT_NOT_ACTIVE');
  }
  const fields = consent.approvedFields;
  const disclosed = await buildDisclosure(request.studentRef, fields);
  const org = await Organisation.findById(request.verifierOrgId, { name: 1, orgCode: 1 }).lean();
  const accessRef = `ACC-${randomCode(12)}`;
  await AccessLog.create({
    accessRef, studentRef: request.studentRef, requestId, consentId: consent.consentId, verifierUserId: user.id,
    verifierOrgId: request.verifierOrgId, verifierOrgName: org?.name || 'Unknown', purpose: request.purpose, fieldsDisclosed: fields,
  });
  await VerificationRequest.updateOne({ requestId }, { $set: { lastAccessedAt: new Date(), resultReference: accessRef } });
  await recordAudit({
    actor: user, action: 'VERIFICATION_RESULT_ACCESSED', entityType: 'VerificationRequest', entityRef: requestId,
    payload: { accessRef, fields, purpose: request.purpose },
  });
  return {
    requestId,
    purpose: request.purpose,
    approvedFields: fields,
    fieldLabels: FIELD_LABELS,
    data: disclosed,
    retrievedAt: new Date().toISOString(),
    accessRef,
    consentExpiresAt: consent.expiresAt,
    notice: 'Values come from the prototype register with synthetic data. This is not an official verification and does not prove identity.',
  };
}

async function cancelRequest(user, requestId) {
  if (user.role !== ROLES.VERIFIER) throw forbidden('Only the requesting verifier can cancel a request.');
  const request = await VerificationRequest.findOneAndUpdate(
    { requestId, verifierUserId: user.id, status: CONSENT_STATUS.PENDING },
    { $set: { status: CONSENT_STATUS.CANCELLED, cancelledAt: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!request) {
    const exists = await VerificationRequest.exists({ requestId, verifierUserId: user.id });
    if (!exists) throw notFound('Request not found.');
    throw conflict('REQUEST_NOT_PENDING', 'Only a pending request can be cancelled.');
  }
  await Consent.updateOne({ consentId: request.consentId, status: CONSENT_STATUS.PENDING }, { $set: { status: CONSENT_STATUS.CANCELLED } });
  await recordAudit({ actor: user, action: 'VERIFICATION_CANCELLED', entityType: 'VerificationRequest', entityRef: requestId });
  return verifierView(request, null);
}

// --- Student side -------------------------------------------------------------------------------
function requireStudent(user) {
  if (user.role !== ROLES.STUDENT || !user.studentRef) throw forbidden('Only a student can manage their own consent.');
}

async function listConsents(user, query) {
  requireStudent(user);
  await expireDue({ studentRef: user.studentRef });
  const filter = { studentRef: user.studentRef };
  if (Object.values(CONSENT_STATUS).includes(query.status)) filter.status = query.status;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    Consent.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Consent.countDocuments(filter),
  ]);
  return { ...pageResult(await Promise.all(items.map(studentConsentView)), total, pagination), fieldLabels: FIELD_LABELS };
}

async function loadOwnConsent(user, consentId) {
  requireStudent(user);
  if (typeof consentId !== 'string' || consentId.length > 40) throw notFound('Consent request not found.');
  await expireDue({ consentId });
  // Another student's consent is concealed as "not found".
  const consent = await Consent.findOne({ consentId, studentRef: user.studentRef }).lean();
  if (!consent) throw notFound('Consent request not found.');
  return consent;
}

async function decide(user, consentId, decision, { approvedFields, note }) {
  const consent = await loadOwnConsent(user, consentId);
  const now = new Date();
  let set;
  let fromStatus;
  if (decision === 'APPROVE') {
    fromStatus = CONSENT_STATUS.PENDING;
    const fields = [...new Set(approvedFields || [])];
    const outside = fields.filter((field) => !consent.requestedFields.includes(field));
    if (fields.length === 0 || outside.length > 0) {
      throw unprocessable('APPROVED_FIELDS_INVALID', 'Approve at least one field, and only fields that were requested.', { outside });
    }
    const receiptHash = sha256Hex(canonicalJson({
      consentId: consent.consentId, requestId: consent.requestId, studentRef: consent.studentRef, verifierOrgId: String(consent.verifierOrgId),
      purpose: consent.purpose, approvedFields: fields, expiresAt: consent.expiresAt, approvedAt: now,
    }));
    set = { status: CONSENT_STATUS.APPROVED, approvedFields: fields, approvedAt: now, receiptHash, decisionNote: note || undefined };
  } else if (decision === 'DENY') {
    fromStatus = CONSENT_STATUS.PENDING;
    set = { status: CONSENT_STATUS.DENIED, deniedAt: now, decisionNote: note || undefined };
  } else {
    fromStatus = CONSENT_STATUS.APPROVED;
    set = { status: CONSENT_STATUS.REVOKED, revokedAt: now, decisionNote: note || undefined };
  }
  if (consent.status !== fromStatus) {
    throw conflict('CONSENT_STATE_CONFLICT', `This request is ${consent.status}; it cannot be ${decision === 'REVOKE' ? 'revoked' : 'decided'} now.`);
  }
  const updated = await Consent.findOneAndUpdate(
    { consentId, studentRef: user.studentRef, status: fromStatus, expiresAt: { $gt: now } },
    { $set: set },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('CONSENT_STATE_CONFLICT', 'This request changed or expired. Refresh and try again.');
  await VerificationRequest.updateOne({ requestId: consent.requestId }, { $set: { status: set.status } });
  const action = { APPROVE: 'CONSENT_APPROVED', DENY: 'CONSENT_DENIED', REVOKE: 'CONSENT_REVOKED' }[decision];
  await recordAudit({
    actor: user, action, entityType: 'Consent', entityRef: consentId,
    payload: { requestId: consent.requestId, approvedFields: set.approvedFields || [], purpose: consent.purpose },
  });
  const verb = { APPROVE: 'approved', DENY: 'denied', REVOKE: 'revoked' }[decision];
  await notifications.safely(notifications.notifyUsers([consent.verifierUserId], {
    type: 'CONSENT_DECISION', message: `The student ${verb} verification request ${consent.requestId}.`,
    entityType: 'VerificationRequest', entityRef: consent.requestId, link: `/verifier/requests/${consent.requestId}`,
  }), 'consent-decision');
  return studentConsentView(updated);
}

async function listAccessLog(user, query) {
  requireStudent(user);
  const pagination = readPagination(query);
  const filter = { studentRef: user.studentRef };
  const [items, total] = await Promise.all([
    AccessLog.find(filter).sort({ accessedAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    AccessLog.countDocuments(filter),
  ]);
  return {
    ...pageResult(items.map((item) => ({
      accessRef: item.accessRef, verifierName: item.verifierOrgName, purpose: item.purpose,
      purposeLabel: PURPOSES[item.purpose]?.label || item.purpose, fieldsDisclosed: item.fieldsDisclosed, accessedAt: item.accessedAt, requestId: item.requestId,
    })), total, pagination),
    fieldLabels: FIELD_LABELS,
  };
}

module.exports = {
  PURPOSES, FIELD_LABELS, EXPIRY_OPTIONS_DAYS, getOptions, expireDue, createRequest, listForVerifier, getRequest, getResult, cancelRequest,
  listConsents, approve: (user, id, body) => decide(user, id, 'APPROVE', body), deny: (user, id, body) => decide(user, id, 'DENY', body),
  revoke: (user, id, body) => decide(user, id, 'REVOKE', body), listAccessLog,
};
