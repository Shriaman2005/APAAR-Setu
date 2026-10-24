// State-changing batch actions for the maker (operator) and checker (head) before certification.
// Every transition is a conditional update on the current status, so two concurrent clicks cannot
// both succeed and an action can never skip the documented transition table.
const mongoose = require('mongoose');
const { UploadBatch, StagingRow, ValidationIssue } = require('../models');
const {
  ROLES, BATCH_STATUS, BATCH_EDITABLE_STATUSES, BATCH_REVALIDATABLE_STATUSES, EDITABLE_ROW_FIELDS, ISSUE_STATUS, SEVERITY,
  canTransitionBatch,
} = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { findBatchForUser, computeReadiness } = require('./batchQueryService');
const { normaliseFieldValue, startValidation } = require('./batchIngestionService');
const { refreshBatchCounts } = require('./validation/pipeline');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');
const { getSettings } = require('./settingsService');

function requireRole(user, role, message) {
  if (user.role !== role) throw forbidden(message);
}

function auditBase(user, batch) {
  return { actor: user, entityType: 'UploadBatch', entityRef: batch.batchId, institutionId: batch.institutionId, regionIds: [batch.regionId] };
}

/**
 * Moves a batch from one of `fromStatuses` to `to`. Returns the updated batch or throws 409.
 */
