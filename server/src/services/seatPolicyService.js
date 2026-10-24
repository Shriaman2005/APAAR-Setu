// Seat policy versions: draft -> validate -> submit -> approve & publish (maker-checker).
// Capacities are SYNTHETIC demo configuration; publishing never invents official quotas.
const mongoose = require('mongoose');
const { SeatPolicy, SeatLedger, Institution, Course, User, UploadBatch } = require('../models');
const { ROLES, POLICY_STATUS, SYNTHETIC_SOURCE_TYPE, USER_STATUS, BATCH_STATUS } = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { isValidAcademicYear, isValidIsoDate } = require('../utils/dates');
const { sha256Hex, canonicalJson } = require('../utils/hash');
const { runInTransaction } = require('../utils/transaction');
const { getApprovedCourse } = require('../adapters/mockApprovalAdapter');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

const BUCKET_CODE = /^[A-Z][A-Z0-9_]{1,29}$/;

function contentHash(policy) {
  return sha256Hex(canonicalJson({
    academicYear: policy.academicYear,
    version: policy.version,
    sourceReference: policy.sourceReference,
    admissionWindow: policy.admissionWindow,
    scopes: policy.scopes,
  }));
}

function present(policy, names = new Map()) {
  return {
    id: String(policy._id),
    academicYear: policy.academicYear,
    version: policy.version,
    status: policy.status,
    sourceType: policy.sourceType,
    sourceReference: policy.sourceReference,
    notes: policy.notes,
    admissionWindow: policy.admissionWindow,
    scopes: policy.scopes,
    authoredByName: names.get(String(policy.authoredBy)) || null,
    authoredBy: policy.authoredBy ? String(policy.authoredBy) : null,
    submittedAt: policy.submittedAt,
    approvedByName: names.get(String(policy.approvedBy)) || null,
    approvedAt: policy.approvedAt,
    effectiveAt: policy.effectiveAt,
    supersededAt: policy.supersededAt,
    lastValidation: policy.lastValidation?.checkedAt
      ? { ...policy.lastValidation, upToDate: policy.lastValidation.contentHash === contentHash(policy) }
      : null,
    rejection: policy.rejection?.at ? { reason: policy.rejection.reason, at: policy.rejection.at } : null,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

async function namesFor(policies) {
  const ids = policies.flatMap((p) => [p.authoredBy, p.approvedBy]).filter(Boolean);
  const users = await User.find({ _id: { $in: ids } }, { displayName: 1 }).lean();
  return new Map(users.map((user) => [String(user._id), user.displayName]));
}

function assertCanRead(user) {
  if (![ROLES.AICTE_SYSTEM_ADMIN, ROLES.AICTE_NATIONAL_OFFICER].includes(user.role)) {
    throw forbidden('Only system administrators and national officers can view seat policies.');
  }
}

function assertAdmin(user) {
  if (user.role !== ROLES.AICTE_SYSTEM_ADMIN) throw forbidden('Only a system administrator can change seat policies.');
}

async function loadPolicy(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Seat policy not found.');
  const policy = await SeatPolicy.findById(id).lean();
  if (!policy) throw notFound('Seat policy not found.');
  return policy;
}

async function listPolicies(user, query = {}) {
  assertCanRead(user);
  const filter = {};
  if (typeof query.academicYear === 'string' && isValidAcademicYear(query.academicYear)) filter.academicYear = query.academicYear;
  const policies = await SeatPolicy.find(filter).sort({ academicYear: -1, createdAt: -1 }).limit(100).lean();
  const names = await namesFor(policies);
  return policies.map((policy) => present(policy, names));
}

async function getPolicy(user, id) {
  assertCanRead(user);
  const policy = await loadPolicy(id);
  return present(policy, await namesFor([policy]));
}

function normaliseScopes(scopes) {
  return scopes.map((scope) => ({
    institutionCode: String(scope.institutionCode).trim().toUpperCase(),
    courseCode: String(scope.courseCode).trim().toUpperCase(),
    buckets: scope.buckets.map((bucket) => ({
      code: String(bucket.code).trim().toUpperCase(),
      capacity: bucket.capacity,
      countsWithinIntake: bucket.countsWithinIntake,
    })),
  }));
}

async function createDraft(user, body) {
  assertAdmin(user);
  const exists = await SeatPolicy.exists({ academicYear: body.academicYear, version: body.version });
  if (exists) throw conflict('POLICY_VERSION_EXISTS', `Version ${body.version} already exists for ${body.academicYear}.`);
  const policy = await SeatPolicy.create({
    academicYear: body.academicYear,
    version: body.version,
    status: POLICY_STATUS.DRAFT,
    sourceType: SYNTHETIC_SOURCE_TYPE,
    sourceReference: body.sourceReference,
    notes: body.notes || '',
    admissionWindow: body.admissionWindow,
    scopes: normaliseScopes(body.scopes),
    authoredBy: user.id,
  });
  await recordAudit({ actor: user, action: 'POLICY_DRAFT_CREATED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}`, payload: { scopes: policy.scopes.length } });
  return present(policy.toObject(), await namesFor([policy]));
}

async function updateDraft(user, id, body) {
  assertAdmin(user);
  const policy = await loadPolicy(id);
  if (policy.status !== POLICY_STATUS.DRAFT) throw conflict('POLICY_NOT_DRAFT', 'Only a draft can be edited.');
  if (String(policy.authoredBy) !== String(user.id)) throw forbidden('Only the author of a draft can edit it.');
  const update = {};
  if (body.sourceReference !== undefined) update.sourceReference = body.sourceReference;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.admissionWindow !== undefined) update.admissionWindow = body.admissionWindow;
  if (body.scopes !== undefined) update.scopes = normaliseScopes(body.scopes);
  const updated = await SeatPolicy.findOneAndUpdate({ _id: policy._id, status: POLICY_STATUS.DRAFT }, { $set: update }, { returnDocument: 'after' }).lean();
  if (!updated) throw conflict('POLICY_NOT_DRAFT', 'The draft changed status in the meantime.');
  await recordAudit({ actor: user, action: 'POLICY_DRAFT_UPDATED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}`, payload: { fields: Object.keys(update) } });
  return present(updated, await namesFor([updated]));
}

/**
 * Schema and consistency checks. Errors block submission and publication.
 */
async function checkPolicy(policy) {
  const errors = [];
  const warnings = [];
  if (!isValidAcademicYear(policy.academicYear)) errors.push('Academic year must look like 2026-27.');
  if (!policy.sourceReference) errors.push('A source reference is required (demo fixture ID or approval reference).');
  if (policy.sourceType !== SYNTHETIC_SOURCE_TYPE) errors.push(`Prototype policies must be labelled ${SYNTHETIC_SOURCE_TYPE}.`);
  const { opensOn, closesOn } = policy.admissionWindow || {};
  if (!isValidIsoDate(opensOn) || !isValidIsoDate(closesOn)) errors.push('Admission window dates must be valid YYYY-MM-DD dates.');
  else if (opensOn > closesOn) errors.push('Admission window opens after it closes.');
  if (!policy.scopes || policy.scopes.length === 0) errors.push('At least one institution/course scope is required.');

  const seen = new Set();
  const plannedKeys = new Set();
  for (const scope of policy.scopes || []) {
    const label = `${scope.institutionCode}/${scope.courseCode}`;
    if (seen.has(label)) errors.push(`${label}: listed more than once.`);
    seen.add(label);
    const institution = await Institution.findOne({ institutionCode: scope.institutionCode }).lean();
    if (!institution) {
      errors.push(`${label}: institution code is unknown.`);
      continue;
    }
    const approval = await getApprovedCourse({ institutionId: institution._id, courseCode: scope.courseCode, academicYear: policy.academicYear });
    if (!approval.found) {
      errors.push(`${label}: course is not configured for ${policy.academicYear} in the (mock) approval data.`);
      continue;
    }
    if (!scope.buckets || scope.buckets.length === 0) errors.push(`${label}: at least one bucket is required.`);
    const codes = new Set();
    let withinIntake = 0;
    for (const bucket of scope.buckets || []) {
      if (!BUCKET_CODE.test(bucket.code)) errors.push(`${label}: bucket code "${bucket.code}" is invalid.`);
      if (codes.has(bucket.code)) errors.push(`${label}: bucket ${bucket.code} is listed twice.`);
      codes.add(bucket.code);
      if (!Number.isInteger(bucket.capacity) || bucket.capacity < 0 || bucket.capacity > 10000) {
        errors.push(`${label}/${bucket.code}: capacity must be a whole number from 0 to 10000.`);
      }
      if (typeof bucket.countsWithinIntake !== 'boolean') errors.push(`${label}/${bucket.code}: countsWithinIntake must be true or false.`);
      if (bucket.countsWithinIntake) withinIntake += bucket.capacity;
      plannedKeys.add(`${approval.courseId}|${bucket.code}`);
    }
    if (withinIntake > approval.approvedIntake) {
      errors.push(`${label}: buckets counting within intake total ${withinIntake}, above the (mock) approved intake of ${approval.approvedIntake}.`);
    }
    // A new capacity can never be lower than seats already filled.
    const ledgers = await SeatLedger.find({ courseId: approval.courseId, academicYear: policy.academicYear }).lean();
    for (const ledger of ledgers) {
      const bucket = (scope.buckets || []).find((item) => item.code === ledger.bucketCode);
      if (bucket && Number.isInteger(bucket.capacity) && bucket.capacity < ledger.filled) {
        errors.push(`${label}/${ledger.bucketCode}: capacity ${bucket.capacity} is below the ${ledger.filled} seat(s) already filled.`);
      }
    }
  }
  // Existing ledgers of this year that the new policy would no longer contain.
  const yearLedgers = await SeatLedger.find({ academicYear: policy.academicYear, inActivePolicy: true }).lean();
  for (const ledger of yearLedgers) {
    if (plannedKeys.has(`${ledger.courseId}|${ledger.bucketCode}`)) continue;
    if (ledger.filled > 0) {
      errors.push(`${ledger.courseCode}/${ledger.bucketCode}: cannot remove a bucket that has ${ledger.filled} filled seat(s).`);
    } else {
      warnings.push(`${ledger.courseCode}/${ledger.bucketCode}: not in this version; the empty ledger will be marked inactive.`);
    }
  }
  return { errors, warnings };
}

async function validateDraft(user, id) {
  assertAdmin(user);
  const policy = await loadPolicy(id);
  if (![POLICY_STATUS.DRAFT, POLICY_STATUS.PENDING_APPROVAL].includes(policy.status)) {
    throw conflict('POLICY_NOT_EDITABLE', 'Only drafts or policies awaiting approval can be validated.');
  }
  const { errors, warnings } = await checkPolicy(policy);
  const lastValidation = {
    status: errors.length === 0 ? 'PASSED' : 'FAILED', errors, warnings, checkedAt: new Date(), checkedBy: user.id, contentHash: contentHash(policy),
  };
  const updated = await SeatPolicy.findByIdAndUpdate(policy._id, { $set: { lastValidation } }, { returnDocument: 'after' }).lean();
  await recordAudit({ actor: user, action: 'POLICY_VALIDATED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}`, payload: { status: lastValidation.status, errors: errors.length, warnings: warnings.length } });
  return present(updated, await namesFor([updated]));
}

async function submitForApproval(user, id) {
  assertAdmin(user);
  const policy = await loadPolicy(id);
  if (policy.status !== POLICY_STATUS.DRAFT) throw conflict('POLICY_NOT_DRAFT', 'Only a draft can be submitted.');
  if (String(policy.authoredBy) !== String(user.id)) throw forbidden('Only the author can submit this draft.');
  if (policy.lastValidation?.status !== 'PASSED' || policy.lastValidation.contentHash !== contentHash(policy)) {
    throw unprocessable('POLICY_NOT_VALIDATED', 'Run "Validate rules" on the current draft and fix all errors before submitting.');
  }
  const updated = await SeatPolicy.findOneAndUpdate(
    { _id: policy._id, status: POLICY_STATUS.DRAFT },
    { $set: { status: POLICY_STATUS.PENDING_APPROVAL, submittedBy: user.id, submittedAt: new Date() }, $unset: { rejection: 1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('POLICY_NOT_DRAFT', 'The draft changed status in the meantime.');
  await recordAudit({ actor: user, action: 'POLICY_SUBMITTED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}` });
  const approvers = await User.find({ role: ROLES.AICTE_SYSTEM_ADMIN, status: USER_STATUS.ACTIVE, _id: { $ne: user.id } }, { _id: 1 }).lean();
  await notifications.safely(notifications.notifyUsers(approvers.map((a) => a._id), {
    type: 'POLICY_AWAITING_APPROVAL', message: `Seat policy ${policy.version} (${policy.academicYear}) is awaiting approval by a different administrator.`,
    entityType: 'SeatPolicy', entityRef: String(policy._id), link: `/admin/policies/${policy._id}`,
  }), 'policy-submit');
  return present(updated, await namesFor([updated]));
}

function assertDifferentApprover(user, policy) {
  if (String(policy.authoredBy) === String(user.id) || String(policy.submittedBy) === String(user.id)) {
    throw forbidden('Separation of duties: a different administrator must approve this policy.', 'MAKER_CHECKER_VIOLATION');
  }
}

async function rejectPolicy(user, id, reason) {
  assertAdmin(user);
  const policy = await loadPolicy(id);
  if (policy.status !== POLICY_STATUS.PENDING_APPROVAL) throw conflict('POLICY_NOT_PENDING', 'Only a policy awaiting approval can be returned.');
  assertDifferentApprover(user, policy);
  const updated = await SeatPolicy.findOneAndUpdate(
    { _id: policy._id, status: POLICY_STATUS.PENDING_APPROVAL },
    { $set: { status: POLICY_STATUS.DRAFT, rejection: { reason, by: user.id, at: new Date() } } },
    { returnDocument: 'after' }
  ).lean();
  await recordAudit({ actor: user, action: 'POLICY_REJECTED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}`, reason });
  return present(updated, await namesFor([updated]));
}

/**
 * Approve and publish. One transaction: supersede the old version, publish this one, apply the
 * capacities to the seat ledgers and write the audit event. The previous version is retained.
 */
async function publishPolicy(user, id) {
  assertAdmin(user);
  const policy = await loadPolicy(id);
  if (policy.status !== POLICY_STATUS.PENDING_APPROVAL) throw conflict('POLICY_NOT_PENDING', 'Only a policy awaiting approval can be published.');
  assertDifferentApprover(user, policy);
  const { errors } = await checkPolicy(policy);
  if (errors.length > 0) throw unprocessable('POLICY_INVALID', 'The policy no longer passes validation.', { errors });

  const now = new Date();
  const previous = await runInTransaction(async (session) => {
    const old = await SeatPolicy.findOneAndUpdate(
      { academicYear: policy.academicYear, status: POLICY_STATUS.PUBLISHED },
      { $set: { status: POLICY_STATUS.SUPERSEDED, supersededAt: now } },
      { session, returnDocument: 'after' }
    ).lean();
    const published = await SeatPolicy.findOneAndUpdate(
      { _id: policy._id, status: POLICY_STATUS.PENDING_APPROVAL },
      { $set: { status: POLICY_STATUS.PUBLISHED, approvedBy: user.id, approvedAt: now, effectiveAt: now } },
      { session, returnDocument: 'after' }
    ).lean();
    if (!published) throw conflict('POLICY_NOT_PENDING', 'The policy changed status in the meantime.');
    const keep = [];
    for (const scope of policy.scopes) {
      const institution = await Institution.findOne({ institutionCode: scope.institutionCode }).session(session).lean();
      const course = await Course.findOne({ institutionId: institution._id, courseCode: scope.courseCode, academicYear: policy.academicYear }).session(session).lean();
      for (const bucket of scope.buckets) {
        keep.push({ courseId: course._id, bucketCode: bucket.code });
        await SeatLedger.updateOne(
          { courseId: course._id, academicYear: policy.academicYear, bucketCode: bucket.code },
          {
            $set: {
              institutionId: institution._id, regionId: institution.regionId, courseCode: course.courseCode, capacity: bucket.capacity,
              countsWithinIntake: bucket.countsWithinIntake, policyVersion: policy.version, sourceType: policy.sourceType, inActivePolicy: true,
            },
            $setOnInsert: { filled: 0 },
          },
          { session, upsert: true }
        );
      }
    }
    const yearLedgers = await SeatLedger.find({ academicYear: policy.academicYear }).session(session).lean();
    for (const ledger of yearLedgers) {
      const stillActive = keep.some((item) => String(item.courseId) === String(ledger.courseId) && item.bucketCode === ledger.bucketCode);
      if (!stillActive) {
        await SeatLedger.updateOne({ _id: ledger._id, filled: 0 }, { $set: { inActivePolicy: false, policyVersion: policy.version } }, { session });
      }
    }
    await recordAudit({
      actor: user, action: 'POLICY_PUBLISHED', entityType: 'SeatPolicy', entityRef: `${policy.academicYear}/${policy.version}`,
      payload: { supersededVersion: old ? old.version : null, sourceType: policy.sourceType, sourceReference: policy.sourceReference, effectiveAt: now.toISOString() },
    }, { session });
    return old;
  });

  // Batches validated under the old version must be revalidated before certification.
  const staleCount = await UploadBatch.countDocuments({
    academicYear: policy.academicYear,
    status: { $in: [BATCH_STATUS.VALIDATED, BATCH_STATUS.READY_FOR_REVIEW, BATCH_STATUS.NEEDS_CORRECTION, BATCH_STATUS.RETURNED_FOR_CORRECTION] },
    validatedPolicyVersion: { $ne: policy.version },
  });
  const updated = await SeatPolicy.findById(policy._id).lean();
  return { policy: present(updated, await namesFor([updated])), supersededVersion: previous ? previous.version : null, batchesNeedingRevalidation: staleCount };
}

async function comparePolicies(user, fromId, toId) {
  assertCanRead(user);
  const [from, to] = await Promise.all([loadPolicy(fromId), loadPolicy(toId)]);
  const flatten = (policy) => {
    const map = new Map();
    for (const scope of policy.scopes) {
      for (const bucket of scope.buckets) map.set(`${scope.institutionCode}/${scope.courseCode}/${bucket.code}`, bucket);
    }
    return map;
  };
  const a = flatten(from);
  const b = flatten(to);
  const differences = [];
  for (const [key, bucket] of a) {
    if (!b.has(key)) differences.push({ key, change: 'REMOVED', from: bucket, to: null });
    else {
      const other = b.get(key);
      if (other.capacity !== bucket.capacity || other.countsWithinIntake !== bucket.countsWithinIntake) {
        differences.push({ key, change: 'CHANGED', from: bucket, to: other });
      }
    }
  }
  for (const [key, bucket] of b) if (!a.has(key)) differences.push({ key, change: 'ADDED', from: null, to: bucket });
  const metadata = ['academicYear', 'version', 'status', 'sourceType', 'sourceReference', 'notes'].map((field) => ({ field, from: from[field], to: to[field], changed: from[field] !== to[field] }));
  metadata.push({ field: 'admissionWindow', from: from.admissionWindow, to: to.admissionWindow, changed: canonicalJson(from.admissionWindow) !== canonicalJson(to.admissionWindow) });
  const names = await namesFor([from, to]);
  return { from: present(from, names), to: present(to, names), differences: differences.sort((x, y) => x.key.localeCompare(y.key)), metadata };
}

module.exports = {
  listPolicies, getPolicy, createDraft, updateDraft, validateDraft, submitForApproval, rejectPolicy, publishPolicy, comparePolicies, checkPolicy, contentHash,
};
