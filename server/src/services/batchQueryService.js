// Read-side of the batch workflow: scoped lookups, readiness checks, review summary and exports.
const {
  UploadBatch, StagingRow, ValidationIssue, SeatPolicy, SeatLedger, Institution, User,
} = require('../models');
const {
  ROLES, COLLEGE_ROLES, BATCH_STATUS, BATCH_EDITABLE_STATUSES, BATCH_REVALIDATABLE_STATUSES,
  POLICY_STATUS, SEVERITY, ISSUE_STATUS, CSV_COLUMNS,
} = require('../config/constants');
const { forbidden, notFound } = require('../utils/AppError');
const { readPagination, pageResult, escapeRegex, readSearch } = require('../utils/pagination');
const { maskIdentifier } = require('../utils/mask');
const { refreshBatchCounts } = require('./validation/pipeline');
const { getSettings } = require('./settingsService');
const { RULES } = require('./validation/ruleCatalog');
const { entityTimeline } = require('./auditService');

const DECLARATION_VERSION = 'DECL-DEMO-v1';

function declarationText(institutionName, academicYear, rowCount) {
  return (
    `I, the authorised head of ${institutionName}, confirm that I have reviewed this batch of ${rowCount} admission ` +
    `record(s) for ${academicYear}, its validation results and the warning dispositions shown, and that to the best of my ` +
    'knowledge the records are accurate. I understand that certifying commits these records to the prototype register. ' +
    '(Prototype declaration using synthetic data. It is not a legal instrument or an official AICTE form.)'
  );
}

/**
 * Loads a batch the user may see. Batches belong to one institution and are visible only to that
 * institution's operator and head. Other institutions get 404 (the batch is concealed, not revealed).
 */
async function findBatchForUser(user, batchId) {
  if (!COLLEGE_ROLES.includes(user.role)) throw forbidden('Only college operators and heads can open admission batches.');
  if (typeof batchId !== 'string' || batchId.length > 80) throw notFound('Batch not found.');
  const batch = await UploadBatch.findOne({ batchId, institutionId: user.institutionId }).lean();
  if (!batch) throw notFound('Batch not found.');
  return batch;
}

async function getActivePolicy(academicYear) {
  return SeatPolicy.findOne({ academicYear, status: POLICY_STATUS.PUBLISHED }, { version: 1, sourceType: 1, admissionWindow: 1 }).lean();
}

/**
 * Works out what still blocks "Mark ready for review" (operator) and "Certify" (head).
 * Always recomputed from the database so a stale UI can never unlock an action.
 */
async function computeReadiness(batch) {
  const [counts, activePolicy, settings, pendingCount] = await Promise.all([
    refreshBatchCounts(batch.batchId),
    getActivePolicy(batch.academicYear),
    getSettings(),
    ValidationIssue.countDocuments({ batchId: batch.batchId, current: true, severity: SEVERITY.PENDING }),
  ]);
  const common = [];
  if (counts.includedRows === 0) common.push({ code: 'NO_INCLUDED_ROWS', message: 'Every row is excluded, so there is nothing to submit.' });
  if (counts.staleRows > 0) {
    common.push({ code: 'STALE_ROWS', message: `${counts.staleRows} row(s) changed since the last validation. Run "Revalidate changed rows".` });
  }
  if (batch.revalidationRequired) {
    common.push({ code: 'REVALIDATION_REQUIRED', message: `Revalidation is required (${batch.revalidationReason || 'rules changed'}).` });
  }
  if (counts.openErrors > 0) {
    common.push({ code: 'OPEN_ERRORS', message: `${counts.openErrors} blocking error(s) must be corrected or the rows excluded.` });
  }
  if (pendingCount > 0 && settings.pendingIdentityPolicy === 'BLOCK_UNTIL_RESOLVED') {
    common.push({ code: 'PENDING_CHECKS', message: `${pendingCount} identity check(s) are pending. Current policy blocks submission until they complete (retry by revalidating).` });
  }
  if (!activePolicy) {
    common.push({ code: 'NO_ACTIVE_POLICY', message: `No seat policy is published for ${batch.academicYear}.` });
  } else if (batch.validatedPolicyVersion !== activePolicy.version) {
    common.push({
      code: 'STALE_POLICY_VERSION',
      message: `The batch was validated under seat policy ${batch.validatedPolicyVersion || 'none'} but ${activePolicy.version} is now active. Revalidate before submitting.`,
    });
  }

  const markReadyBlockers = [...common];
  if (counts.warningsNeedingJustification > 0) {
    markReadyBlockers.push({ code: 'JUSTIFICATIONS_MISSING', message: `${counts.warningsNeedingJustification} warning(s)/pending check(s) need a justification from the operator.` });
  }
  if (batch.status !== BATCH_STATUS.VALIDATED) {
    markReadyBlockers.push({ code: 'STATUS', message: `The batch must be VALIDATED (current status ${batch.status}).` });
  }

  const certifyBlockers = [...common];
  if (counts.dispositionsAwaitingHead > 0) {
    certifyBlockers.push({ code: 'DISPOSITIONS_PENDING', message: `${counts.dispositionsAwaitingHead} warning disposition(s) still need the college head's acceptance.` });
  }
  if (![BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.COMMIT_FAILED].includes(batch.status)) {
    certifyBlockers.push({ code: 'STATUS', message: `Only a batch that is READY_FOR_REVIEW can be certified (current status ${batch.status}).` });
  }

  return {
    counts,
    activePolicyVersion: activePolicy?.version || null,
    canMarkReady: markReadyBlockers.length === 0,
    markReadyBlockers,
    canCertify: certifyBlockers.length === 0,
    certifyBlockers,
  };
}

