// Certification and commit (maker-checker), spec 05 section 3 and spec 07 section 6.
//
// 1. Pre-checks outside the transaction give fast, clear feedback.
// 2. A conditional update moves READY_FOR_REVIEW -> COMMITTING. Only one request can win this,
//    which stops double certification.
// 3. ONE MongoDB transaction then re-checks everything and writes seats, students, enrolments,
//    conflicts, the batch result and the audit event. If any step fails, nothing is written.
const {
  UploadBatch, StagingRow, ValidationIssue, SeatPolicy, Course, Student, Enrolment, Institution,
} = require('../models');
const {
  ROLES, BATCH_STATUS, POLICY_STATUS, ENROLMENT_STATE, SEVERITY, ISSUE_STATUS,
} = require('../config/constants');
const { AppError, forbidden, conflict, unprocessable } = require('../utils/AppError');
const { newStudentRef, newEnrolmentRef } = require('../utils/ids');
const { runInTransaction } = require('../utils/transaction');
const { dbState } = require('../config/db');
const { findBatchForUser, computeReadiness, DECLARATION_VERSION, declarationText } = require('./batchQueryService');
const { reserveSeats, CapacityError } = require('./seatLedgerService');
const { detectConflictsForStudents, notifyConflictParties } = require('./conflictService');
const { evaluateInstitutionYear } = require('./riskService');
const { recordAudit } = require('./auditService');
const { getSettings } = require('./settingsService');
const notifications = require('./notificationService');
const logger = require('../utils/logger');

class CommitPreconditionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Test-only fault injection used to prove that a failed transaction leaves nothing behind.
const testHooks = { beforeFinalize: null };

function auditBase(user, batch) {
  return { actor: user, entityType: 'UploadBatch', entityRef: batch.batchId, institutionId: batch.institutionId, regionIds: [batch.regionId] };
}

async function setBatchAfterFailure(batch, user, status, error, extra = {}) {
  await UploadBatch.updateOne(
    { batchId: batch.batchId, status: BATCH_STATUS.COMMITTING },
    {
      $set: { status, lastCommitError: { code: error.code, message: error.message, details: error.details || null, at: new Date() }, ...extra },
      $push: { statusHistory: { from: BATCH_STATUS.COMMITTING, to: status, at: new Date(), by: user.id, reason: error.code } },
    }
  );
}

/**
 * The transaction body. Everything here uses `session`, so it commits or rolls back as one unit.
 */
