// Official enrolment records and their lifecycle (spec 07 section 7).
// All state changes go through applyTransition(), which uses the single transition table in
// config/constants.js and releases seats exactly once.
const { Enrolment, Institution, Student, Course } = require('../models');
const {
  ROLES, COLLEGE_ROLES, ENROLMENT_STATE, SEAT_OCCUPYING_STATES, ENROLMENT_TRANSITIONS, getEnrolmentTransition,
} = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult, escapeRegex, readSearch } = require('../utils/pagination');
const { maskStudentRef, initials } = require('../utils/mask');
const { runInTransaction } = require('../utils/transaction');
const { releaseSeat } = require('./seatLedgerService');
const { recordAudit } = require('./auditService');

/**
 * Changes one enrolment's state inside the caller's transaction.
 * @returns {Promise<{ enrolment, seatEffect }>}
 */
async function applyTransition({ enrolmentRef, toState, reason, actor, session, relatedConflictId, transferDestination }) {
  const enrolment = await Enrolment.findOne({ enrolmentRef }).session(session).lean();
  if (!enrolment) throw notFound('Enrolment not found.');
  const rule = getEnrolmentTransition(enrolment.state, toState);
  if (!rule) {
    throw conflict('INVALID_ENROLMENT_TRANSITION', `An enrolment cannot move from ${enrolment.state} to ${toState}.`, {
      from: enrolment.state, to: toState,
    });
  }
  const releasing = rule.seatEffect === 'RELEASE';
  const filter = { _id: enrolment._id, version: enrolment.version, state: enrolment.state };
  if (releasing) filter.seatHeld = true; // exactly-once release guard
  const updated = await Enrolment.findOneAndUpdate(
    filter,
    {
      $set: {
        state: toState,
        seatHeld: releasing ? false : enrolment.seatHeld,
        ...(transferDestination ? { transferDestination } : {}),
      },
      $inc: { version: 1 },
      $push: {
        history: {
          fromState: enrolment.state,
          toState,
          seatEffect: rule.seatEffect,
          reason,
          actorId: actor.id,
          actorRole: actor.role,
          at: new Date(),
          relatedConflictId,
        },
      },
    },
    { session, returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('ENROLMENT_CHANGED_CONCURRENTLY', 'The enrolment changed in the meantime. Refresh and try again.');
  if (releasing) {
    await releaseSeat({ courseId: enrolment.courseId, academicYear: enrolment.academicYear, bucketCode: enrolment.bucketCode }, session);
  }
  await recordAudit({
    actor,
    action: 'ENROLMENT_STATE_CHANGED',
    entityType: 'Enrolment',
    entityRef: enrolmentRef,
    institutionId: enrolment.institutionId,
    regionIds: [enrolment.regionId],
    reason,
    payload: { from: enrolment.state, to: toState, seatEffect: rule.seatEffect, relatedConflictId: relatedConflictId || null },
  }, { session });
  return { enrolment: updated, seatEffect: rule.seatEffect };
}

// Which enrolments a role may list. Students/issuers/verifiers use their own endpoints.
async function scopeFilter(user) {
  switch (user.role) {
    case ROLES.COLLEGE_OPERATOR:
    case ROLES.COLLEGE_HEAD:
      return { institutionId: user.institutionId };
    case ROLES.AICTE_REGIONAL_OFFICER:
      return { regionId: { $in: user.regionIds } };
    case ROLES.AICTE_NATIONAL_OFFICER:
      return {};
    default:
      throw forbidden('Your role cannot list enrolment records.');
  }
}

async function listEnrolments(user, query) {
  const filter = await scopeFilter(user);
  if (typeof query.state === 'string' && Object.values(ENROLMENT_STATE).includes(query.state)) filter.state = query.state;
  if (typeof query.academicYear === 'string' && /^\d{4}-\d{2}$/.test(query.academicYear)) filter.academicYear = query.academicYear;
  if (typeof query.courseCode === 'string' && /^[A-Z0-9_-]{1,20}$/i.test(query.courseCode)) filter.courseCode = query.courseCode.toUpperCase();
  if (typeof query.institutionId === 'string' && /^[a-f0-9]{24}$/.test(query.institutionId) && !COLLEGE_ROLES.includes(user.role)) {
    filter.institutionId = query.institutionId; // still combined with the regional scope filter above
  }
  const isCollege = COLLEGE_ROLES.includes(user.role);
  const search = readSearch(query);
  if (search && isCollege) {
    const students = await Student.find(
      { $or: [{ studentCode: { $regex: escapeRegex(search), $options: 'i' } }, { displayName: { $regex: escapeRegex(search), $options: 'i' } }] },
      { studentRef: 1 }
    ).limit(200).lean();
    filter.studentRef = { $in: students.map((student) => student.studentRef) };
  }
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    Enrolment.find(filter, { history: 0, contactToken: 0 }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Enrolment.countDocuments(filter),
  ]);
  const students = await Student.find({ studentRef: { $in: items.map((item) => item.studentRef) } }, { studentRef: 1, studentCode: 1, displayName: 1 }).lean();
  const studentsByRef = new Map(students.map((student) => [student.studentRef, student]));
  const institutions = await Institution.find({ _id: { $in: items.map((item) => item.institutionId) } }, { name: 1, institutionCode: 1 }).lean();
  const institutionNames = new Map(institutions.map((item) => [String(item._id), item]));
  return pageResult(
    items.map((item) => {
      const student = studentsByRef.get(item.studentRef);
      const institution = institutionNames.get(String(item.institutionId));
      return {
        enrolmentRef: item.enrolmentRef,
        // College users see their own students; AICTE officers see masked identity by default.
        student: isCollege
          ? { studentCode: student?.studentCode, displayName: student?.displayName }
          : { studentRefMasked: maskStudentRef(item.studentRef), initials: initials(student?.displayName) },
        institutionCode: institution?.institutionCode,
        institutionName: institution?.name,
        courseCode: item.courseCode,
        academicYear: item.academicYear,
        yearOfStudy: item.yearOfStudy,
        bucketCode: isCollege ? item.bucketCode : undefined,
        state: item.state,
        admittedOn: isCollege ? item.admittedOn : undefined,
        sourceBatchId: isCollege ? item.sourceBatchId : undefined,
        updatedAt: item.updatedAt,
      };
    }),
    total,
    pagination
  );
}

async function getEnrolment(user, enrolmentRef) {
  if (!COLLEGE_ROLES.includes(user.role)) throw forbidden('Only college users can open enrolment details.');
  const enrolment = await Enrolment.findOne({ enrolmentRef, institutionId: user.institutionId }, { contactToken: 0 }).lean();
  if (!enrolment) throw notFound('Enrolment not found.');
  const [student, course] = await Promise.all([
    Student.findOne({ studentRef: enrolment.studentRef }, { studentCode: 1, displayName: 1, externalLinkStatus: 1 }).lean(),
    Course.findById(enrolment.courseId, { programName: 1, durationYears: 1 }).lean(),
  ]);
  const allowedTransitions = Object.keys(ENROLMENT_TRANSITIONS[enrolment.state] || {});
  return {
    enrolment: { ...enrolment, _id: undefined, studentId: undefined },
    student: { studentCode: student?.studentCode, displayName: student?.displayName, externalLinkStatus: student?.externalLinkStatus },
    course: { programName: course?.programName, durationYears: course?.durationYears },
    allowedTransitions: user.role === ROLES.COLLEGE_HEAD ? allowedTransitions : [],
  };
}

// PATCH /api/enrolments/:id/state - college head of the enrolment's own institution only.
async function changeState(user, enrolmentRef, toState, reason) {
  if (user.role !== ROLES.COLLEGE_HEAD) throw forbidden('Only the college head can change an official enrolment state.');
  if (!Object.values(ENROLMENT_STATE).includes(toState)) throw unprocessable('INVALID_STATE', 'Unknown target state.');
  const owned = await Enrolment.findOne({ enrolmentRef, institutionId: user.institutionId }, { _id: 1 }).lean();
  if (!owned) throw notFound('Enrolment not found.');
  // Required here (not at the top) because conflictService also imports this file.
  const { resolveConflictsIfCleared } = require('./conflictService');
  return runInTransaction(async (session) => {
    const result = await applyTransition({ enrolmentRef, toState, reason, actor: user, session });
    let resolvedConflicts = [];
    if (!SEAT_OCCUPYING_STATES.includes(toState)) {
      resolvedConflicts = await resolveConflictsIfCleared({
        studentRef: result.enrolment.studentRef,
        academicYear: result.enrolment.academicYear,
        resolutionType: toState,
        reason,
        actor: user,
        session,
      });
    }
    return { enrolmentRef, state: result.enrolment.state, seatEffect: result.seatEffect, resolvedConflicts };
  });
}

module.exports = { applyTransition, listEnrolments, getEnrolment, changeState };
