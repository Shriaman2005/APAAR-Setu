// Rule-based risk prioritisation (spec 07 L7, spec 04 risk queue).
// Scores are transparent sums of the weights below. They order a human review queue; they are
// not probabilities, not machine learning, and never an automatic penalty or fraud finding.
const mongoose = require('mongoose');
const { RiskCase, Enrolment, SeatPolicy, SeatLedger, Institution, User } = require('../models');
const { ROLES, RISK_CASE_STATUS, POLICY_STATUS, USER_STATUS } = require('../config/constants');
const { forbidden, notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult } = require('../utils/pagination');
const { maskStudentRef, maskToken } = require('../utils/mask');
const { newRiskCaseId } = require('../utils/ids');
const { sha256Hex, canonicalJson } = require('../utils/hash');
const { RISK_RULESET, priorityForScore } = require('./validation/ruleset');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

// Documented scoring formulas (also shown in the UI).
const SCORING = {
  L7_SHARED_CONTACT: { formula: '30 + 5 x students sharing the token (max 100)', score: (count) => Math.min(100, 30 + 5 * count) },
  L7_LATE_ADDITION: { formula: '20 + 10 x late admissions (max 100)', score: (count) => Math.min(100, 20 + 10 * count) },
  L7_ADDITIONAL_BUCKET_RATIO: {
    formula: '40 + percentage points above the threshold (max 100)',
    score: (share) => Math.min(100, 40 + Math.round((share - RISK_RULESET.additionalBucketShareThreshold) * 100)),
  },
};

/**
 * Evaluates committed (seat-holding) enrolments for one institution and academic year and creates
 * or updates risk cases. Existing evidence is never deleted; new snapshots are appended.
 */