async function commitInsideTransaction(batchId, user, session) {
  const batch = await UploadBatch.findOne({ batchId }).session(session).lean();
  if (!batch || batch.status !== BATCH_STATUS.COMMITTING || String(batch.certification?.certifiedBy) !== String(user.id)) {
    throw new CommitPreconditionError('BATCH_STATE_CONFLICT', 'The batch is no longer awaiting this certification.');
  }

  // Re-check the policy version and blockers inside the transaction (data may have changed).
  const policy = await SeatPolicy.findOne({ academicYear: batch.academicYear, status: POLICY_STATUS.PUBLISHED }).session(session).lean();
  if (!policy || policy.version !== batch.validatedPolicyVersion) {
    throw new CommitPreconditionError('STALE_POLICY_VERSION',
      `The batch was validated under ${batch.validatedPolicyVersion || 'no policy'} but the active policy is ${policy ? policy.version : 'missing'}. Revalidation is required.`);
  }
  const settings = await getSettings();
  const currentIssues = await ValidationIssue.find({ batchId, current: true }).session(session).lean();
  const blocking = currentIssues.filter((issue) =>
    issue.severity === SEVERITY.ERROR
    || (issue.severity === SEVERITY.PENDING && settings.pendingIdentityPolicy === 'BLOCK_UNTIL_RESOLVED')
    || (issue.dispositionRequired && issue.resolutionStatus !== ISSUE_STATUS.ACCEPTED));
  if (blocking.length > 0) {
    throw new CommitPreconditionError('CERTIFICATION_BLOCKED', `${blocking.length} unresolved blocking issue(s) remain.`);
  }

  const rows = await StagingRow.find({ batchId, included: true }).session(session).sort({ rowNumber: 1 }).lean();
  if (rows.length === 0) throw new CommitPreconditionError('NO_INCLUDED_ROWS', 'There are no included rows to commit.');
  if (rows.some((row) => row.rowVersion !== row.validatedRowVersion)) {
    throw new CommitPreconditionError('STALE_ROWS', 'Some rows changed after validation. Revalidation is required.');
  }

  const courses = await Course.find({ institutionId: batch.institutionId, academicYear: batch.academicYear }).session(session).lean();
  const courseByCode = new Map(courses.map((course) => [course.courseCode, course]));

  // 1. Seats: one conditional increment per course/bucket. Any shortfall aborts the whole commit.
  const demand = new Map();
  for (const row of rows) {
    const key = `${row.fields.courseCode}|${row.fields.bucketCode}`;
    demand.set(key, (demand.get(key) || 0) + 1);
  }
  const ledgerChanges = [];
  for (const [key, count] of demand) {
    const [courseCode, bucketCode] = key.split('|');
    const course = courseByCode.get(courseCode);
    if (!course) throw new CommitPreconditionError('COURSE_NOT_CONFIGURED', `Course ${courseCode} is not configured.`);
    const ledger = await reserveSeats({ courseId: course._id, academicYear: batch.academicYear, bucketCode, count }, session);
    ledgerChanges.push({ courseCode, bucketCode, reserved: count, filledAfter: ledger.filled, capacity: ledger.capacity });
  }

  // 2. Students: reuse the register identity when the student code already exists.
  const codes = rows.map((row) => row.fields.studentCode);
  const existingStudents = await Student.find({ studentCode: { $in: codes } }).session(session).lean();
  const studentsByCode = new Map(existingStudents.map((student) => [student.studentCode, student]));
  const newStudents = [];
  for (const row of rows) {
    if (studentsByCode.has(row.fields.studentCode)) continue;
    const identityStatus = row.identityCheck?.status;
    const student = {
      studentRef: newStudentRef(),
      studentCode: row.fields.studentCode,
      displayName: row.fields.studentName,
      syntheticExternalId: row.fields.externalIdDemo || undefined,
      externalLinkStatus: ['MATCHED', 'NAME_MISMATCH', 'NOT_FOUND', 'PENDING'].includes(identityStatus) ? identityStatus : 'NOT_CHECKED',
      isDemo: true,
    };
    newStudents.push(student);
    studentsByCode.set(student.studentCode, student);
  }
  if (newStudents.length > 0) {
    const created = await Student.insertMany(newStudents, { session });
    for (const student of created) studentsByCode.set(student.studentCode, student);
  }
  // Existing students that were never checked (or were pending) take the latest mock check result.
  for (const row of rows) {
    const student = existingStudents.find((item) => item.studentCode === row.fields.studentCode);
    const status = row.identityCheck?.status;
    if (student && ['NOT_CHECKED', 'PENDING'].includes(student.externalLinkStatus) && ['MATCHED', 'NAME_MISMATCH', 'NOT_FOUND', 'PENDING'].includes(status)) {
      await Student.updateOne(
        { _id: student._id },
        { $set: { externalLinkStatus: status, ...(student.syntheticExternalId ? {} : { syntheticExternalId: row.fields.externalIdDemo || undefined }) } },
        { session }
      );
    }
  }

  // 3. Official enrolments. Rows whose identity check is still pending are committed as PROVISIONAL.
  const now = new Date();
  const enrolments = rows.map((row) => {
    const student = studentsByCode.get(row.fields.studentCode);
    const course = courseByCode.get(row.fields.courseCode);
    const identityPending = row.identityCheck?.status === 'PENDING';
    const state = identityPending ? ENROLMENT_STATE.PROVISIONAL : ENROLMENT_STATE.CONFIRMED;
    return {
      enrolmentRef: newEnrolmentRef(),
      studentRef: student.studentRef,
      studentId: student._id,
      institutionId: batch.institutionId,
      regionId: batch.regionId,
      courseId: course._id,
      courseCode: course.courseCode,
      academicYear: batch.academicYear,
      yearOfStudy: Number(row.fields.yearOfStudy),
      bucketCode: row.fields.bucketCode,
      state,
      seatHeld: true,
      admittedOn: row.fields.admittedOn,
      contactToken: row.fields.contactToken || undefined,
      identityStatusAtCommit: row.identityCheck?.status || 'NOT_CHECKED',
      sourceBatchId: batch.batchId,
      sourceRowNumber: row.rowNumber,
      history: [{
        fromState: null,
        toState: state,
        seatEffect: 'RESERVE',
        reason: `Committed from certified batch ${batch.batchId}`,
        actorId: user.id,
        actorRole: user.role,
        at: now,
        sourceBatchId: batch.batchId,
      }],
    };
  });
  await Enrolment.insertMany(enrolments, { session });

  // 4. Cross-college conflict detection for the students just committed.
  const touchedConflicts = await detectConflictsForStudents(
    [...new Set(enrolments.map((enrolment) => enrolment.studentRef))],
    batch.academicYear,
    { session, actor: user, detectedBy: 'COMMIT_DETECTOR' }
  );

  if (testHooks.beforeFinalize) await testHooks.beforeFinalize({ batchId, session });

  // 5. Batch result and audit event.
  const commitSummary = {
    committedRows: rows.length,
    enrolmentsCreated: enrolments.length,
    studentsCreated: newStudents.length,
    provisionalEnrolments: enrolments.filter((enrolment) => enrolment.state === ENROLMENT_STATE.PROVISIONAL).length,
    conflictsCreated: touchedConflicts.filter((item) => item.created).length,
    ledgerChanges,
    policyVersion: policy.version,
    committedAt: now,
  };
  const finalised = await UploadBatch.updateOne(
    { batchId, status: BATCH_STATUS.COMMITTING },
    {
      $set: { status: BATCH_STATUS.COMMITTED, commitSummary, 'certification.completedAt': now, lastCommitError: null },
      $push: { statusHistory: { from: BATCH_STATUS.COMMITTING, to: BATCH_STATUS.COMMITTED, at: now, by: user.id, reason: 'Certified and committed' } },
    },
    { session }
  );
  if (finalised.modifiedCount !== 1) throw new CommitPreconditionError('BATCH_STATE_CONFLICT', 'The batch changed during commit.');
  await recordAudit({
    ...auditBase(user, batch),
    action: 'BATCH_CERTIFIED_COMMITTED',
    payload: {
      declarationVersion: DECLARATION_VERSION,
      committedRows: rows.length,
      studentsCreated: newStudents.length,
      ledgerChanges,
      policyVersion: policy.version,
      conflictsTouched: touchedConflicts.map((item) => item.conflictId),
    },
  }, { session });

  return { commitSummary, touchedConflicts };
}

