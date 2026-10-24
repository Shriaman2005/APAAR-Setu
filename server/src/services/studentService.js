// Student's own record and correction requests (the official record never changes until an
// authorised institution user reviews the request).
const { Student, Enrolment, Institution, Course, CorrectionRequest, Consent, Credential, User } = require('../models');
const { ROLES, COLLEGE_ROLES, CONSENT_STATUS } = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult } = require('../utils/pagination');
const { maskIdentifier } = require('../utils/mask');
const { newCorrectionRequestId } = require('../utils/ids');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

const PERSON_NAME = /^\p{L}[\p{L} .'-]{0,119}$/u;

function requireStudent(user) {
  if (user.role !== ROLES.STUDENT || !user.studentRef) throw forbidden('Only a student can view their own record.');
}

async function getMyRecord(user) {
  requireStudent(user);
  const student = await Student.findOne({ studentRef: user.studentRef }).lean();
  if (!student) throw notFound('No register record is linked to your account yet.');
  const enrolments = await Enrolment.find({ studentRef: user.studentRef }, { contactToken: 0 }).sort({ createdAt: -1 }).lean();
  const [institutions, courses, pendingConsents, credentials] = await Promise.all([
    Institution.find({ _id: { $in: enrolments.map((e) => e.institutionId) } }, { name: 1, institutionCode: 1 }).lean(),
    Course.find({ _id: { $in: enrolments.map((e) => e.courseId) } }, { programName: 1 }).lean(),
    Consent.countDocuments({ studentRef: user.studentRef, status: CONSENT_STATUS.PENDING, expiresAt: { $gt: new Date() } }),
    Credential.countDocuments({ studentRef: user.studentRef }),
  ]);
  const institutionsById = new Map(institutions.map((i) => [String(i._id), i]));
  const coursesById = new Map(courses.map((c) => [String(c._id), c]));
  return {
    student: {
      studentRef: student.studentRef,
      studentCode: student.studentCode,
      displayName: student.displayName,
      externalIdMasked: maskIdentifier(student.syntheticExternalId),
      externalLinkStatus: student.externalLinkStatus,
    },
    enrolments: enrolments.map((enrolment) => ({
      enrolmentRef: enrolment.enrolmentRef,
      institutionName: institutionsById.get(String(enrolment.institutionId))?.name,
      programName: coursesById.get(String(enrolment.courseId))?.programName,
      courseCode: enrolment.courseCode,
      academicYear: enrolment.academicYear,
      yearOfStudy: enrolment.yearOfStudy,
      state: enrolment.state,
      admittedOn: enrolment.admittedOn,
      history: enrolment.history.map((h) => ({ fromState: h.fromState, toState: h.toState, reason: h.reason, at: h.at })),
    })),
    pendingConsents,
    credentials,
    notice: 'Synthetic prototype record. The demo identifier is fictional and was checked only against a MOCK registry.',
  };
}

async function submitCorrection(user, body) {
  requireStudent(user);
  const enrolment = await Enrolment.findOne({ enrolmentRef: body.enrolmentRef, studentRef: user.studentRef }).lean();
  if (!enrolment) throw notFound('Enrolment not found.');
  if (body.correctionType === 'NAME_CORRECTION' && (!body.proposedValue || !PERSON_NAME.test(body.proposedValue.trim()))) {
    throw unprocessable('PROPOSED_VALUE_INVALID', 'Enter the corrected name (letters, spaces, dots, apostrophes and hyphens).', { fieldErrors: { proposedValue: ['invalid'] } });
  }
  const open = await CorrectionRequest.exists({ studentRef: user.studentRef, enrolmentRef: body.enrolmentRef, correctionType: body.correctionType, status: 'SUBMITTED' });
  if (open) throw conflict('DUPLICATE_OPEN_REQUEST', 'You already have an open request of this type for this enrolment.');
  const created = await CorrectionRequest.create({
    correctionRequestId: newCorrectionRequestId(),
    studentRef: user.studentRef,
    enrolmentRef: body.enrolmentRef,
    institutionId: enrolment.institutionId,
    correctionType: body.correctionType,
    explanation: body.explanation,
    evidenceNote: body.evidenceNote || '',
    proposedValue: body.correctionType === 'NAME_CORRECTION' ? body.proposedValue.trim() : undefined,
  });
  await recordAudit({
    actor: user, action: 'CORRECTION_REQUEST_SUBMITTED', entityType: 'CorrectionRequest', entityRef: created.correctionRequestId,
    institutionId: enrolment.institutionId, regionIds: [enrolment.regionId], payload: { correctionType: body.correctionType },
  });
  await notifications.safely(notifications.notifyInstitutionRoles(enrolment.institutionId, [ROLES.COLLEGE_HEAD, ROLES.COLLEGE_OPERATOR], {
    type: 'CORRECTION_REQUESTED', message: `A student submitted a correction request (${body.correctionType}). The official record is unchanged until reviewed.`,
    entityType: 'CorrectionRequest', entityRef: created.correctionRequestId, link: '/college/correction-requests',
  }), 'correction-submit');
  return presentCorrection(created.toObject());
}

function presentCorrection(item, extra = {}) {
  return {
    correctionRequestId: item.correctionRequestId,
    enrolmentRef: item.enrolmentRef,
    correctionType: item.correctionType,
    explanation: item.explanation,
    evidenceNote: item.evidenceNote,
    proposedValue: item.proposedValue || null,
    status: item.status,
    decision: item.decision?.at ? { at: item.decision.at, response: item.decision.response, appliedChange: item.decision.appliedChange || null } : null,
    createdAt: item.createdAt,
    ...extra,
  };
}

async function listMyCorrections(user) {
  requireStudent(user);
  const items = await CorrectionRequest.find({ studentRef: user.studentRef }).sort({ createdAt: -1 }).limit(100).lean();
  return items.map((item) => presentCorrection(item));
}

async function listInstitutionCorrections(user, query) {
  if (!COLLEGE_ROLES.includes(user.role)) throw forbidden('Only college users can view correction requests.');
  const filter = { institutionId: user.institutionId };
  if (['SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(query.status)) filter.status = query.status;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    CorrectionRequest.find(filter).sort({ status: -1, createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    CorrectionRequest.countDocuments(filter),
  ]);
  const students = await Student.find({ studentRef: { $in: items.map((i) => i.studentRef) } }, { studentRef: 1, studentCode: 1, displayName: 1 }).lean();
  const byRef = new Map(students.map((s) => [s.studentRef, s]));
  return pageResult(items.map((item) => presentCorrection(item, {
    student: { studentCode: byRef.get(item.studentRef)?.studentCode, displayName: byRef.get(item.studentRef)?.displayName },
    canDecide: user.role === ROLES.COLLEGE_HEAD && item.status === 'SUBMITTED',
  })), total, pagination);
}

async function decideCorrection(user, correctionRequestId, { decision, response }) {
  if (user.role !== ROLES.COLLEGE_HEAD) throw forbidden('Only the college head can decide a correction request.');
  const item = await CorrectionRequest.findOne({ correctionRequestId, institutionId: user.institutionId }).lean();
  if (!item) throw notFound('Correction request not found.');
  if (item.status !== 'SUBMITTED') throw conflict('ALREADY_DECIDED', 'This request was already decided.');
  let appliedChange = null;
  if (decision === 'ACCEPT' && item.correctionType === 'NAME_CORRECTION') {
    const student = await Student.findOne({ studentRef: item.studentRef }).lean();
    await Student.updateOne(
      { _id: student._id },
      {
        $set: { displayName: item.proposedValue },
        $push: { nameHistory: { from: student.displayName, to: item.proposedValue, reason: response, by: user.id, at: new Date(), correctionRequestId } },
      }
    );
    appliedChange = 'Register name updated';
  } else if (decision === 'ACCEPT') {
    appliedChange = 'Accepted; the institution will submit corrected data through a certified batch or lifecycle change';
  }
  const updated = await CorrectionRequest.findOneAndUpdate(
    { _id: item._id, status: 'SUBMITTED' },
    { $set: { status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', decision: { by: user.id, at: new Date(), response, appliedChange } } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('ALREADY_DECIDED', 'This request was already decided.');
  const enrolment = await Enrolment.findOne({ enrolmentRef: item.enrolmentRef }, { regionId: 1 }).lean();
  await recordAudit({
    actor: user, action: 'CORRECTION_REQUEST_DECIDED', entityType: 'CorrectionRequest', entityRef: correctionRequestId,
    institutionId: user.institutionId, regionIds: enrolment ? [enrolment.regionId] : [], reason: response, payload: { decision, appliedChange },
  });
  await notifications.safely(notifications.notifyStudent(item.studentRef, {
    type: 'CORRECTION_DECIDED', message: `Your correction request was ${decision === 'ACCEPT' ? 'accepted' : 'rejected'} by your institution.`,
    entityType: 'CorrectionRequest', entityRef: correctionRequestId, link: '/student/corrections',
  }), 'correction-decision');
  return presentCorrection(updated);
}

// Used by the admin user form to show which students have no login yet (masked).
async function studentsWithoutAccounts(limit = 50) {
  const linked = await User.distinct('studentRef', { studentRef: { $type: 'string' } });
  const students = await Student.find({ studentRef: { $nin: linked } }, { studentCode: 1 }).sort({ studentCode: 1 }).limit(limit).lean();
  return students.map((student) => student.studentCode);
}

module.exports = { getMyRecord, submitCorrection, listMyCorrections, listInstitutionCorrections, decideCorrection, studentsWithoutAccounts };