async function transition(batch, fromStatuses, to, user, reason, extraSet = {}) {
  // Only statuses that the transition table allows to move to `to` are accepted.
  const permitted = fromStatuses.filter((from) => canTransitionBatch(from, to));
  if (!permitted.includes(batch.status)) {
    throw conflict('INVALID_BATCH_TRANSITION', `A batch cannot move from ${batch.status} to ${to}.`);
  }
  const updated = await UploadBatch.findOneAndUpdate(
    { batchId: batch.batchId, status: { $in: permitted } },
    {
      $set: { status: to, ...extraSet },
      $push: { statusHistory: { from: batch.status, to, at: new Date(), by: user.id, reason } },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('BATCH_STATE_CONFLICT', 'The batch changed status in the meantime. Refresh and try again.');
  return updated;
}

// After any staging change the batch needs revalidation before it can move forward.
async function markNeedsRevalidation(batch, user, reason) {
  if (batch.status === BATCH_STATUS.NEEDS_CORRECTION) {
    await UploadBatch.updateOne({ batchId: batch.batchId }, { $set: { revalidationRequired: true, revalidationReason: reason } });
    return;
  }
  await transition(batch, [batch.status], BATCH_STATUS.NEEDS_CORRECTION, user, reason, {
    revalidationRequired: true,
    revalidationReason: reason,
  });
}

async function loadEditableBatch(user, batchId) {
  requireRole(user, ROLES.COLLEGE_OPERATOR, 'Only the college operator can change staged rows.');
  const batch = await findBatchForUser(user, batchId);
  if (!BATCH_EDITABLE_STATUSES.includes(batch.status)) {
    throw conflict('BATCH_NOT_EDITABLE', `Rows cannot be changed while the batch is ${batch.status}.`);
  }
  return batch;
}

async function correctRow(user, batchId, rowNumber, changes) {
  const batch = await loadEditableBatch(user, batchId);
  const unknownFields = Object.keys(changes).filter((field) => !EDITABLE_ROW_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    throw unprocessable('FIELD_NOT_EDITABLE', `These fields cannot be edited: ${unknownFields.join(', ')}.`, { fields: unknownFields });
  }
  const row = await StagingRow.findOne({ batchId, rowNumber }).lean();
  if (!row) throw notFound('Row not found in this batch.');

  const setFields = {};
  const correctionEntries = [];
  const now = new Date();
  for (const [field, value] of Object.entries(changes)) {
    const next = normaliseFieldValue(field, value);
    if (next !== row.fields[field]) {
      setFields[`fields.${field}`] = next;
      correctionEntries.push({ field, from: row.fields[field], to: next, by: user.id, at: now });
    }
  }
  if (correctionEntries.length === 0) throw unprocessable('NO_CHANGES', 'Nothing changed in this row.');

  const updated = await StagingRow.findOneAndUpdate(
    { _id: row._id, rowVersion: row.rowVersion },
    { $set: { ...setFields, validationStatus: 'STALE' }, $inc: { rowVersion: 1 }, $push: { corrections: { $each: correctionEntries } } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('ROW_CHANGED_CONCURRENTLY', 'This row was changed by another request. Reload it and try again.');

  await markNeedsRevalidation(batch, user, 'ROWS_CORRECTED');
  await refreshBatchCounts(batchId);
  await recordAudit({
    ...auditBase(user, batch),
    action: 'BATCH_ROW_CORRECTED',
    payload: { rowNumber, fields: correctionEntries.map((entry) => entry.field), rowVersion: updated.rowVersion },
  });
  return { rowNumber, rowVersion: updated.rowVersion, changedFields: correctionEntries.map((entry) => entry.field) };
}

async function setRowIncluded(user, batchId, rowNumber, included, reason) {
  const batch = await loadEditableBatch(user, batchId);
  const row = await StagingRow.findOne({ batchId, rowNumber }).lean();
  if (!row) throw notFound('Row not found in this batch.');
  if (row.included === included) {
    throw conflict('ROW_ALREADY_IN_STATE', included ? 'The row is already included.' : 'The row is already excluded.');
  }
  const update = included
    ? { $set: { included: true, validationStatus: 'STALE' }, $unset: { exclusion: 1 }, $inc: { rowVersion: 1 } }
    : { $set: { included: false, validationStatus: 'EXCLUDED', exclusion: { reason, by: user.id, at: new Date() } }, $inc: { rowVersion: 1 } };
  const updated = await StagingRow.findOneAndUpdate({ _id: row._id, rowVersion: row.rowVersion }, update, { returnDocument: 'after' }).lean();
  if (!updated) throw conflict('ROW_CHANGED_CONCURRENTLY', 'This row was changed by another request. Reload it and try again.');
  await markNeedsRevalidation(batch, user, included ? 'ROW_INCLUDED' : 'ROW_EXCLUDED');
  await refreshBatchCounts(batchId);
  await recordAudit({
    ...auditBase(user, batch),
    action: included ? 'BATCH_ROW_INCLUDED' : 'BATCH_ROW_EXCLUDED',
    reason: included ? null : reason,
    payload: { rowNumber },
  });
  return { rowNumber, included, rowVersion: updated.rowVersion };
}

async function revalidate(user, batchId, config) {
  requireRole(user, ROLES.COLLEGE_OPERATOR, 'Only the college operator can revalidate a batch.');
  const batch = await findBatchForUser(user, batchId);
  const allowed = BATCH_REVALIDATABLE_STATUSES.filter((status) => status !== BATCH_STATUS.UPLOADED);
  if (!allowed.includes(batch.status)) throw conflict('BATCH_NOT_REVALIDATABLE', `A batch in status ${batch.status} cannot be revalidated.`);
  return startValidation(batchId, user, {
    awaitCompletion: config.validationMode === 'sync',
    fromStatuses: allowed,
    institutionId: user.institutionId,
  });
}

// Whether the current policy lets this issue be justified (PENDING depends on the demo setting).
function canBeJustified(issue, settings) {
  if (issue.severity === SEVERITY.PENDING) return settings.pendingIdentityPolicy === 'ALLOW_WITH_HEAD_DISPOSITION' && issue.dispositionRequired;
  return issue.dispositionRequired;
}

async function justifyIssue(user, batchId, issueId, text) {
  requireRole(user, ROLES.COLLEGE_OPERATOR, 'Only the college operator records justifications.');
  const batch = await findBatchForUser(user, batchId);
  if (![BATCH_STATUS.NEEDS_CORRECTION, BATCH_STATUS.VALIDATED, BATCH_STATUS.RETURNED_FOR_CORRECTION].includes(batch.status)) {
    throw conflict('BATCH_NOT_EDITABLE', `Justifications cannot be recorded while the batch is ${batch.status}.`);
  }
  if (!mongoose.isValidObjectId(issueId)) throw notFound('Issue not found.');
  const issue = await ValidationIssue.findOne({ _id: issueId, batchId, current: true }).lean();
  if (!issue) throw notFound('Issue not found (it may have been superseded by a newer validation run).');
  const settings = await getSettings();
  if (!canBeJustified(issue, settings)) {
    const message = issue.severity === SEVERITY.ERROR
      ? 'Errors cannot be justified. Correct the row or exclude it.'
      : 'This outcome does not need or allow a justification under the current policy.';
    throw unprocessable('DISPOSITION_NOT_ALLOWED', message);
  }
  if (issue.resolutionStatus === ISSUE_STATUS.ACCEPTED) throw conflict('ALREADY_ACCEPTED', 'The college head has already accepted this disposition.');
  await ValidationIssue.updateOne(
    { _id: issue._id, current: true },
    { $set: { resolutionStatus: ISSUE_STATUS.JUSTIFIED, justification: { text, by: user.id, at: new Date() } } }
  );
  await refreshBatchCounts(batchId);
  await recordAudit({
    ...auditBase(user, batch),
    action: 'BATCH_ISSUE_JUSTIFIED',
    payload: { issueId: String(issue._id), ruleCode: issue.ruleCode, rowNumber: issue.rowNumber },
  });
  return { issueId: String(issue._id), resolutionStatus: ISSUE_STATUS.JUSTIFIED };
}

async function markReady(user, batchId, note) {
  requireRole(user, ROLES.COLLEGE_OPERATOR, 'Only the college operator can mark a batch ready for review.');
  const batch = await findBatchForUser(user, batchId);
  const readiness = await computeReadiness(batch);
  if (!readiness.canMarkReady) {
    throw conflict('MARK_READY_BLOCKED', 'The batch is not ready for review yet.', { blockers: readiness.markReadyBlockers });
  }
  const updated = await transition(batch, [BATCH_STATUS.VALIDATED], BATCH_STATUS.READY_FOR_REVIEW, user, 'Marked ready for review', {
    readyForReview: { by: user.id, at: new Date(), note: note || '' },
  });
  await recordAudit({ ...auditBase(user, batch), action: 'BATCH_MARKED_READY', payload: { counts: readiness.counts } });
  await notifications.safely(
    notifications.notifyInstitutionRoles(batch.institutionId, [ROLES.COLLEGE_HEAD], {
      type: 'BATCH_READY_FOR_REVIEW',
      message: `Batch ${batch.batchId} is ready for your review and certification.`,
      entityType: 'UploadBatch',
      entityRef: batch.batchId,
      link: `/college/batches/${batch.batchId}`,
    }),
    'markReady'
  );
  return updated;
}

async function returnForCorrection(user, batchId, reason) {
  requireRole(user, ROLES.COLLEGE_HEAD, 'Only the college head can return a batch for correction.');
  const batch = await findBatchForUser(user, batchId);
  const updated = await transition(
    batch,
    [BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.COMMIT_FAILED],
    BATCH_STATUS.RETURNED_FOR_CORRECTION,
    user,
    reason,
    { returnInfo: { by: user.id, at: new Date(), reason } }
  );
  await recordAudit({ ...auditBase(user, batch), action: 'BATCH_RETURNED', reason });
  await notifications.safely(
    notifications.notifyInstitutionRoles(batch.institutionId, [ROLES.COLLEGE_OPERATOR], {
      type: 'BATCH_RETURNED',
      message: `Batch ${batch.batchId} was returned for correction by the college head.`,
      entityType: 'UploadBatch',
      entityRef: batch.batchId,
      link: `/college/batches/${batch.batchId}`,
    }),
    'returnForCorrection'
  );
  return updated;
}

async function acceptDispositions(user, batchId, issueIds, reason) {
  requireRole(user, ROLES.COLLEGE_HEAD, 'Only the college head can accept warning dispositions.');
  const batch = await findBatchForUser(user, batchId);
  if (batch.status !== BATCH_STATUS.READY_FOR_REVIEW) {
    throw conflict('BATCH_NOT_IN_REVIEW', 'Dispositions can only be accepted while the batch is ready for review.');
  }
  const validIds = issueIds.filter((id) => mongoose.isValidObjectId(id));
  const issues = await ValidationIssue.find({ _id: { $in: validIds }, batchId, current: true }).lean();
  const settings = await getSettings();
  const problems = [];
  for (const id of issueIds) {
    const issue = issues.find((item) => String(item._id) === id);
    if (!issue) problems.push({ issueId: id, problem: 'Not found or no longer current.' });
    else if (!canBeJustified(issue, settings)) problems.push({ issueId: id, problem: 'This outcome type does not allow a disposition.' });
    else if (issue.resolutionStatus !== ISSUE_STATUS.JUSTIFIED) problems.push({ issueId: id, problem: 'The operator has not recorded a justification yet.' });
  }
  if (problems.length > 0) throw unprocessable('DISPOSITION_NOT_ALLOWED', 'Some selected issues cannot be accepted.', { problems });

  const result = await ValidationIssue.updateMany(
    { _id: { $in: issues.map((issue) => issue._id) }, current: true, resolutionStatus: ISSUE_STATUS.JUSTIFIED },
    { $set: { resolutionStatus: ISSUE_STATUS.ACCEPTED, disposition: { decision: 'ACCEPTED', reason, by: user.id, at: new Date() } } }
  );
  await refreshBatchCounts(batchId);
  await recordAudit({
    ...auditBase(user, batch),
    action: 'BATCH_DISPOSITION_ACCEPTED',
    reason,
    payload: { accepted: result.modifiedCount, ruleCodes: [...new Set(issues.map((issue) => issue.ruleCode))] },
  });
  return { accepted: result.modifiedCount };
}

async function discardBatch(user, batchId, reason) {
  requireRole(user, ROLES.COLLEGE_OPERATOR, 'Only the college operator can discard a staged batch.');
  const batch = await findBatchForUser(user, batchId);
  const updated = await transition(
    batch,
    [BATCH_STATUS.UPLOADED, BATCH_STATUS.NEEDS_CORRECTION, BATCH_STATUS.VALIDATED, BATCH_STATUS.RETURNED_FOR_CORRECTION, BATCH_STATUS.COMMIT_FAILED],
    BATCH_STATUS.DISCARDED,
    user,
    reason,
    { discarded: { by: user.id, at: new Date(), reason } }
  );
  await recordAudit({ ...auditBase(user, batch), action: 'BATCH_DISCARDED', reason });
  return updated;
}

module.exports = {
  correctRow,
  setRowIncluded,
  revalidate,
  justifyIssue,
  markReady,
  returnForCorrection,
  acceptDispositions,
  discardBatch,
  transition,
};
