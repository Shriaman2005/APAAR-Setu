// Prototype credentials and QR status checks (spec 04 section 8, spec 08 section 5).
//
// WHAT THE QR PROVES: the QR holds a URL with an opaque reference
//   CRD-<32 random hex>-<12 hex keyed checksum>
// The checksum (HMAC with a server secret) lets the server reject altered or invented references
// before any database lookup. The status page then reports the CURRENT stored status
// (VALID / REVOKED / INVALID_OR_TAMPERED). It is NOT a signed verifiable credential: it cannot be
// verified offline and does not prove the holder's identity.
const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  Credential, Enrolment, Student, Institution, Course, Organisation, User, Notification,
} = require('../models');
const { ROLES, CREDENTIAL_STATUS, ENROLMENT_STATE, ORG_STATUS, USER_STATUS } = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult, escapeRegex, readSearch } = require('../utils/pagination');
const { initials, maskIdentifier } = require('../utils/mask');
const { safeEqual } = require('../utils/hash');
const { simulatePush } = require('../adapters/mockDigiLockerAdapter');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

const CREDENTIAL_TYPES = Object.freeze({
  ENROLMENT_CERTIFICATE_DEMO: { label: 'Enrolment certificate (DEMO)', eligibleStates: [ENROLMENT_STATE.CONFIRMED] },
  COMPLETION_CERTIFICATE_DEMO: { label: 'Programme completion certificate (DEMO)', eligibleStates: [ENROLMENT_STATE.COMPLETED] },
});
const REF_PATTERN = /^CRD-([0-9a-f]{32})-([0-9a-f]{12})$/;
const DISCLAIMER = 'Prototype status check against synthetic demo data. This is NOT a cryptographically signed credential, cannot be verified offline and does not prove the holder\'s identity.';

function checksum(randomPart, secret) {
  return crypto.createHmac('sha256', secret).update(randomPart).digest('hex').slice(0, 12);
}

function newCredentialRef(secret) {
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `CRD-${randomPart}-${checksum(randomPart, secret)}`;
}

function isWellFormedRef(ref, secret) {
  const match = REF_PATTERN.exec(String(ref || ''));
  return Boolean(match) && safeEqual(match[2], checksum(match[1], secret));
}

function verifyUrl(ref, config) {
  return `${config.publicVerifyBaseUrl.replace(/\/$/, '')}/verify/${ref}`;
}

// --- Public status endpoint ------------------------------------------------------------------
async function publicStatus(ref, config) {
  const base = { verificationMode: 'URL_REFERENCE_UNSIGNED_DEMO', checkedAt: new Date().toISOString(), disclaimer: DISCLAIMER };
  if (!isWellFormedRef(ref, config.credentialRefSecret)) return { ...base, status: 'INVALID_OR_TAMPERED' };
  const credential = await Credential.findOne({ credentialRef: ref }).lean();
  if (!credential) return { ...base, status: 'INVALID_OR_TAMPERED' };
  const issuer = await Organisation.findById(credential.issuerOrgId, { name: 1 }).lean();
  // Minimal disclosure: no student name, identifiers, course or institution.
  const common = {
    credentialType: credential.credentialType,
    credentialTypeLabel: CREDENTIAL_TYPES[credential.credentialType]?.label,
    issuerName: issuer?.name || 'Unknown issuer',
    issuedOn: credential.issuedAt.toISOString().slice(0, 10),
    referenceFingerprint: ref.slice(-6),
  };
  if (credential.status === CREDENTIAL_STATUS.REVOKED) {
    return { ...base, ...common, status: 'REVOKED', revokedOn: credential.revokedAt.toISOString().slice(0, 10) };
  }
  return { ...base, ...common, status: 'VALID' };
}

// --- Issuer scope ----------------------------------------------------------------------------
async function issuerScope(user) {
  if (user.role !== ROLES.DEGREE_AWARDING_BODY) throw forbidden('Only degree-awarding body accounts can issue credentials.');
  const org = user.organisationId ? await Organisation.findById(user.organisationId).lean() : null;
  if (!org || org.status !== ORG_STATUS.APPROVED) throw forbidden('Your issuer organisation is not approved.', 'ORG_NOT_APPROVED');
  return { org, institutionIds: org.affiliatedInstitutionIds || [] };
}

