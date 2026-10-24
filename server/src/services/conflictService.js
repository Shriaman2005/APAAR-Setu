// Cross-college conflict cases (spec 05 section 4, spec 07 section 8).
// A case means "this needs review"; it is never an accusation or an automatic verdict.
const { Conflict, Enrolment, Institution, Student, User } = require('../models');
const {
  ROLES, COLLEGE_ROLES, OFFICER_ROLES, CONFLICT_STATUS, CONFLICT_TYPE, SEAT_OCCUPYING_STATES, ENROLMENT_STATE,
} = require('../config/constants');
const { forbidden, notFound, conflict: conflictError, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult } = require('../utils/pagination');
const { maskStudentRef, initials } = require('../utils/mask');
const { newConflictId } = require('../utils/ids');
const { addDays } = require('../utils/dates');
const { runInTransaction } = require('../utils/transaction');
const { recordAudit } = require('./auditService');
const { getSettings } = require('./settingsService');
const notifications = require('./notificationService');
const { applyTransition } = require('./enrolmentService');

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
/**
 * Finds students with seat-holding enrolments at two or more institutions in the same academic
 * year and opens (or extends) one case per student/year. Runs inside the caller's transaction.
 * @returns {Promise<Array>} cases created or extended (for notifications after commit)
 */
async function detectConflictsForStudents(studentRefs, academicYear, { session, actor, detectedBy }) {
  if (studentRefs.length === 0) return [];
  const enrolments = await Enrolment.find(
    { studentRef: { $in: studentRefs }, academicYear, seatHeld: true },
    { enrolmentRef: 1, studentRef: 1, institutionId: 1, regionId: 1, state: 1, createdAt: 1 }
  ).session(session).lean();
  const byStudent = new Map();
  for (const enrolment of enrolments) {
    if (!byStudent.has(enrolment.studentRef)) byStudent.set(enrolment.studentRef, []);
    byStudent.get(enrolment.studentRef).push(enrolment);
  }
  const settings = await getSettings();
  const touched = [];
  for (const [studentRef, list] of byStudent) {
    const institutionIds = new Set(list.map((enrolment) => String(enrolment.institutionId)));
    if (institutionIds.size < 2) continue;
    const refs = list.map((enrolment) => ({
      enrolmentRef: enrolment.enrolmentRef,
      institutionId: enrolment.institutionId,
      regionId: enrolment.regionId,
      stateAtDetection: enrolment.state,
    }));
    const newest = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const existing = await Conflict.findOne({ studentRef, academicYear, isOpen: true }).session(session).lean();
    if (existing) {
      const known = new Set(existing.enrolmentRefs.map((ref) => ref.enrolmentRef));
      const added = refs.filter((ref) => !known.has(ref.enrolmentRef));
      if (added.length === 0) continue;
      await Conflict.updateOne(
        { _id: existing._id },
        {
          $push: {
            enrolmentRefs: { $each: added },
            events: { type: 'ENROLMENT_ADDED', actorRole: 'SYSTEM', message: `${added.length} more active enrolment(s) found for this student.`, at: new Date() },
          },
          $addToSet: {
            involvedInstitutionIds: { $each: added.map((ref) => ref.institutionId) },
            involvedRegionIds: { $each: added.map((ref) => ref.regionId) },
          },
        },
        { session }
      );
      touched.push({ conflictId: existing.conflictId, created: false, institutionIds: [...institutionIds], regionIds: [...new Set(refs.map((r) => r.regionId))] });
      continue;
    }
    const conflictId = newConflictId();
    await Conflict.create([{
      conflictId,
      studentRef,
      academicYear,
      conflictType: CONFLICT_TYPE.MULTIPLE_ACTIVE_ENROLMENTS,
      status: CONFLICT_STATUS.OPEN,
      isOpen: true,
      enrolmentRefs: refs,
      involvedInstitutionIds: [...institutionIds],
      involvedRegionIds: [...new Set(refs.map((ref) => ref.regionId))],
      assignedRegionId: newest.regionId,
      escalationLevel: 'REGIONAL',
      dueAt: addDays(new Date(), settings.conflictReviewSlaDays),
      detectedBy,
      events: [{
        type: 'DETECTED',
        actorRole: 'SYSTEM',
        message: `Candidate conflict: ${institutionIds.size} institutions report an active enrolment for the same student in ${academicYear}. Review required; this is not a finding of wrongdoing.`,
        at: new Date(),
      }],
    }], { session });
    await recordAudit({
      actor: actor || 'system',
      action: 'CONFLICT_DETECTED',
      entityType: 'Conflict',
      entityRef: conflictId,
      regionIds: [...new Set(refs.map((ref) => ref.regionId))],
      payload: { academicYear, institutions: institutionIds.size, detectedBy },
    }, { session });
    touched.push({ conflictId, created: true, institutionIds: [...institutionIds], regionIds: [...new Set(refs.map((r) => r.regionId))] });
  }
  return touched;
}