function permissionsFor(user, batch) {
  const isOperator = user.role === ROLES.COLLEGE_OPERATOR;
  const isHead = user.role === ROLES.COLLEGE_HEAD;
  return {
    canEditRows: isOperator && BATCH_EDITABLE_STATUSES.includes(batch.status),
    canRevalidate: isOperator && BATCH_REVALIDATABLE_STATUSES.includes(batch.status) && batch.status !== BATCH_STATUS.UPLOADED,
    canJustify: isOperator && [BATCH_STATUS.NEEDS_CORRECTION, BATCH_STATUS.VALIDATED, BATCH_STATUS.RETURNED_FOR_CORRECTION].includes(batch.status),
    canMarkReady: isOperator && batch.status === BATCH_STATUS.VALIDATED,
    canDiscard: isOperator && [BATCH_STATUS.UPLOADED, BATCH_STATUS.NEEDS_CORRECTION, BATCH_STATUS.VALIDATED, BATCH_STATUS.RETURNED_FOR_CORRECTION, BATCH_STATUS.COMMIT_FAILED].includes(batch.status),
    canReturn: isHead && [BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.COMMIT_FAILED].includes(batch.status),
    canAcceptDispositions: isHead && batch.status === BATCH_STATUS.READY_FOR_REVIEW,
    canCertify: isHead && [BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.COMMIT_FAILED].includes(batch.status),
    canExportSummary: isHead,
  };
}

async function presentBatch(batch) {
  const userIds = [batch.createdBy, batch.readyForReview?.by, batch.returnInfo?.by, batch.certification?.certifiedBy, batch.discarded?.by].filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }, { displayName: 1, role: 1 }).lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  const nameOf = (id) => (id ? names.get(String(id)) || 'Unknown user' : null);
  return {
    batchId: batch.batchId,
    academicYear: batch.academicYear,
    status: batch.status,
    sourceFileName: batch.sourceFileName,
    fileSizeBytes: batch.fileSizeBytes,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    createdByName: nameOf(batch.createdBy),
    counts: batch.counts,
    validationRunCount: batch.validationRunCount,
    lastValidatedAt: batch.lastValidatedAt,
    validatedPolicyVersion: batch.validatedPolicyVersion,
    validationRulesetVersion: batch.validationRulesetVersion,
    revalidationRequired: batch.revalidationRequired,
    revalidationReason: batch.revalidationReason,
    readyForReview: batch.readyForReview?.at ? { at: batch.readyForReview.at, byName: nameOf(batch.readyForReview.by), note: batch.readyForReview.note } : null,
    returnInfo: batch.returnInfo?.at ? { at: batch.returnInfo.at, byName: nameOf(batch.returnInfo.by), reason: batch.returnInfo.reason } : null,
    certification: batch.certification?.certifiedBy
      ? { byName: nameOf(batch.certification.certifiedBy), declarationVersion: batch.certification.declarationVersion, startedAt: batch.certification.startedAt, completedAt: batch.certification.completedAt }
      : null,
    commitSummary: batch.commitSummary?.committedAt ? batch.commitSummary : null,
    lastCommitError: batch.lastCommitError?.code ? batch.lastCommitError : null,
    discarded: batch.discarded?.at ? { at: batch.discarded.at, byName: nameOf(batch.discarded.by), reason: batch.discarded.reason } : null,
    statusHistory: batch.statusHistory,
  };
}