async function searchEligible(user, query) {
  const { institutionIds } = await issuerScope(user);
  const filter = { institutionId: { $in: institutionIds }, state: { $in: [ENROLMENT_STATE.CONFIRMED, ENROLMENT_STATE.COMPLETED] } };
  const search = readSearch(query);
  if (search) {
    const students = await Student.find(
      { $or: [{ studentCode: search.toUpperCase() }, { displayName: { $regex: escapeRegex(search), $options: 'i' } }] },
      { studentRef: 1 }
    ).limit(100).lean();
    filter.studentRef = { $in: students.map((student) => student.studentRef) };
  }
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    Enrolment.find(filter, { history: 0, contactToken: 0 }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Enrolment.countDocuments(filter),
  ]);
  const [students, institutions, credentials] = await Promise.all([
    Student.find({ studentRef: { $in: items.map((item) => item.studentRef) } }, { studentRef: 1, studentCode: 1, displayName: 1 }).lean(),
    Institution.find({ _id: { $in: items.map((item) => item.institutionId) } }, { institutionCode: 1 }).lean(),
    Credential.find({ enrolmentRef: { $in: items.map((item) => item.enrolmentRef) } }, { enrolmentRef: 1, credentialType: 1, status: 1 }).lean(),
  ]);
  const studentsByRef = new Map(students.map((s) => [s.studentRef, s]));
  const codes = new Map(institutions.map((i) => [String(i._id), i.institutionCode]));
  return pageResult(items.map((item) => {
    const student = studentsByRef.get(item.studentRef);
    return {
      enrolmentRef: item.enrolmentRef,
      studentInitials: initials(student?.displayName),
      studentCodeMasked: maskIdentifier(student?.studentCode, 3),
      institutionCode: codes.get(String(item.institutionId)),
      courseCode: item.courseCode,
      academicYear: item.academicYear,
      state: item.state,
      credentials: credentials.filter((c) => c.enrolmentRef === item.enrolmentRef).map((c) => ({ credentialType: c.credentialType, status: c.status })),
    };
  }), total, pagination);
}

async function loadScopedEnrolment(user, enrolmentRef) {
  const { org, institutionIds } = await issuerScope(user);
  const enrolment = await Enrolment.findOne({ enrolmentRef, institutionId: { $in: institutionIds } }, { history: 0, contactToken: 0 }).lean();
  if (!enrolment) throw notFound('Record not found in your issuer scope.');
  return { org, enrolment };
}

async function getEnrolmentForIssuer(user, enrolmentRef) {
  const { enrolment } = await loadScopedEnrolment(user, enrolmentRef);
  const [student, institution, course, credentials] = await Promise.all([
    Student.findOne({ studentRef: enrolment.studentRef }, { displayName: 1, studentCode: 1 }).lean(),
    Institution.findById(enrolment.institutionId, { name: 1, institutionCode: 1 }).lean(),
    Course.findById(enrolment.courseId, { programName: 1 }).lean(),
    Credential.find({ enrolmentRef }).sort({ issuedAt: -1 }).lean(),
  ]);
  // Minimum fields needed to issue the credential.
  return {
    enrolmentRef,
    student: { displayName: student?.displayName, studentCode: student?.studentCode },
    institution: { code: institution?.institutionCode, name: institution?.name },
    programName: course?.programName,
    courseCode: enrolment.courseCode,
    academicYear: enrolment.academicYear,
    state: enrolment.state,
    eligibleTypes: Object.entries(CREDENTIAL_TYPES).filter(([, type]) => type.eligibleStates.includes(enrolment.state)).map(([code, type]) => ({ code, label: type.label })),
    credentials: credentials.map(presentCredential),
  };
}

function presentCredential(credential) {
  return {
    credentialRef: credential.credentialRef,
    credentialType: credential.credentialType,
    credentialTypeLabel: CREDENTIAL_TYPES[credential.credentialType]?.label,
    status: credential.status,
    issuedAt: credential.issuedAt,
    revokedAt: credential.revokedAt || null,
    revocationReason: credential.revocationReason || null,
    verificationMode: credential.verificationMode,
    snapshot: credential.snapshot,
    mockDigiLockerPush: credential.mockDigiLockerPush,
    enrolmentRef: credential.enrolmentRef,
  };
}

/**
 * Issues a demo credential. Retry semantics: if an ACTIVE credential of the same type already
 * exists for the enrolment, it is returned with idempotentReplay=true instead of creating another.
 */
