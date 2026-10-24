// Runs the seven validation layers for one batch and stores the results.
//
// Order: L1 schema -> L2 identity (mock) -> L3 duplicates -> L4 seat ledger -> L5 cross-college
//        -> L6 consistency -> L7 risk signals.
// Every layer reads a shared context loaded once from MongoDB, so the layers themselves are
// plain functions that are easy to test.
const {
  UploadBatch, StagingRow, ValidationIssue, SeatPolicy, Course, SeatLedger, Student, Enrolment, Institution,
} = require('../../models');
const { BATCH_STATUS, ISSUE_STATUS, SEVERITY, POLICY_STATUS } = require('../../config/constants');
const { VALIDATION_RULESET } = require('./ruleset');
const { runL1 } = require('./l1Schema');
const { runL2 } = require('./l2Identity');
const { runL3 } = require('./l3Duplicates');
const { runL4 } = require('./l4SeatLedger');
const { runL5 } = require('./l5CrossCollege');
const { runL6 } = require('./l6Consistency');
const { runL7 } = require('./l7RiskSignals');
const { getSettings } = require('../settingsService');

const LAYERS = [runL1, runL2, runL3, runL4, runL5, runL6, runL7];

async function loadContext(batch, rows, settings) {
  const policy = await SeatPolicy.findOne({ academicYear: batch.academicYear, status: POLICY_STATUS.PUBLISHED }).lean();
  const [institution, courses, ledgers] = await Promise.all([
    Institution.findById(batch.institutionId).lean(),
    Course.find({ institutionId: batch.institutionId, academicYear: batch.academicYear }).lean(),
    SeatLedger.find({ institutionId: batch.institutionId, academicYear: batch.academicYear }).lean(),
  ]);

  const included = rows.filter((row) => row.included);
  const codes = [...new Set(included.map((row) => row.fields.studentCode).filter(Boolean))];
  const externalIds = [...new Set(included.map((row) => row.fields.externalIdDemo).filter(Boolean))];
  const students = await Student.find({
    $or: [{ studentCode: { $in: codes } }, { syntheticExternalId: { $in: externalIds } }],
  }).lean();

  const studentRefs = students.map((student) => student.studentRef);
  const activeEnrolments = await Enrolment.find({
    studentRef: { $in: studentRefs }, academicYear: batch.academicYear, seatHeld: true,
  }).lean();
  const activeEnrolmentsByStudentRef = new Map();
  for (const enrolment of activeEnrolments) {
    if (!activeEnrolmentsByStudentRef.has(enrolment.studentRef)) activeEnrolmentsByStudentRef.set(enrolment.studentRef, []);
    activeEnrolmentsByStudentRef.get(enrolment.studentRef).push(enrolment);
  }
  const otherInstitutionIds = [...new Set(activeEnrolments.map((enrolment) => String(enrolment.institutionId)))];
  const otherInstitutions = await Institution.find({ _id: { $in: otherInstitutionIds } }, { name: 1 }).lean();

  // Students already in the register at THIS institution who share a contact token with batch rows.
  const tokens = [...new Set(included.map((row) => row.fields.contactToken).filter(Boolean))];
  const tokenEnrolments = tokens.length
    ? await Enrolment.find(
      { institutionId: batch.institutionId, academicYear: batch.academicYear, seatHeld: true, contactToken: { $in: tokens } },
      { contactToken: 1, studentRef: 1 }
    ).lean()
    : [];
  const registerContactStudents = new Map();
  for (const enrolment of tokenEnrolments) {
    if (!registerContactStudents.has(enrolment.contactToken)) registerContactStudents.set(enrolment.contactToken, new Set());
    registerContactStudents.get(enrolment.contactToken).add(enrolment.studentRef);
  }

  const rowInfo = new Map();
  for (const row of included) rowInfo.set(row.rowNumber, { valid: {}, identity: null, registerStudent: null, yearOfStudy: null });

  return {
    batch,
    institution,
    policy,
    policyBucketCodes: new Set((policy?.scopes || []).flatMap((scope) => scope.buckets.map((bucket) => bucket.code))),
    coursesByCode: new Map(courses.map((course) => [course.courseCode, course])),
    ledgersByKey: new Map(ledgers.map((ledger) => [`${ledger.courseCode}|${ledger.bucketCode}`, ledger])),
    studentsByCode: new Map(students.map((student) => [student.studentCode, student])),
    studentsByExternalId: new Map(students.filter((s) => s.syntheticExternalId).map((s) => [s.syntheticExternalId, s])),
    activeEnrolmentsByStudentRef,
    institutionNames: new Map(otherInstitutions.map((item) => [String(item._id), item.name])),
    registerContactStudents,
    settings,
    pendingPolicy: settings.pendingIdentityPolicy,
    ruleset: VALIDATION_RULESET,
    rows: included,
    rowInfo,
  };
}