async function getBatchDetail(user, batchId) {
  const batch = await findBatchForUser(user, batchId);
  const readiness = await computeReadiness(batch);
  const fresh = await UploadBatch.findOne({ batchId }).lean();
  return { batch: await presentBatch(fresh), readiness, permissions: permissionsFor(user, fresh) };
}

async function listBatches(user, query) {
  if (!COLLEGE_ROLES.includes(user.role)) throw forbidden('Only college users can list admission batches.');
  const filter = { institutionId: user.institutionId };
  if (typeof query.status === 'string' && Object.values(BATCH_STATUS).includes(query.status)) filter.status = query.status;
  const search = readSearch(query);
  if (search) filter.$or = [{ batchId: { $regex: escapeRegex(search), $options: 'i' } }, { sourceFileName: { $regex: escapeRegex(search), $options: 'i' } }];
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    UploadBatch.find(filter, { statusHistory: 0 }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    UploadBatch.countDocuments(filter),
  ]);
  return pageResult(
    items.map((batch) => ({
      batchId: batch.batchId,
      academicYear: batch.academicYear,
      status: batch.status,
      sourceFileName: batch.sourceFileName,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      counts: batch.counts,
      revalidationRequired: batch.revalidationRequired,
    })),
    total,
    pagination
  );
}

// Operators see full values while correcting; the head's review view masks the demo identifier.
function presentRow(row, { unmasked }) {
  const fields = { ...row.fields };
  if (!unmasked) fields.externalIdDemo = maskIdentifier(fields.externalIdDemo);
  return {
    rowNumber: row.rowNumber,
    fields,
    included: row.included,
    exclusion: row.exclusion?.at ? { reason: row.exclusion.reason, at: row.exclusion.at } : null,
    rowVersion: row.rowVersion,
    validatedRowVersion: row.validatedRowVersion,
    isStale: row.rowVersion !== row.validatedRowVersion,
    validationStatus: row.rowVersion !== row.validatedRowVersion && row.validatedRowVersion > 0 ? 'STALE' : row.validationStatus,
    identityCheck: row.identityCheck,
    correctionsCount: (row.corrections || []).length,
    lastValidatedAt: row.lastValidatedAt,
  };
}

async function listRows(user, batchId, query) {
  await findBatchForUser(user, batchId);
  const filter = { batchId };
  const allowedStatuses = ['VALID', 'HAS_ERRORS', 'HAS_WARNINGS', 'PENDING', 'EXCLUDED', 'NOT_VALIDATED'];
  if (typeof query.status === 'string' && allowedStatuses.includes(query.status)) filter.validationStatus = query.status;
  if (query.status === 'STALE') filter.$expr = { $ne: ['$rowVersion', '$validatedRowVersion'] };
  const search = readSearch(query);
  if (search) {
    const regex = { $regex: escapeRegex(search), $options: 'i' };
    const asNumber = Number.parseInt(search, 10);
    filter.$or = [{ 'fields.studentCode': regex }, { 'fields.studentName': regex }, ...(Number.isInteger(asNumber) ? [{ rowNumber: asNumber }] : [])];
  }
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    StagingRow.find(filter).sort({ rowNumber: 1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    StagingRow.countDocuments(filter),
  ]);
  const unmasked = user.role === ROLES.COLLEGE_OPERATOR;
  return pageResult(items.map((row) => presentRow(row, { unmasked })), total, pagination);
}