async function issueCredential(user, { enrolmentRef, credentialType }, config) {
  const { org, enrolment } = await loadScopedEnrolment(user, enrolmentRef);
  const type = CREDENTIAL_TYPES[credentialType];
  if (!type) throw unprocessable('CREDENTIAL_TYPE_INVALID', 'Unknown credential type.');
  if (!type.eligibleStates.includes(enrolment.state)) {
    throw unprocessable('NOT_ELIGIBLE', `A ${type.label} needs an enrolment in state ${type.eligibleStates.join(' or ')} (current: ${enrolment.state}).`);
  }
  const existing = await Credential.findOne({ enrolmentRef, credentialType, status: CREDENTIAL_STATUS.ACTIVE }).lean();
  if (existing) return { idempotentReplay: true, credential: presentCredential(existing), verifyUrl: verifyUrl(existing.credentialRef, config) };

  const [student, institution, course] = await Promise.all([
    Student.findOne({ studentRef: enrolment.studentRef }, { displayName: 1 }).lean(),
    Institution.findById(enrolment.institutionId, { name: 1 }).lean(),
    Course.findById(enrolment.courseId, { programName: 1 }).lean(),
  ]);
  const credentialRef = newCredentialRef(config.credentialRefSecret);
  let created;
  try {
    created = await Credential.create({
      credentialRef,
      studentRef: enrolment.studentRef,
      enrolmentRef,
      issuerOrgId: org._id,
      credentialType,
      issuedBy: user.id,
      snapshot: {
        displayName: student?.displayName, institutionName: institution?.name, programName: course?.programName,
        courseCode: enrolment.courseCode, academicYear: enrolment.academicYear, enrolmentState: enrolment.state,
      },
      mockDigiLockerPush: (({ status, adapter, at }) => ({ status, adapter, at }))(simulatePush({ credentialRef })),
    });
  } catch (error) {
    if (error.code === 11000) {
      const winner = await Credential.findOne({ enrolmentRef, credentialType, status: CREDENTIAL_STATUS.ACTIVE }).lean();
      return { idempotentReplay: true, credential: presentCredential(winner), verifyUrl: verifyUrl(winner.credentialRef, config) };
    }
    throw error;
  }
  await recordAudit({
    actor: user, action: 'CREDENTIAL_ISSUED', entityType: 'Credential', entityRef: credentialRef.slice(0, 12),
    institutionId: enrolment.institutionId, regionIds: [enrolment.regionId], payload: { credentialType, enrolmentRef, issuer: org.orgCode },
  });
  await notifications.safely(notifications.notifyStudent(enrolment.studentRef, {
    type: 'CREDENTIAL_ISSUED', message: `${org.name} issued a ${type.label} to you. It is a prototype credential.`,
    entityType: 'Credential', entityRef: credentialRef, link: '/student/credentials',
  }), 'credential-issued');
  return { idempotentReplay: false, credential: presentCredential(created.toObject()), verifyUrl: verifyUrl(credentialRef, config) };
}

async function listIssuerCredentials(user, query) {
  const { org } = await issuerScope(user);
  const filter = { issuerOrgId: org._id };
  if (Object.values(CREDENTIAL_STATUS).includes(query.status)) filter.status = query.status;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    Credential.find(filter).sort({ issuedAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Credential.countDocuments(filter),
  ]);
  return pageResult(items.map((item) => ({ ...presentCredential(item), snapshot: { ...item.snapshot, displayName: initials(item.snapshot?.displayName) } })), total, pagination);
}

// Issuer of the credential or the student it belongs to.
async function loadCredentialForUser(user, credentialRef) {
  if (typeof credentialRef !== 'string' || credentialRef.length > 60) throw notFound('Credential not found.');
  const credential = await Credential.findOne({ credentialRef }).lean();
  if (!credential) throw notFound('Credential not found.');
  if (user.role === ROLES.STUDENT && credential.studentRef === user.studentRef) return credential;
  if (user.role === ROLES.DEGREE_AWARDING_BODY && String(credential.issuerOrgId) === String(user.organisationId)) return credential;
  throw notFound('Credential not found.');
}

async function getCredential(user, credentialRef, config) {
  const credential = await loadCredentialForUser(user, credentialRef);
  const issuer = await Organisation.findById(credential.issuerOrgId, { name: 1 }).lean();
  return { ...presentCredential(credential), issuerName: issuer?.name, verifyUrl: verifyUrl(credential.credentialRef, config), disclaimer: DISCLAIMER };
}