async function evaluateInstitutionYear(institutionId, academicYear, { actor } = {}) {
  const institution = await Institution.findById(institutionId).lean();
  if (!institution) return [];
  const [enrolments, policy, ledgers] = await Promise.all([
    Enrolment.find({ institutionId, academicYear, seatHeld: true }, { enrolmentRef: 1, studentRef: 1, contactToken: 1, admittedOn: 1, courseCode: 1, bucketCode: 1 }).lean(),
    SeatPolicy.findOne({ academicYear, status: POLICY_STATUS.PUBLISHED }).lean(),
    SeatLedger.find({ institutionId, academicYear }, { courseCode: 1, bucketCode: 1, countsWithinIntake: 1 }).lean(),
  ]);
  const signals = [];

  // Shared contact token.
  const byToken = new Map();
  for (const enrolment of enrolments) {
    if (!enrolment.contactToken) continue;
    if (!byToken.has(enrolment.contactToken)) byToken.set(enrolment.contactToken, []);
    byToken.get(enrolment.contactToken).push(enrolment);
  }
  for (const [token, list] of byToken) {
    const students = new Set(list.map((item) => item.studentRef));
    if (students.size < RISK_RULESET.sharedContactMinStudents) continue;
    signals.push({
      signalKey: `SHARED_CONTACT:${sha256Hex(token).slice(0, 16)}`,
      ruleCode: 'L7_SHARED_CONTACT',
      score: SCORING.L7_SHARED_CONTACT.score(students.size),
      reasons: [
        `${students.size} students with active enrolments at this institution share the synthetic contact token ${maskToken(token)} (threshold ${RISK_RULESET.sharedContactMinStudents}).`,
        'Shared contact details can have legitimate explanations, such as a hostel office or a family member. Human review is required.',
      ],
      evidence: {
        studentsSharing: students.size,
        threshold: RISK_RULESET.sharedContactMinStudents,
        tokenMasked: maskToken(token),
        enrolmentRefs: list.slice(0, 50).map((item) => item.enrolmentRef),
        maskedStudentRefs: [...students].slice(0, 50).map(maskStudentRef),
        scoringFormula: SCORING.L7_SHARED_CONTACT.formula,
      },
    });
  }

  // Late additions after the synthetic admission window.
  if (policy) {
    const late = enrolments.filter((item) => item.admittedOn > policy.admissionWindow.closesOn);
    if (late.length > 0) {
      signals.push({
        signalKey: 'LATE_ADDITION',
        ruleCode: 'L7_LATE_ADDITION',
        score: SCORING.L7_LATE_ADDITION.score(late.length),
        reasons: [`${late.length} active enrolment(s) were admitted after the configured window closed on ${policy.admissionWindow.closesOn} (synthetic policy ${policy.version}).`],
        evidence: { lateAdmissions: late.length, closesOn: policy.admissionWindow.closesOn, enrolmentRefs: late.slice(0, 50).map((item) => item.enrolmentRef), scoringFormula: SCORING.L7_LATE_ADDITION.formula },
      });
    }
  }

  // Unusual share of additional (supernumerary) bucket enrolments.
  const additionalKeys = new Set(ledgers.filter((ledger) => ledger.countsWithinIntake === false).map((ledger) => `${ledger.courseCode}|${ledger.bucketCode}`));
  if (enrolments.length >= RISK_RULESET.additionalBucketMinRows) {
    const additional = enrolments.filter((item) => additionalKeys.has(`${item.courseCode}|${item.bucketCode}`));
    const share = additional.length / enrolments.length;
    if (share > RISK_RULESET.additionalBucketShareThreshold) {
      signals.push({
        signalKey: 'ADDITIONAL_BUCKET_RATIO',
        ruleCode: 'L7_ADDITIONAL_BUCKET_RATIO',
        score: SCORING.L7_ADDITIONAL_BUCKET_RATIO.score(share),
        reasons: [`${Math.round(share * 100)}% of active enrolments use additional buckets that do not count within approved intake (threshold ${Math.round(RISK_RULESET.additionalBucketShareThreshold * 100)}%).`],
        evidence: { additionalEnrolments: additional.length, totalEnrolments: enrolments.length, share: Number(share.toFixed(2)), scoringFormula: SCORING.L7_ADDITIONAL_BUCKET_RATIO.formula },
      });
    }
  }

  const results = [];
  for (const signal of signals) {
    const priority = priorityForScore(signal.score);
    const existing = await RiskCase.findOne({ institutionId, academicYear, signalKey: signal.signalKey }).lean();
    if (!existing) {
      const riskCaseId = newRiskCaseId();
      try {
        await RiskCase.create({
          riskCaseId,
          institutionId,
          regionId: institution.regionId,
          academicYear,
          signalKey: signal.signalKey,
          ruleCode: signal.ruleCode,
          rulesetVersion: RISK_RULESET.version,
          score: signal.score,
          priority,
          reasons: signal.reasons,
          evidence: signal.evidence,
          evidenceHistory: [{ evidence: signal.evidence, score: signal.score, at: new Date() }],
          events: [{ type: 'DETECTED', byRole: 'SYSTEM', message: 'Rule-based signal detected. Priority for review only.', at: new Date() }],
          lastEvaluatedAt: new Date(),
        });
      } catch (error) {
        if (error.code === 11000) continue; // evaluated concurrently; the other run created it
        throw error;
      }
      await recordAudit({
        actor: actor || 'system', action: 'RISK_CASE_CREATED', entityType: 'RiskCase', entityRef: riskCaseId,
        institutionId, regionIds: [institution.regionId], payload: { ruleCode: signal.ruleCode, score: signal.score, rulesetVersion: RISK_RULESET.version },
      });
      results.push({ riskCaseId, created: true });
      continue;
    }
    const changed = canonicalJson(existing.evidence) !== canonicalJson(signal.evidence);
    await RiskCase.updateOne(
      { _id: existing._id },
      {
        $set: { score: signal.score, priority, reasons: signal.reasons, evidence: signal.evidence, lastEvaluatedAt: new Date(), rulesetVersion: RISK_RULESET.version },
        ...(changed ? { $push: { evidenceHistory: { evidence: signal.evidence, score: signal.score, at: new Date() }, events: { type: 'RE_EVALUATED', byRole: 'SYSTEM', message: 'Evidence updated after new data was committed.', at: new Date() } } } : {}),
      }
    );
    results.push({ riskCaseId: existing.riskCaseId, created: false, changed });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Officer workflow
// ---------------------------------------------------------------------------
function scopeFilter(user) {
  if (user.role === ROLES.AICTE_NATIONAL_OFFICER) return {};
  if (user.role === ROLES.AICTE_REGIONAL_OFFICER) return { regionId: { $in: user.regionIds } };
  throw forbidden('Only AICTE officers can review risk cases.');
}

async function loadVisibleCase(user, riskCaseId) {
  if (typeof riskCaseId !== 'string' || riskCaseId.length > 40) throw notFound('Risk case not found.');
  const found = await RiskCase.findOne({ riskCaseId, ...scopeFilter(user) }).lean();
  if (!found) throw notFound('Risk case not found.');
  return found;
}

async function listRiskCases(user, query) {
  const filter = scopeFilter(user);
  if (query.status === 'OPEN_ALL') filter.isOpen = true;
  else if (typeof query.status === 'string' && Object.values(RISK_CASE_STATUS).includes(query.status)) filter.status = query.status;
  if (['LOW', 'MEDIUM', 'HIGH'].includes(query.priority)) filter.priority = query.priority;
  if (query.assignedToMe === 'true') filter.assignedTo = user.id;
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    RiskCase.find(filter, { evidenceHistory: 0, notes: 0, events: 0 }).sort({ isOpen: -1, score: -1, createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    RiskCase.countDocuments(filter),
  ]);
  const institutions = await Institution.find({ _id: { $in: items.map((item) => item.institutionId) } }, { name: 1, institutionCode: 1 }).lean();
  const byId = new Map(institutions.map((item) => [String(item._id), item]));
  return pageResult(items.map((item) => ({
    riskCaseId: item.riskCaseId,
    institutionCode: byId.get(String(item.institutionId))?.institutionCode,
    institutionName: byId.get(String(item.institutionId))?.name,
    regionId: item.regionId,
    academicYear: item.academicYear,
    ruleCode: item.ruleCode,
    score: item.score,
    priority: item.priority,
    status: item.status,
    assigned: Boolean(item.assignedTo),
    lastEvaluatedAt: item.lastEvaluatedAt,
  })), total, pagination);
}

function availableActions(user, item) {
  const actions = ['ADD_NOTE'];
  if (item.isOpen) actions.push('ASSIGN', 'MARK_REVIEWED', 'MARK_FALSE_POSITIVE');
  if (item.isOpen && item.status !== RISK_CASE_STATUS.ESCALATED) actions.push('ESCALATE');
  return actions;
}

async function getRiskCase(user, riskCaseId) {
  const item = await loadVisibleCase(user, riskCaseId);
  const userIds = [item.assignedTo, ...item.notes.map((note) => note.by), ...item.events.map((event) => event.by)].filter(Boolean).map(String);
  const [users, institution] = await Promise.all([
    User.find({ _id: { $in: [...new Set(userIds)] } }, { displayName: 1, role: 1 }).lean(),
    Institution.findById(item.institutionId, { name: 1, institutionCode: 1 }).lean(),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  return {
    riskCaseId: item.riskCaseId,
    institution: { code: institution?.institutionCode, name: institution?.name },
    regionId: item.regionId,
    academicYear: item.academicYear,
    ruleCode: item.ruleCode,
    rulesetVersion: item.rulesetVersion,
    score: item.score,
    priority: item.priority,
    scoringFormula: SCORING[item.ruleCode]?.formula,
    reasons: item.reasons,
    evidence: item.evidence,
    evidenceHistory: item.evidenceHistory,
    status: item.status,
    isOpen: item.isOpen,
    assignedToName: item.assignedTo ? names.get(String(item.assignedTo)) : null,
    notes: item.notes.map((note) => ({ text: note.text, byName: names.get(String(note.by)) || note.byRole, byRole: note.byRole, at: note.at })),
    review: item.review?.at ? { summary: item.review.summary, byName: names.get(String(item.review.by)), at: item.review.at } : null,
    falsePositive: item.falsePositive?.at ? { reason: item.falsePositive.reason, byName: names.get(String(item.falsePositive.by)), at: item.falsePositive.at } : null,
    escalation: item.escalation?.at ? { reason: item.escalation.reason, byName: names.get(String(item.escalation.by)), at: item.escalation.at } : null,
    events: item.events.map((event) => ({ type: event.type, byName: event.by ? names.get(String(event.by)) : 'System', message: event.message, at: event.at })),
    availableActions: availableActions(user, item),
    notice: 'Rule-based priority score for human review. It is not a probability of fraud and is not a disciplinary decision.',
  };
}

// Officers this user may assign a case to (assignee must be within the case's scope).
async function assignableOfficers(user, riskCaseId) {
  const item = await loadVisibleCase(user, riskCaseId);
  const filter = { status: USER_STATUS.ACTIVE, $or: [{ role: ROLES.AICTE_REGIONAL_OFFICER, regionIds: item.regionId }] };
  if (user.role === ROLES.AICTE_NATIONAL_OFFICER) filter.$or.push({ role: ROLES.AICTE_NATIONAL_OFFICER });
  const officers = await User.find(filter, { displayName: 1, role: 1, regionIds: 1 }).sort({ displayName: 1 }).lean();
  return officers.map((officer) => ({ id: String(officer._id), displayName: officer.displayName, role: officer.role, regionIds: officer.regionIds }));
}

function audit(user, item, action, reason, payload) {
  return recordAudit({
    actor: user, action, entityType: 'RiskCase', entityRef: item.riskCaseId,
    institutionId: item.institutionId, regionIds: [item.regionId], reason, payload: payload || {},
  });
}

async function assignCase(user, riskCaseId, assigneeId) {
  const item = await loadVisibleCase(user, riskCaseId);
  if (!item.isOpen) throw conflict('RISK_CASE_CLOSED', 'A closed case cannot be reassigned.');
  if (!mongoose.isValidObjectId(assigneeId)) throw unprocessable('INVALID_ASSIGNEE', 'Choose an officer from the list.');
  const allowed = await assignableOfficers(user, riskCaseId);
  const assignee = allowed.find((officer) => officer.id === assigneeId);
  if (!assignee) throw unprocessable('ASSIGNEE_OUT_OF_SCOPE', 'The selected officer is not active or is outside this case\'s scope.');
  const now = new Date();
  await RiskCase.updateOne(
    { _id: item._id, isOpen: true },
    {
      $set: { assignedTo: assigneeId, ...(item.status === RISK_CASE_STATUS.OPEN ? { status: RISK_CASE_STATUS.ASSIGNED } : {}) },
      $push: { events: { type: 'ASSIGNED', by: user.id, byRole: user.role, message: `Assigned to ${assignee.displayName}.`, at: now } },
    }
  );
  await audit(user, item, 'RISK_CASE_ASSIGNED', null, { assigneeId });
  await notifications.safely(notifications.notifyUsers([assigneeId], {
    type: 'RISK_CASE_ASSIGNED', message: `Risk case ${item.riskCaseId} was assigned to you for review.`, entityType: 'RiskCase', entityRef: item.riskCaseId, link: `/aicte/risk/${item.riskCaseId}`,
  }), 'risk-assign');
  return getRiskCase(user, riskCaseId);
}

async function addNote(user, riskCaseId, text) {
  const item = await loadVisibleCase(user, riskCaseId);
  const now = new Date();
  await RiskCase.updateOne(
    { _id: item._id },
    { $push: { notes: { text, by: user.id, byRole: user.role, at: now }, events: { type: 'NOTE_ADDED', by: user.id, byRole: user.role, message: 'Note added.', at: now } } }
  );
  await audit(user, item, 'RISK_CASE_NOTE_ADDED', null, { length: text.length });
  return getRiskCase(user, riskCaseId);
}

async function closeCase(user, riskCaseId, kind, text) {
  const item = await loadVisibleCase(user, riskCaseId);
  if (!item.isOpen) throw conflict('RISK_CASE_CLOSED', 'This case is already closed.');
  const now = new Date();
  const isFalsePositive = kind === 'FALSE_POSITIVE';
  const updated = await RiskCase.findOneAndUpdate(
    { _id: item._id, isOpen: true },
    {
      $set: {
        status: isFalsePositive ? RISK_CASE_STATUS.FALSE_POSITIVE : RISK_CASE_STATUS.REVIEWED,
        isOpen: false,
        ...(isFalsePositive ? { falsePositive: { reason: text, by: user.id, at: now } } : { review: { summary: text, by: user.id, at: now } }),
      },
      $push: {
        events: {
          type: isFalsePositive ? 'MARKED_FALSE_POSITIVE' : 'MARKED_REVIEWED',
          by: user.id,
          byRole: user.role,
          message: isFalsePositive ? 'Marked false positive. Original signal and evidence are kept for future tuning.' : 'Review completed. This does not imply a finding of wrongdoing.',
          at: now,
        },
      },
    }
  );
  if (!updated) throw conflict('RISK_CASE_CLOSED', 'This case was closed by someone else.');
  await audit(user, item, isFalsePositive ? 'RISK_CASE_FALSE_POSITIVE' : 'RISK_CASE_REVIEWED', text);
  return getRiskCase(user, riskCaseId);
}

async function escalateCase(user, riskCaseId, reason) {
  const item = await loadVisibleCase(user, riskCaseId);
  if (!item.isOpen) throw conflict('RISK_CASE_CLOSED', 'A closed case cannot be escalated.');
  if (item.status === RISK_CASE_STATUS.ESCALATED) throw conflict('ALREADY_ESCALATED', 'This case is already escalated.');
  const now = new Date();
  await RiskCase.updateOne(
    { _id: item._id, isOpen: true },
    {
      $set: { status: RISK_CASE_STATUS.ESCALATED, escalation: { reason, by: user.id, at: now } },
      $push: { events: { type: 'ESCALATED', by: user.id, byRole: user.role, message: 'Escalated for national-level review. Escalation does not determine wrongdoing.', at: now } },
    }
  );
  await audit(user, item, 'RISK_CASE_ESCALATED', reason);
  await notifications.safely(notifications.notifyNationalOfficers({
    type: 'RISK_CASE_ESCALATED', message: `Risk case ${item.riskCaseId} was escalated for national review.`, entityType: 'RiskCase', entityRef: item.riskCaseId, link: `/aicte/risk/${item.riskCaseId}`,
  }), 'risk-escalate');
  return getRiskCase(user, riskCaseId);
}

module.exports = {
  SCORING,
  evaluateInstitutionYear,
  listRiskCases,
  getRiskCase,
  assignableOfficers,
  assignCase,
  addNote,
  markReviewed: (user, id, summary) => closeCase(user, id, 'REVIEWED', summary),
  markFalsePositive: (user, id, reason) => closeCase(user, id, 'FALSE_POSITIVE', reason),
  escalateCase,
};