/**
 * POST /api/batches/:batchId/certify (college head of the batch's institution only).
 * Retry semantics: certifying an already COMMITTED batch returns the stored result with
 * idempotentReplay=true and writes nothing.
 */
async function certifyBatch(user, batchId, { declarationAccepted, confirmBatchId }) {
  if (user.role !== ROLES.COLLEGE_HEAD) throw forbidden('Only the college head of this institution can certify a batch.');
  const batch = await findBatchForUser(user, batchId);

  if (batch.status === BATCH_STATUS.COMMITTED) {
    return { idempotentReplay: true, batchId, status: batch.status, commitSummary: batch.commitSummary };
  }
  if (declarationAccepted !== true) throw unprocessable('DECLARATION_REQUIRED', 'Tick the declaration before certifying.');
  if (confirmBatchId !== batchId) throw unprocessable('CONFIRMATION_MISMATCH', 'Type the batch ID exactly to confirm certification.');
  if (String(batch.createdBy) === String(user.id)) {
    throw forbidden('Maker-checker rule: the person who uploaded a batch cannot certify it.', 'MAKER_CHECKER_VIOLATION');
  }
  if (!dbState.transactionsSupported) {
    throw new AppError(503, 'TRANSACTIONS_UNAVAILABLE', 'Certification needs MongoDB transactions (a replica set). See README > Database setup.');
  }

  const readiness = await computeReadiness(batch);
  if (readiness.certifyBlockers.some((blocker) => blocker.code === 'STALE_POLICY_VERSION') && batch.status === BATCH_STATUS.READY_FOR_REVIEW) {
    // Documented version policy: a stale batch is sent back for revalidation, never committed with mixed capacities.
    await UploadBatch.updateOne(
      { batchId, status: BATCH_STATUS.READY_FOR_REVIEW },
      {
        $set: { status: BATCH_STATUS.NEEDS_CORRECTION, revalidationRequired: true, revalidationReason: 'POLICY_VERSION_CHANGED' },
        $push: { statusHistory: { from: BATCH_STATUS.READY_FOR_REVIEW, to: BATCH_STATUS.NEEDS_CORRECTION, at: new Date(), by: user.id, reason: 'Seat policy changed after validation' } },
      }
    );
    await recordAudit({ ...auditBase(user, batch), action: 'BATCH_COMMIT_REJECTED', reason: 'STALE_POLICY_VERSION', payload: { validatedUnder: batch.validatedPolicyVersion, active: readiness.activePolicyVersion } });
    await notifications.safely(notifications.notifyInstitutionRoles(batch.institutionId, [ROLES.COLLEGE_OPERATOR], {
      type: 'BATCH_NEEDS_REVALIDATION',
      message: `Batch ${batchId} must be revalidated: the seat policy changed to ${readiness.activePolicyVersion} after validation.`,
      entityType: 'UploadBatch', entityRef: batchId, link: `/college/batches/${batchId}`,
    }), 'stale-policy');
    throw conflict('STALE_POLICY_VERSION', `The batch was validated under ${batch.validatedPolicyVersion} but ${readiness.activePolicyVersion} is now active. It has been sent back for revalidation.`);
  }
  if (!readiness.canCertify) {
    throw conflict('CERTIFICATION_BLOCKED', 'The batch cannot be certified yet.', { blockers: readiness.certifyBlockers });
  }

  const institution = await Institution.findById(batch.institutionId, { name: 1 }).lean();
  const locked = await UploadBatch.findOneAndUpdate(
    { batchId, institutionId: user.institutionId, status: { $in: [BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.COMMIT_FAILED] } },
    {
      $set: {
        status: BATCH_STATUS.COMMITTING,
        certification: {
          certifiedBy: user.id,
          declarationVersion: DECLARATION_VERSION,
          declarationText: declarationText(institution.name, batch.academicYear, readiness.counts.includedRows),
          startedAt: new Date(),
        },
      },
      $push: { statusHistory: { from: batch.status, to: BATCH_STATUS.COMMITTING, at: new Date(), by: user.id, reason: 'Certified by college head' } },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!locked) {
    const latest = await UploadBatch.findOne({ batchId }).lean();
    if (latest?.status === BATCH_STATUS.COMMITTED) {
      return { idempotentReplay: true, batchId, status: latest.status, commitSummary: latest.commitSummary };
    }
    throw conflict('BATCH_STATE_CONFLICT', `Certification is already in progress or the batch changed (status ${latest?.status}).`);
  }

  let outcome;
  try {
    outcome = await runInTransaction((session) => commitInsideTransaction(batchId, user, session));
  } catch (error) {
    if (error instanceof CapacityError) {
      const failure = { code: 'CAPACITY_EXCEEDED', message: 'Seat capacity changed since validation and is no longer sufficient. Nothing was committed.', details: error.details };
      await setBatchAfterFailure(batch, user, BATCH_STATUS.NEEDS_CORRECTION, failure, { revalidationRequired: true, revalidationReason: 'CAPACITY_CHANGED' });
      await recordAudit({ ...auditBase(user, batch), action: 'BATCH_COMMIT_REJECTED', reason: 'CAPACITY_EXCEEDED', payload: { details: error.details } });
      throw conflict('CAPACITY_EXCEEDED', failure.message, error.details);
    }
    if (error instanceof CommitPreconditionError) {
      const failure = { code: error.code, message: error.message };
      await setBatchAfterFailure(batch, user, BATCH_STATUS.NEEDS_CORRECTION, failure, { revalidationRequired: true, revalidationReason: error.code });
      await recordAudit({ ...auditBase(user, batch), action: 'BATCH_COMMIT_REJECTED', reason: error.code, payload: {} });
      throw conflict(error.code, `${error.message} Nothing was committed.`);
    }
    logger.error('Commit transaction failed', { batchId, reason: error.message, code: error.code });
    const failure = { code: 'COMMIT_TRANSACTION_FAILED', message: 'The commit could not be completed and was rolled back. Nothing was committed; you can retry certification.' };
    await setBatchAfterFailure(batch, user, BATCH_STATUS.COMMIT_FAILED, failure);
    await recordAudit({ ...auditBase(user, batch), action: 'BATCH_COMMIT_FAILED', payload: { code: failure.code } });
    throw new AppError(500, failure.code, failure.message);
  }

  // After commit (best effort, outside the transaction): notifications and rule-based risk evaluation.
  await notifyConflictParties(outcome.touchedConflicts);
  await notifications.safely(notifications.notifyInstitutionRoles(batch.institutionId, [ROLES.COLLEGE_OPERATOR], {
    type: 'BATCH_COMMITTED',
    message: `Batch ${batchId} was certified and ${outcome.commitSummary.committedRows} record(s) were committed to the register.`,
    entityType: 'UploadBatch', entityRef: batchId, link: `/college/batches/${batchId}`,
  }), 'commit');
  try {
    await evaluateInstitutionYear(batch.institutionId, batch.academicYear, { actor: user });
  } catch (error) {
    logger.warn('Risk evaluation after commit failed (commit itself succeeded)', { batchId, reason: error.message });
  }

  return { idempotentReplay: false, batchId, status: BATCH_STATUS.COMMITTED, commitSummary: outcome.commitSummary };
}

module.exports = { certifyBatch, testHooks };