async function getRowDetail(user, batchId, rowNumber) {
  await findBatchForUser(user, batchId);
  const row = await StagingRow.findOne({ batchId, rowNumber }).lean();
  if (!row) throw notFound('Row not found in this batch.');
  const issues = await ValidationIssue.find({ batchId, rowNumber }).sort({ current: -1, createdAt: -1 }).lean();
  const unmasked = user.role === ROLES.COLLEGE_OPERATOR;
  return {
    row: {
      ...presentRow(row, { unmasked }),
      rawSafeFields: unmasked ? row.rawSafeFields : { ...row.rawSafeFields, externalIdDemo: maskIdentifier(row.rawSafeFields.externalIdDemo) },
      corrections: (row.corrections || []).map((c) => ({
        field: c.field,
        from: !unmasked && c.field === 'externalIdDemo' ? maskIdentifier(c.from) : c.from,
        to: !unmasked && c.field === 'externalIdDemo' ? maskIdentifier(c.to) : c.to,
        at: c.at,
      })),
    },
    editableFields: CSV_COLUMNS,
    currentIssues: issues.filter((issue) => issue.current).map(presentIssue),
    issueHistory: issues.filter((issue) => !issue.current).map(presentIssue),
  };
}

function presentIssue(issue) {
  const rule = RULES[issue.ruleCode];
  return {
    id: String(issue._id),
    rowNumber: issue.rowNumber,
    field: issue.field,
    layer: issue.layer,
    ruleCode: issue.ruleCode,
    ruleTitle: rule ? rule.title : issue.ruleCode,
    severity: issue.severity,
    message: issue.message,
    correctionHint: issue.correctionHint,
    evidence: issue.evidence,
    blocking: issue.blocking,
    dispositionRequired: issue.dispositionRequired,
    resolutionStatus: issue.resolutionStatus,
    justification: issue.justification?.text ? { text: issue.justification.text, at: issue.justification.at } : null,
    disposition: issue.disposition?.decision ? { decision: issue.disposition.decision, reason: issue.disposition.reason, at: issue.disposition.at } : null,
    resolutionReason: issue.resolutionReason || null,
    resolvedAt: issue.resolvedAt || null,
    validationRun: issue.validationRun,
    current: issue.current,
    policyVersion: issue.policyVersion,
    createdAt: issue.createdAt,
  };
}

async function listIssues(user, batchId, query) {
  await findBatchForUser(user, batchId);
  const filter = { batchId, current: query.view !== 'history' };
  if (typeof query.severity === 'string' && Object.values(SEVERITY).includes(query.severity)) filter.severity = query.severity;
  if (typeof query.status === 'string' && Object.values(ISSUE_STATUS).includes(query.status)) filter.resolutionStatus = query.status;
  if (typeof query.layer === 'string' && /^L[1-7]$/.test(query.layer)) filter.layer = query.layer;
  if (query.needsAction === 'true') filter.$or = [{ blocking: true }, { dispositionRequired: true, resolutionStatus: { $ne: ISSUE_STATUS.ACCEPTED } }];
  const rowNumber = Number.parseInt(query.rowNumber, 10);
  if (Number.isInteger(rowNumber)) filter.rowNumber = rowNumber;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    ValidationIssue.find(filter).sort({ rowNumber: 1, layer: 1, createdAt: 1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    ValidationIssue.countDocuments(filter),
  ]);
  return pageResult(items.map(presentIssue), total, pagination);
}

// Seat impact if this batch were committed now (live ledger values).
async function computeLedgerImpact(batch) {
  const rows = await StagingRow.find({ batchId: batch.batchId, included: true }, { fields: 1 }).lean();
  const demand = new Map();
  for (const row of rows) {
    const key = `${row.fields.courseCode}|${row.fields.bucketCode}`;
    demand.set(key, (demand.get(key) || 0) + 1);
  }
  const ledgers = await SeatLedger.find({ institutionId: batch.institutionId, academicYear: batch.academicYear }).lean();
  const byKey = new Map(ledgers.map((ledger) => [`${ledger.courseCode}|${ledger.bucketCode}`, ledger]));
  return [...demand.entries()].map(([key, requested]) => {
    const [courseCode, bucketCode] = key.split('|');
    const ledger = byKey.get(key);
    return ledger
      ? {
        courseCode, bucketCode, requested, capacity: ledger.capacity, filled: ledger.filled,
        remainingAfter: ledger.capacity - ledger.filled - requested, fits: ledger.filled + requested <= ledger.capacity,
        countsWithinIntake: ledger.countsWithinIntake, policyVersion: ledger.policyVersion, sourceType: ledger.sourceType,
      }
      : { courseCode, bucketCode, requested, capacity: null, filled: null, remainingAfter: null, fits: false, policyVersion: null };
  }).sort((a, b) => `${a.courseCode}${a.bucketCode}`.localeCompare(`${b.courseCode}${b.bucketCode}`));
}