// Notifications are sent after the transaction commits.
async function notifyConflictParties(touchedCases) {
  for (const item of touchedCases) {
    const message = item.created
      ? `Conflict case ${item.conflictId} opened: a student appears active at more than one institution. Please review your side.`
      : `Conflict case ${item.conflictId} was updated with another active enrolment.`;
    const payload = { type: 'CONFLICT_CASE', message, entityType: 'Conflict', entityRef: item.conflictId };
    for (const institutionId of item.institutionIds) {
      await notifications.safely(
        notifications.notifyInstitutionRoles(institutionId, [ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD], { ...payload, link: `/college/conflicts/${item.conflictId}` }),
        'conflict-institution'
      );
    }
    await notifications.safely(notifications.notifyRegionalOfficers(item.regionIds, { ...payload, link: `/aicte/conflicts/${item.conflictId}` }), 'conflict-region');
  }
}

/**
 * After an enrolment leaves a seat-holding state, closes the open case if at most one
 * institution still holds an active enrolment for that student and year.
 */
async function resolveConflictsIfCleared({ studentRef, academicYear, resolutionType, reason, actor, session }) {
  const open = await Conflict.findOne({ studentRef, academicYear, isOpen: true }).session(session).lean();
  if (!open) return [];
  const active = await Enrolment.find({ studentRef, academicYear, seatHeld: true }, { institutionId: 1 }).session(session).lean();
  const stillActiveInstitutions = new Set(active.map((enrolment) => String(enrolment.institutionId)));
  if (stillActiveInstitutions.size >= 2) return [];
  const mappedType = ['WITHDRAWN', 'TRANSFERRED', 'DROPPED', 'COMPLETED'].includes(resolutionType) ? resolutionType : 'WITHDRAWN';
  await Conflict.updateOne(
    { _id: open._id, isOpen: true },
    {
      $set: {
        status: CONFLICT_STATUS.RESOLVED, isOpen: false, resolutionType: mappedType, resolutionReason: reason, resolvedBy: actor.id, resolvedAt: new Date(),
      },
      $push: { events: { type: 'RESOLVED', actorId: actor.id, actorRole: actor.role, message: `Resolved: only one institution now holds an active enrolment (${mappedType}).`, at: new Date() } },
    },
    { session }
  );
  await recordAudit({
    actor,
    action: 'CONFLICT_RESOLVED',
    entityType: 'Conflict',
    entityRef: open.conflictId,
    regionIds: open.involvedRegionIds,
    reason,
    payload: { resolutionType: mappedType },
  }, { session });
  return [open.conflictId];
}

// ---------------------------------------------------------------------------
// Visibility and presentation
// ---------------------------------------------------------------------------
function scopeFilter(user) {
  if (COLLEGE_ROLES.includes(user.role)) return { involvedInstitutionIds: user.institutionId };
  if (user.role === ROLES.AICTE_REGIONAL_OFFICER) return { involvedRegionIds: { $in: user.regionIds } };
  if (user.role === ROLES.AICTE_NATIONAL_OFFICER) return {};
  throw forbidden('Your role cannot view conflict cases.');
}