/**
 * Compares the new results with the previous current issues.
 * - Same problem on an unchanged row: keep the existing issue (and its justification/disposition).
 * - Same problem on a changed row: old issue becomes SUPERSEDED, a fresh OPEN issue is created.
 * - Problem no longer detected: old issue becomes RESOLVED (history kept).
 */
function reconcileIssues(existing, fresh, rowsByNumber, actorId) {
  const now = new Date();
  const freshByFingerprint = new Map(fresh.map((issue) => [issue.fingerprint, issue]));
  const kept = new Set();
  const operations = [];

  for (const old of existing) {
    const match = freshByFingerprint.get(old.fingerprint);
    if (match && old.rowVersion === match.rowVersion) {
      kept.add(old.fingerprint);
      const handlingChanged = old.blocking !== match.blocking || old.dispositionRequired !== match.dispositionRequired;
      operations.push({
        updateOne: {
          filter: { _id: old._id },
          update: {
            $set: {
              message: match.message,
              evidence: match.evidence,
              blocking: match.blocking,
              dispositionRequired: match.dispositionRequired,
              validationRun: match.validationRun,
              policyVersion: match.policyVersion,
              // If the handling rules changed (e.g. pending policy setting), earlier dispositions no longer apply.
              ...(handlingChanged ? { resolutionStatus: ISSUE_STATUS.OPEN } : {}),
            },
            ...(handlingChanged ? { $unset: { justification: 1, disposition: 1 } } : {}),
          },
        },
      });
      continue;
    }
    const row = old.rowNumber === null ? null : rowsByNumber.get(old.rowNumber);
    const reason = !match
      ? row && !row.included
        ? 'Row excluded from the batch'
        : 'No longer detected after revalidation'
      : 'Row changed; replaced by a newer validation result';
    operations.push({
      updateOne: {
        filter: { _id: old._id },
        update: {
          $set: {
            current: false,
            resolutionStatus: match ? ISSUE_STATUS.SUPERSEDED : ISSUE_STATUS.RESOLVED,
            resolutionReason: reason,
            resolvedBy: actorId,
            resolvedAt: now,
          },
        },
      },
    });
  }
  for (const issue of fresh) {
    if (!kept.has(issue.fingerprint)) operations.push({ insertOne: { document: { ...issue, current: true, resolutionStatus: ISSUE_STATUS.OPEN } } });
  }
  return operations;
}

function rowStatusFrom(row, rowIssues) {
  if (!row.included) return 'EXCLUDED';
  const severities = new Set(rowIssues.map((issue) => issue.severity));
  if (severities.has(SEVERITY.ERROR)) return 'HAS_ERRORS';
  if (severities.has(SEVERITY.PENDING)) return 'PENDING';
  if (severities.has(SEVERITY.WARNING)) return 'HAS_WARNINGS';
  return 'VALID';
}

/**
 * Summary counts shown on the batch pages. Uses the CURRENT issues only.
 */
function computeCounts(rows, currentIssues) {
  const included = rows.filter((row) => row.included);
  const issuesByRow = new Map();
  for (const issue of currentIssues) {
    if (issue.rowNumber === null) continue;
    if (!issuesByRow.has(issue.rowNumber)) issuesByRow.set(issue.rowNumber, []);
    issuesByRow.get(issue.rowNumber).push(issue);
  }
  const hasSeverity = (row, severity) => (issuesByRow.get(row.rowNumber) || []).some((issue) => issue.severity === severity);
  const count = (predicate) => currentIssues.filter(predicate).length;
  const needsDisposition = (issue) => issue.dispositionRequired;
  return {
    totalRows: rows.length,
    includedRows: included.length,
    excludedRows: rows.length - included.length,
    validRows: included.filter((row) => !hasSeverity(row, 'ERROR') && !hasSeverity(row, 'PENDING') && !hasSeverity(row, 'WARNING')).length,
    rowsWithErrors: included.filter((row) => hasSeverity(row, 'ERROR')).length,
    rowsWithWarnings: included.filter((row) => hasSeverity(row, 'WARNING')).length,
    rowsPending: included.filter((row) => hasSeverity(row, 'PENDING')).length,
    staleRows: rows.filter((row) => row.rowVersion !== row.validatedRowVersion).length,
    openErrors: count((issue) => issue.severity === SEVERITY.ERROR),
    warnings: count((issue) => issue.severity === SEVERITY.WARNING),
    warningsNeedingJustification: count((issue) => needsDisposition(issue) && issue.resolutionStatus === ISSUE_STATUS.OPEN),
    dispositionsAwaitingHead: count((issue) => needsDisposition(issue) && issue.resolutionStatus !== ISSUE_STATUS.ACCEPTED),
    pendingChecks: count((issue) => issue.severity === SEVERITY.PENDING),
    riskFlags: count((issue) => issue.severity === SEVERITY.RISK_FLAG),
    infoNotes: count((issue) => issue.severity === SEVERITY.INFO),
  };
}