async function getReview(user, batchId) {
  const batch = await findBatchForUser(user, batchId);
  const [readiness, institution, ledgerImpact, issueGroups] = await Promise.all([
    computeReadiness(batch),
    Institution.findById(batch.institutionId).lean(),
    computeLedgerImpact(batch),
    ValidationIssue.aggregate([
      { $match: { batchId, current: true } },
      { $group: { _id: { ruleCode: '$ruleCode', severity: '$severity', layer: '$layer', status: '$resolutionStatus' }, count: { $sum: 1 } } },
    ]),
  ]);
  const fresh = await UploadBatch.findOne({ batchId }).lean();
  const byRule = new Map();
  for (const group of issueGroups) {
    const { ruleCode, severity, layer, status } = group._id;
    if (!byRule.has(ruleCode)) byRule.set(ruleCode, { ruleCode, layer, severity, title: RULES[ruleCode]?.title || ruleCode, total: 0, byStatus: {} });
    const entry = byRule.get(ruleCode);
    entry.total += group.count;
    entry.byStatus[status] = group.count;
  }
  return {
    batch: await presentBatch(fresh),
    readiness,
    permissions: permissionsFor(user, fresh),
    ledgerImpact,
    issueSummary: [...byRule.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.ruleCode.localeCompare(b.ruleCode)),
    declaration: {
      version: DECLARATION_VERSION,
      text: declarationText(institution.name, batch.academicYear, readiness.counts.includedRows),
    },
    confirmationNote: 'OTP / e-sign is not implemented in this prototype. Certification asks you to type the batch ID as a confirmation step instead.',
  };
}

async function exportIssues(user, batchId) {
  await findBatchForUser(user, batchId);
  const issues = await ValidationIssue.find({ batchId, current: true }).sort({ rowNumber: 1, layer: 1 }).lean();
  return issues.map((issue) => ({
    rowNumber: issue.rowNumber ?? 'BATCH',
    layer: issue.layer,
    ruleCode: issue.ruleCode,
    severity: issue.severity,
    field: issue.field || '',
    message: issue.message, // messages only ever contain masked identifiers
    resolutionStatus: issue.resolutionStatus,
    justification: issue.justification?.text || '',
    disposition: issue.disposition?.reason || '',
  }));
}

async function exportSummary(user, batchId) {
  if (user.role !== ROLES.COLLEGE_HEAD) throw forbidden('Only the college head can export the submission summary.');
  const batch = await findBatchForUser(user, batchId);
  const rows = await StagingRow.find({ batchId }).sort({ rowNumber: 1 }).lean();
  return {
    batch,
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      studentCode: row.fields.studentCode,
      externalIdDemo: maskIdentifier(row.fields.externalIdDemo),
      courseCode: row.fields.courseCode,
      bucketCode: row.fields.bucketCode,
      yearOfStudy: row.fields.yearOfStudy,
      included: row.included ? 'YES' : 'NO',
      validationStatus: row.validationStatus,
    })),
  };
}

async function batchTimeline(user, batchId) {
  const batch = await findBatchForUser(user, batchId);
  return entityTimeline('UploadBatch', batch.batchId);
}

module.exports = {
  DECLARATION_VERSION,
  declarationText,
  findBatchForUser,
  computeReadiness,
  computeLedgerImpact,
  permissionsFor,
  getBatchDetail,
  listBatches,
  listRows,
  getRowDetail,
  listIssues,
  presentIssue,
  getReview,
  exportIssues,
  exportSummary,
  batchTimeline,
};