async function loadVisibleConflict(user, conflictId) {
  if (typeof conflictId !== 'string' || conflictId.length > 40) throw notFound('Conflict case not found.');
  const found = await Conflict.findOne({ conflictId, ...scopeFilter(user) }).lean();
  if (!found) throw notFound('Conflict case not found.');
  return found;
}

function isOverdue(item) {
  return item.isOpen && item.dueAt && new Date(item.dueAt) < new Date();
}

async function listConflicts(user, query) {
  const filter = scopeFilter(user);
  if (query.status === 'OPEN_ALL') filter.isOpen = true;
  else if (typeof query.status === 'string' && Object.values(CONFLICT_STATUS).includes(query.status)) filter.status = query.status;
  if (query.escalationLevel === 'NATIONAL' || query.escalationLevel === 'REGIONAL') filter.escalationLevel = query.escalationLevel;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    Conflict.find(filter, { events: 0 }).sort({ isOpen: -1, dueAt: 1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Conflict.countDocuments(filter),
  ]);
  const institutionIds = [...new Set(items.flatMap((item) => item.involvedInstitutionIds.map(String)))];
  const institutions = await Institution.find({ _id: { $in: institutionIds } }, { name: 1, institutionCode: 1 }).lean();
  const names = new Map(institutions.map((item) => [String(item._id), item.institutionCode]));
  return pageResult(
    items.map((item) => ({
      conflictId: item.conflictId,
      academicYear: item.academicYear,
      status: item.status,
      escalationLevel: item.escalationLevel,
      // Lists never show unmasked identifiers (spec 06 conflicts constraint).
      studentRefMasked: maskStudentRef(item.studentRef),
      institutions: item.involvedInstitutionIds.map((id) => names.get(String(id)) || 'Unknown'),
      dueAt: item.dueAt,
      overdue: isOverdue(item),
      resolutionType: item.resolutionType || null,
      createdAt: item.createdAt,
    })),
    total,
    pagination
  );
}

function availableActions(user, item, ownSide) {
  const actions = [];
  const open = item.isOpen;
  if (user.role === ROLES.COLLEGE_OPERATOR && open) actions.push('SUBMIT_FACTS');
  if (user.role === ROLES.COLLEGE_HEAD && open && ownSide && SEAT_OCCUPYING_STATES.includes(ownSide.state)) {
    actions.push('WITHDRAW_OWN_ENROLMENT', 'TRANSFER_OWN_ENROLMENT');
    if (item.status === CONFLICT_STATUS.OPEN) actions.push('SUBMIT_JUSTIFICATION');
  }
  if (OFFICER_ROLES.includes(user.role) && open) {
    actions.push('ADD_NOTE');
    if (item.status === CONFLICT_STATUS.AWAITING_REVIEW) actions.push('ACCEPT_JUSTIFICATION', 'REJECT_JUSTIFICATION');
    if (item.escalationLevel === 'REGIONAL') actions.push('ESCALATE');
  }
  return actions;
}