async function credentialQrPng(user, credentialRef, config) {
  const credential = await loadCredentialForUser(user, credentialRef);
  return QRCode.toBuffer(verifyUrl(credential.credentialRef, config), { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

async function revokeCredential(user, credentialRef, reason) {
  if (user.role !== ROLES.DEGREE_AWARDING_BODY) throw forbidden('Only the issuing body can revoke a credential.');
  const credential = await loadCredentialForUser(user, credentialRef);
  const updated = await Credential.findOneAndUpdate(
    { _id: credential._id, status: CREDENTIAL_STATUS.ACTIVE },
    { $set: { status: CREDENTIAL_STATUS.REVOKED, revokedAt: new Date(), revokedBy: user.id, revocationReason: reason } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('ALREADY_REVOKED', 'This credential is already revoked.');
  const enrolment = await Enrolment.findOne({ enrolmentRef: credential.enrolmentRef }, { institutionId: 1, regionId: 1 }).lean();
  await recordAudit({
    actor: user, action: 'CREDENTIAL_REVOKED', entityType: 'Credential', entityRef: credentialRef.slice(0, 12),
    institutionId: enrolment?.institutionId, regionIds: enrolment ? [enrolment.regionId] : [], reason,
  });
  await notifications.safely(notifications.notifyStudent(credential.studentRef, {
    type: 'CREDENTIAL_REVOKED', message: 'One of your prototype credentials was revoked by its issuer.', entityType: 'Credential', entityRef: credentialRef, link: '/student/credentials',
  }), 'credential-revoked');
  return presentCredential(updated);
}

async function exportIssuerCredentials(user) {
  const { org } = await issuerScope(user);
  const items = await Credential.find({ issuerOrgId: org._id }).sort({ issuedAt: -1 }).limit(5000).lean();
  await recordAudit({ actor: user, action: 'REPORT_EXPORTED', entityType: 'Credential', entityRef: org.orgCode, payload: { report: 'issuer-credentials', rows: items.length } });
  return items.map((item) => ({
    credentialRef: item.credentialRef,
    credentialType: item.credentialType,
    status: item.status,
    studentInitials: initials(item.snapshot?.displayName),
    courseCode: item.snapshot?.courseCode,
    academicYear: item.snapshot?.academicYear,
    issuedAt: item.issuedAt,
    revokedAt: item.revokedAt || '',
  }));
}

// --- Student side ----------------------------------------------------------------------------
async function listStudentCredentials(user, config) {
  if (user.role !== ROLES.STUDENT) throw forbidden('Only students can list their own credentials.');
  const items = await Credential.find({ studentRef: user.studentRef }).sort({ issuedAt: -1 }).lean();
  const issuers = await Organisation.find({ _id: { $in: items.map((item) => item.issuerOrgId) } }, { name: 1 }).lean();
  const names = new Map(issuers.map((issuer) => [String(issuer._id), issuer.name]));
  return items.map((item) => ({ ...presentCredential(item), issuerName: names.get(String(item.issuerOrgId)), verifyUrl: verifyUrl(item.credentialRef, config) }));
}

// "Request credential": notifies the issuer affiliated with the student's institution.
async function requestCredential(user, enrolmentRef) {
  if (user.role !== ROLES.STUDENT) throw forbidden('Only students can request their own credential.');
  const enrolment = await Enrolment.findOne({ enrolmentRef, studentRef: user.studentRef }).lean();
  if (!enrolment) throw notFound('Enrolment not found.');
  const eligible = Object.values(CREDENTIAL_TYPES).some((type) => type.eligibleStates.includes(enrolment.state));
  if (!eligible) throw unprocessable('NOT_ELIGIBLE', `No credential type is available for an enrolment in state ${enrolment.state}.`);
  const issuers = await Organisation.find({ type: 'ISSUER', status: ORG_STATUS.APPROVED, affiliatedInstitutionIds: enrolment.institutionId }, { _id: 1, name: 1 }).lean();
  if (issuers.length === 0) throw unprocessable('NO_ISSUER', 'No degree-awarding body is configured for your institution in this prototype.');
  const issuerUsers = await User.find({ role: ROLES.DEGREE_AWARDING_BODY, organisationId: { $in: issuers.map((i) => i._id) }, status: USER_STATUS.ACTIVE }, { _id: 1 }).lean();
  const recent = await Notification.exists({
    recipientUserId: { $in: issuerUsers.map((u) => u._id) }, type: 'CREDENTIAL_REQUESTED', relatedEntityRef: enrolmentRef,
    createdAt: { $gt: new Date(Date.now() - 24 * 3600 * 1000) },
  });
  if (recent) throw conflict('ALREADY_REQUESTED', 'You already requested a credential for this enrolment in the last 24 hours.');
  await notifications.notifyUsers(issuerUsers.map((u) => u._id), {
    type: 'CREDENTIAL_REQUESTED', message: `A student requested a credential for enrolment ${enrolmentRef}.`, entityType: 'Enrolment', entityRef: enrolmentRef, link: `/issuer/students/${enrolmentRef}`,
  });
  await recordAudit({ actor: user, action: 'CREDENTIAL_REQUESTED', entityType: 'Enrolment', entityRef: enrolmentRef, institutionId: enrolment.institutionId, regionIds: [enrolment.regionId] });
  return { requested: true, issuers: issuers.map((issuer) => issuer.name) };
}

module.exports = {
  CREDENTIAL_TYPES, DISCLAIMER, newCredentialRef, isWellFormedRef, publicStatus, searchEligible, getEnrolmentForIssuer, issueCredential,
  listIssuerCredentials, getCredential, credentialQrPng, revokeCredential, exportIssuerCredentials, listStudentCredentials, requestCredential,
};