// Recomputes counts from the database (used after justifications, dispositions and corrections).
async function refreshBatchCounts(batchId) {
  const [rows, currentIssues] = await Promise.all([
    StagingRow.find({ batchId }, { rowNumber: 1, included: 1, rowVersion: 1, validatedRowVersion: 1 }).lean(),
    ValidationIssue.find({ batchId, current: true }).lean(),
  ]);
  const counts = computeCounts(rows, currentIssues);
  await UploadBatch.updateOne({ batchId }, { $set: { counts } });
  return counts;
}

/**
 * Validates a batch that is already in VALIDATING status.
 * @returns {Promise<object>} the updated batch document
 */
async function runValidation(batchId, actor) {
  const batch = await UploadBatch.findOne({ batchId }).lean();
  if (!batch || batch.status !== BATCH_STATUS.VALIDATING) {
    throw new Error(`Batch ${batchId} is not in VALIDATING state`);
  }
  const settings = await getSettings();
  const rows = await StagingRow.find({ batchId }).sort({ rowNumber: 1 }).lean();
  const ctx = await loadContext(batch, rows, settings);

  const runNumber = (batch.validationRunCount || 0) + 1;
  const rowsByNumber = new Map(rows.map((row) => [row.rowNumber, row]));
  const fresh = [];
  for (const layer of LAYERS) {
    for (const issue of layer(ctx)) {
      const row = issue.rowNumber === null ? null : rowsByNumber.get(issue.rowNumber);
      fresh.push({
        ...issue,
        batchId,
        institutionId: batch.institutionId,
        validationRun: runNumber,
        rowVersion: row ? row.rowVersion : null,
        policyVersion: ctx.policy ? ctx.policy.version : null,
      });
    }
  }

  const existing = await ValidationIssue.find({ batchId, current: true }).lean();
  const issueOperations = reconcileIssues(existing, fresh, rowsByNumber, actor?.id);
  if (issueOperations.length > 0) await ValidationIssue.bulkWrite(issueOperations, { ordered: true });

  const now = new Date();
  const freshByRow = new Map();
  for (const issue of fresh) {
    if (issue.rowNumber === null) continue;
    if (!freshByRow.has(issue.rowNumber)) freshByRow.set(issue.rowNumber, []);
    freshByRow.get(issue.rowNumber).push(issue);
  }
  const rowOperations = rows.map((row) => {
    const info = ctx.rowInfo.get(row.rowNumber);
    const identity = info?.identity;
    return {
      updateOne: {
        filter: { _id: row._id, rowVersion: row.rowVersion },
        update: {
          $set: {
            validatedRowVersion: row.rowVersion,
            validationStatus: rowStatusFrom(row, freshByRow.get(row.rowNumber) || []),
            lastValidatedAt: now,
            ...(identity
              ? { identityCheck: { status: identity.status, adapter: identity.adapter, checkedAt: now } }
              : row.included ? { identityCheck: { status: 'NOT_CHECKED', adapter: null, checkedAt: now } } : {}),
          },
        },
      },
    };
  });
  if (rowOperations.length > 0) await StagingRow.bulkWrite(rowOperations, { ordered: false });

  const updatedRows = await StagingRow.find({ batchId }, { rowNumber: 1, included: 1, rowVersion: 1, validatedRowVersion: 1 }).lean();
  const currentIssues = await ValidationIssue.find({ batchId, current: true }).lean();
  const counts = computeCounts(updatedRows, currentIssues);
  const hasBlockingPending = currentIssues.some((issue) => issue.severity === SEVERITY.PENDING && issue.blocking);
  const hasBlockingBatchIssue = currentIssues.some((issue) => issue.rowNumber === null && issue.blocking);
  const nextStatus =
    counts.openErrors > 0 || hasBlockingPending || hasBlockingBatchIssue || counts.staleRows > 0 || counts.includedRows === 0
      ? BATCH_STATUS.NEEDS_CORRECTION
      : BATCH_STATUS.VALIDATED;

  const updated = await UploadBatch.findOneAndUpdate(
    { batchId, status: BATCH_STATUS.VALIDATING },
    {
      $set: {
        status: nextStatus,
        counts,
        validationRunCount: runNumber,
        lastValidatedAt: now,
        validatedPolicyVersion: ctx.policy ? ctx.policy.version : null,
        validationRulesetVersion: VALIDATION_RULESET.version,
        revalidationRequired: false,
        revalidationReason: null,
      },
      $push: { statusHistory: { from: BATCH_STATUS.VALIDATING, to: nextStatus, at: now, by: actor?.id, reason: `Validation run ${runNumber}` } },
    },
    { returnDocument: 'after' }
  ).lean();
  return { batch: updated, counts, policyVersion: ctx.policy ? ctx.policy.version : null, runNumber };
}

module.exports = { runValidation, refreshBatchCounts, computeCounts, reconcileIssues, loadContext, LAYERS };