async function getConflict(user, conflictId) {
  const item = await loadVisibleConflict(user, conflictId);
  const enrolmentRefs = item.enrolmentRefs.map((ref) => ref.enrolmentRef);
  const [enrolments, institutions, student] = await Promise.all([
    Enrolment.find({ enrolmentRef: { $in: enrolmentRefs } }, { history: 0, contactToken: 0 }).lean(),
    Institution.find({ _id: { $in: item.involvedInstitutionIds } }, { name: 1, institutionCode: 1, regionId: 1 }).lean(),
    Student.findOne({ studentRef: item.studentRef }, { studentCode: 1, displayName: 1 }).lean(),
  ]);
  const institutionsById = new Map(institutions.map((inst) => [String(inst._id), inst]));
  const isCollege = COLLEGE_ROLES.includes(user.role);
  const ownInstitution = isCollege ? String(user.institutionId) : null;

  const sides = enrolments.map((enrolment) => {
    const institution = institutionsById.get(String(enrolment.institutionId));
    const own = ownInstitution === String(enrolment.institutionId);
    const base = {
      isOwnSide: own,
      institutionCode: institution?.institutionCode,
      institutionName: institution?.name,
      regionId: enrolment.regionId,
      state: enrolment.state,
    };
    // The other institution sees only the minimum: who, where and the state. Officers see course/year too.
    if (own || !isCollege) {
      return { ...base, enrolmentRef: enrolment.enrolmentRef, courseCode: enrolment.courseCode, yearOfStudy: enrolment.yearOfStudy, admittedOn: own ? enrolment.admittedOn : undefined };
    }
    return base;
  });
  const ownSide = sides.find((side) => side.isOwnSide) || null;

  const actorIds = [...new Set(item.events.map((event) => event.actorId).filter(Boolean).map(String))];
  const actors = await User.find({ _id: { $in: actorIds } }, { displayName: 1 }).lean();
  const actorNames = new Map(actors.map((actor) => [String(actor._id), actor.displayName]));
  const events = item.events.map((event) => {
    const fromOtherInstitution = isCollege && event.institutionId && String(event.institutionId) !== ownInstitution;
    return {
      type: event.type,
      actorRole: event.actorRole,
      actorName: fromOtherInstitution ? 'Other institution' : actorNames.get(String(event.actorId)) || (event.actorRole === 'SYSTEM' ? 'System' : event.actorRole),
      message: fromOtherInstitution ? 'The other institution submitted a response (details are visible to AICTE reviewers).' : event.message,
      at: event.at,
    };
  });

  return {
    conflictId: item.conflictId,
    conflictType: item.conflictType,
    academicYear: item.academicYear,
    status: item.status,
    isOpen: item.isOpen,
    escalationLevel: item.escalationLevel,
    assignedRegionId: item.assignedRegionId,
    dueAt: item.dueAt,
    overdue: isOverdue(item),
    student: isCollege
      ? { studentCode: student?.studentCode, displayName: student?.displayName }
      : { studentRefMasked: maskStudentRef(item.studentRef), initials: initials(student?.displayName) },
    sides,
    justification: item.justification?.text
      ? {
        text: !isCollege || String(item.justification.institutionId) === ownInstitution ? item.justification.text : 'Submitted by the other institution.',
        at: item.justification.at,
        byOwnInstitution: String(item.justification.institutionId) === ownInstitution,
      }
      : null,
    resolution: item.resolutionType ? { type: item.resolutionType, reason: item.resolutionReason, at: item.resolvedAt } : null,
    events,
    availableActions: availableActions(user, item, ownSide),
    notice: 'A conflict case is a candidate for review. It is not a finding of fraud or wrongdoing.',
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const COLLEGE_ACTIONS = {
  COLLEGE_OPERATOR: ['SUBMIT_FACTS'],
  COLLEGE_HEAD: ['WITHDRAW_OWN_ENROLMENT', 'TRANSFER_OWN_ENROLMENT', 'SUBMIT_JUSTIFICATION'],
};
const OFFICER_ACTIONS = ['ACCEPT_JUSTIFICATION', 'REJECT_JUSTIFICATION', 'ADD_NOTE'];

function audit(user, item, action, reason, payload, session) {
  return recordAudit({
    actor: user,
    action,
    entityType: 'Conflict',
    entityRef: item.conflictId,
    institutionId: COLLEGE_ROLES.includes(user.role) ? user.institutionId : null,
    regionIds: item.involvedRegionIds,
    reason,
    payload: payload || {},
  }, session ? { session } : {});
}

/**
 * POST /api/conflicts/:id/resolve with { action, reason }.
 * Validates role, scope, case state and the requested action before changing anything.
 */
async function resolveConflict(user, conflictId, action, reason) {
  const item = await loadVisibleConflict(user, conflictId);
  const allowedForRole = COLLEGE_ACTIONS[user.role] || (OFFICER_ROLES.includes(user.role) ? OFFICER_ACTIONS : []);
  if (!allowedForRole.includes(action)) throw forbidden('Your role cannot perform this action on a conflict case.');
  if (!item.isOpen) throw conflictError('CONFLICT_ALREADY_RESOLVED', 'This conflict case is already resolved.');

  const now = new Date();
  const event = (type, message) => ({ type, actorId: user.id, actorRole: user.role, institutionId: COLLEGE_ROLES.includes(user.role) ? user.institutionId : undefined, message, at: now });

  if (action === 'SUBMIT_FACTS' || action === 'ADD_NOTE') {
    const type = action === 'SUBMIT_FACTS' ? 'INSTITUTION_RESPONSE' : 'NOTE';
    await Conflict.updateOne({ _id: item._id, isOpen: true }, { $push: { events: event(type, reason) } });
    await audit(user, item, action === 'SUBMIT_FACTS' ? 'CONFLICT_RESPONSE_SUBMITTED' : 'CONFLICT_NOTE_ADDED', null, { length: reason.length });
    return getConflict(user, conflictId);
  }

  if (action === 'SUBMIT_JUSTIFICATION') {
    const updated = await Conflict.findOneAndUpdate(
      { _id: item._id, status: CONFLICT_STATUS.OPEN },
      {
        $set: { status: CONFLICT_STATUS.AWAITING_REVIEW, justification: { institutionId: user.institutionId, text: reason, by: user.id, at: now } },
        $push: { events: event('JUSTIFICATION_SUBMITTED', reason) },
      },
      { returnDocument: 'after' }
    );
    if (!updated) throw conflictError('CONFLICT_STATE_CONFLICT', 'A justification can only be submitted while the case is OPEN.');
    await audit(user, item, 'CONFLICT_JUSTIFICATION_SUBMITTED', reason);
    await notifications.safely(notifications.notifyRegionalOfficers(item.involvedRegionIds, {
      type: 'CONFLICT_JUSTIFICATION', message: `A justification was submitted for conflict case ${item.conflictId} and needs AICTE review.`,
      entityType: 'Conflict', entityRef: item.conflictId, link: `/aicte/conflicts/${item.conflictId}`,
    }), 'conflict-justification');
    return getConflict(user, conflictId);
  }

  if (action === 'ACCEPT_JUSTIFICATION' || action === 'REJECT_JUSTIFICATION') {
    const accept = action === 'ACCEPT_JUSTIFICATION';
    const updated = await Conflict.findOneAndUpdate(
      { _id: item._id, status: CONFLICT_STATUS.AWAITING_REVIEW },
      accept
        ? {
          $set: { status: CONFLICT_STATUS.RESOLVED, isOpen: false, resolutionType: 'JUSTIFIED', resolutionReason: reason, resolvedBy: user.id, resolvedAt: now },
          $push: { events: event('JUSTIFICATION_ACCEPTED', reason) },
        }
        : { $set: { status: CONFLICT_STATUS.OPEN }, $push: { events: event('JUSTIFICATION_REJECTED', reason) } },
      { returnDocument: 'after' }
    );
    if (!updated) throw conflictError('CONFLICT_STATE_CONFLICT', 'There is no justification awaiting review on this case.');
    await audit(user, item, accept ? 'CONFLICT_JUSTIFICATION_ACCEPTED' : 'CONFLICT_JUSTIFICATION_REJECTED', reason);
    for (const institutionId of item.involvedInstitutionIds) {
      await notifications.safely(notifications.notifyInstitutionRoles(institutionId, [ROLES.COLLEGE_HEAD], {
        type: 'CONFLICT_REVIEWED',
        message: `AICTE review of conflict case ${item.conflictId}: justification ${accept ? 'accepted - case resolved' : 'not accepted - case reopened'}.`,
        entityType: 'Conflict', entityRef: item.conflictId, link: `/college/conflicts/${item.conflictId}`,
      }), 'conflict-review');
    }
    return getConflict(user, conflictId);
  }

  // WITHDRAW_OWN_ENROLMENT / TRANSFER_OWN_ENROLMENT: enrolment, seat ledger, case and audit change together.
  const own = await Enrolment.findOne({
    enrolmentRef: { $in: item.enrolmentRefs.map((ref) => ref.enrolmentRef) },
    institutionId: user.institutionId,
    seatHeld: true,
  }).lean();
  if (!own) throw conflictError('NO_ACTIVE_OWN_ENROLMENT', 'Your institution has no active enrolment left in this case.');
  const toState = action === 'WITHDRAW_OWN_ENROLMENT' ? ENROLMENT_STATE.WITHDRAWN : ENROLMENT_STATE.TRANSFERRED;
  let transferDestination;
  if (toState === ENROLMENT_STATE.TRANSFERRED) {
    const others = await Enrolment.find({
      enrolmentRef: { $in: item.enrolmentRefs.map((ref) => ref.enrolmentRef) }, institutionId: { $ne: user.institutionId }, seatHeld: true,
    }, { enrolmentRef: 1 }).lean();
    if (others.length !== 1) {
      throw unprocessable('TRANSFER_DESTINATION_UNCLEAR', 'A transfer needs exactly one other active enrolment in the case as the destination.');
    }
    transferDestination = { enrolmentRef: others[0].enrolmentRef, conflictId: item.conflictId };
  }

  await runInTransaction(async (session) => {
    await applyTransition({
      enrolmentRef: own.enrolmentRef, toState, reason, actor: user, session, relatedConflictId: item.conflictId, transferDestination,
    });
    await Conflict.updateOne(
      { _id: item._id },
      { $push: { events: event(toState === ENROLMENT_STATE.WITHDRAWN ? 'ENROLMENT_WITHDRAWN' : 'ENROLMENT_TRANSFERRED', reason) } },
      { session }
    );
    await resolveConflictsIfCleared({
      studentRef: item.studentRef, academicYear: item.academicYear, resolutionType: toState, reason, actor: user, session,
    });
  });
  return getConflict(user, conflictId);
}

async function escalateConflict(user, conflictId, reason) {
  if (!OFFICER_ROLES.includes(user.role)) throw forbidden('Only AICTE officers can escalate conflict cases.');
  const item = await loadVisibleConflict(user, conflictId);
  if (!item.isOpen) throw conflictError('CONFLICT_ALREADY_RESOLVED', 'A resolved case cannot be escalated.');
  const updated = await Conflict.findOneAndUpdate(
    { _id: item._id, isOpen: true, escalationLevel: 'REGIONAL' },
    {
      $set: { escalationLevel: 'NATIONAL' },
      $push: { events: { type: 'ESCALATED', actorId: user.id, actorRole: user.role, message: reason, at: new Date() } },
    },
    { returnDocument: 'after' }
  );
  if (!updated) throw conflictError('ALREADY_ESCALATED', 'This case is already at national level.');
  await audit(user, item, 'CONFLICT_ESCALATED', reason, { to: 'NATIONAL' });
  await notifications.safely(notifications.notifyNationalOfficers({
    type: 'CONFLICT_ESCALATED',
    message: `Conflict case ${item.conflictId} was escalated to national review. Escalation does not determine wrongdoing.`,
    entityType: 'Conflict', entityRef: item.conflictId, link: `/aicte/conflicts/${item.conflictId}`,
  }), 'conflict-escalation');
  return getConflict(user, conflictId);
}

module.exports = {
  detectConflictsForStudents,
  notifyConflictParties,
  resolveConflictsIfCleared,
  listConflicts,
  getConflict,
  resolveConflict,
  escalateConflict,
  scopeFilter,
};
