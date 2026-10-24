// Role dashboards. Every number comes from MongoDB aggregations over persisted (synthetic) data.
const mongoose = require('mongoose');
const {
  UploadBatch, Enrolment, SeatLedger, SeatPolicy, Conflict, RiskCase, Institution, Region, User, Organisation,
  Credential, VerificationRequest, Consent, CorrectionRequest, AuditLog,
} = require('../models');
const {
  ROLES, COLLEGE_ROLES, POLICY_STATUS, SEAT_OCCUPYING_STATES, BATCH_STATUS, ORG_STATUS, CONSENT_STATUS,
} = require('../config/constants');
const { forbidden, notFound } = require('../utils/AppError');
const { isValidAcademicYear } = require('../utils/dates');
const { reconcileLedgers } = require('./seatLedgerService');
const { getSettings } = require('./settingsService');

const DATA_LABEL = 'SYNTHETIC DEMO DATA';

async function resolveAcademicYear(requested) {
  const years = (await SeatPolicy.distinct('academicYear', { status: { $in: [POLICY_STATUS.PUBLISHED, POLICY_STATUS.SUPERSEDED] } })).sort().reverse();
  const academicYear = isValidAcademicYear(requested) ? requested : years[0] || null;
  return { academicYear, academicYears: years };
}

function countsBy(rows) {
  const out = {};
  for (const row of rows) out[row._id] = row.count;
  return out;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

// --- College (operator / head) -------------------------------------------------------------------
async function collegeDashboard(user, query) {
  if (!COLLEGE_ROLES.includes(user.role)) throw forbidden('This dashboard is for college users.');
  const { academicYear, academicYears } = await resolveAcademicYear(query.academicYear);
  const institutionId = new mongoose.Types.ObjectId(String(user.institutionId));
  const [institution, batchStatus, enrolmentStates, ledgers, openConflicts, pendingCorrections, recentBatches] = await Promise.all([
    Institution.findById(institutionId).lean(),
    UploadBatch.aggregate([{ $match: { institutionId, academicYear } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Enrolment.aggregate([{ $match: { institutionId, academicYear } }, { $group: { _id: '$state', count: { $sum: 1 } } }]),
    SeatLedger.find({ institutionId, academicYear }).sort({ courseCode: 1, bucketCode: 1 }).lean(),
    Conflict.countDocuments({ involvedInstitutionIds: institutionId, isOpen: true }),
    CorrectionRequest.countDocuments({ institutionId, status: 'SUBMITTED' }),
    UploadBatch.find({ institutionId }, { batchId: 1, status: 1, academicYear: 1, createdAt: 1, counts: 1, sourceFileName: 1 }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const batches = countsBy(batchStatus);
  const states = countsBy(enrolmentStates);
  const capacity = ledgers.filter((l) => l.inActivePolicy).reduce((sum, l) => sum + l.capacity, 0);
  const filled = ledgers.filter((l) => l.inActivePolicy).reduce((sum, l) => sum + l.filled, 0);
  return {
    dataLabel: DATA_LABEL,
    institution: { code: institution.institutionCode, name: institution.name, regionId: institution.regionId },
    academicYear,
    academicYears,
    kpis: {
      activeEnrolments: SEAT_OCCUPYING_STATES.reduce((sum, state) => sum + (states[state] || 0), 0),
      seatCapacity: capacity,
      seatsFilled: filled,
      utilisationPct: percent(filled, capacity),
      batchesNeedingCorrection: (batches.NEEDS_CORRECTION || 0) + (batches.RETURNED_FOR_CORRECTION || 0) + (batches.COMMIT_FAILED || 0),
      batchesAwaitingReview: batches.READY_FOR_REVIEW || 0,
      batchesCommitted: batches.COMMITTED || 0,
      batchesReturned: batches.RETURNED_FOR_CORRECTION || 0,
      openConflicts,
      pendingCorrectionRequests: pendingCorrections,
    },
    batchStatusCounts: batches,
    enrolmentStateCounts: states,
    ledger: ledgers.map((l) => ({
      courseCode: l.courseCode, bucketCode: l.bucketCode, capacity: l.capacity, filled: l.filled, remaining: l.capacity - l.filled,
      countsWithinIntake: l.countsWithinIntake, policyVersion: l.policyVersion, sourceType: l.sourceType, inActivePolicy: l.inActivePolicy,
    })),
    recentBatches: recentBatches.map((b) => ({ batchId: b.batchId, status: b.status, academicYear: b.academicYear, createdAt: b.createdAt, totalRows: b.counts?.totalRows || 0, sourceFileName: b.sourceFileName })),
    generatedAt: new Date().toISOString(),
  };
}

// --- AICTE (national / regional) -----------------------------------------------------------------
/**
 * @param {boolean} regional true for /api/dashboard/aicte/region (scope = user's assigned regions)
 */
async function aicteDashboard(user, query, { regional }) {
  if (regional && user.role !== ROLES.AICTE_REGIONAL_OFFICER) throw forbidden('This dashboard is for regional officers.');
  if (!regional && user.role !== ROLES.AICTE_NATIONAL_OFFICER) throw forbidden('This dashboard is for national officers.');
  const { academicYear, academicYears } = await resolveAcademicYear(query.academicYear);

  // Scope is derived from the stored user, never from the query string.
  const allowedRegions = regional ? user.regionIds : null;
  let regionFilter = allowedRegions;
  if (typeof query.regionId === 'string' && query.regionId) {
    if (regional && !allowedRegions.includes(query.regionId)) throw forbidden('That region is outside your assigned scope.', 'OUT_OF_SCOPE');
    regionFilter = [query.regionId];
  }
  const institutionFilter = {};
  if (regionFilter) institutionFilter.regionId = { $in: regionFilter };
  if (typeof query.stateCode === 'string' && /^[A-Z0-9-]{2,20}$/.test(query.stateCode)) institutionFilter.stateCode = query.stateCode;
  let drillInstitution = null;
  if (typeof query.institutionId === 'string' && query.institutionId) {
    if (!mongoose.isValidObjectId(query.institutionId)) throw notFound('Institution not found.');
    drillInstitution = await Institution.findOne({ _id: query.institutionId, ...(allowedRegions ? { regionId: { $in: allowedRegions } } : {}) }).lean();
    if (!drillInstitution) throw (regional ? forbidden('That institution is outside your assigned scope.', 'OUT_OF_SCOPE') : notFound('Institution not found.'));
    institutionFilter._id = drillInstitution._id;
  }

  const institutions = await Institution.find(institutionFilter).lean();
  const institutionIds = institutions.map((i) => i._id);
  const level = drillInstitution ? 'COURSE' : (query.regionId || query.stateCode || (regional && allowedRegions.length === 1)) ? 'INSTITUTION' : 'REGION';
  const groupKey = level === 'COURSE' ? '$courseCode' : level === 'INSTITUTION' ? '$institutionId' : '$regionId';

  const [ledgerGroups, enrolmentGroups, enrolmentStates, batchStatus, openConflicts, overdueConflicts, conflictGroups, riskOpen, riskHigh, riskGroups] = await Promise.all([
    SeatLedger.aggregate([
      { $match: { institutionId: { $in: institutionIds }, academicYear, inActivePolicy: true } },
      { $group: { _id: groupKey, capacity: { $sum: '$capacity' }, filled: { $sum: '$filled' } } },
    ]),
    Enrolment.aggregate([
      { $match: { institutionId: { $in: institutionIds }, academicYear, state: { $in: SEAT_OCCUPYING_STATES } } },
      { $group: { _id: groupKey, count: { $sum: 1 } } },
    ]),
    Enrolment.aggregate([{ $match: { institutionId: { $in: institutionIds }, academicYear } }, { $group: { _id: '$state', count: { $sum: 1 } } }]),
    UploadBatch.aggregate([{ $match: { institutionId: { $in: institutionIds }, academicYear } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Conflict.countDocuments({ involvedInstitutionIds: { $in: institutionIds }, academicYear, isOpen: true }),
    Conflict.countDocuments({ involvedInstitutionIds: { $in: institutionIds }, academicYear, isOpen: true, dueAt: { $lt: new Date() } }),
    Conflict.aggregate([
      { $match: { involvedInstitutionIds: { $in: institutionIds }, academicYear, isOpen: true } },
      { $unwind: '$enrolmentRefs' },
      { $match: { 'enrolmentRefs.institutionId': { $in: institutionIds } } },
      { $group: { _id: level === 'REGION' ? '$enrolmentRefs.regionId' : '$enrolmentRefs.institutionId', ids: { $addToSet: '$conflictId' } } },
    ]),
    RiskCase.countDocuments({ institutionId: { $in: institutionIds }, academicYear, isOpen: true }),
    RiskCase.countDocuments({ institutionId: { $in: institutionIds }, academicYear, isOpen: true, priority: 'HIGH' }),
    RiskCase.aggregate([
      { $match: { institutionId: { $in: institutionIds }, academicYear, isOpen: true } },
      { $group: { _id: level === 'REGION' ? '$regionId' : '$institutionId', count: { $sum: 1 } } },
    ]),
  ]);

  const states = countsBy(enrolmentStates);
  const batches = countsBy(batchStatus);
  const capacity = ledgerGroups.reduce((sum, g) => sum + g.capacity, 0);
  const filled = ledgerGroups.reduce((sum, g) => sum + g.filled, 0);

  const regions = await Region.find(allowedRegions ? { regionId: { $in: allowedRegions } } : {}).lean();
  const label = (key) => {
    if (level === 'REGION') return regions.find((r) => r.regionId === key)?.name || key;
    if (level === 'INSTITUTION') {
      const inst = institutions.find((i) => String(i._id) === String(key));
      return inst ? `${inst.name} (${inst.institutionCode})` : String(key);
    }
    return key;
  };
  const keys = new Set([...ledgerGroups.map((g) => String(g._id)), ...enrolmentGroups.map((g) => String(g._id))]);
  if (level === 'INSTITUTION') institutions.forEach((i) => keys.add(String(i._id)));
  if (level === 'REGION') institutions.forEach((i) => keys.add(i.regionId));
  const find = (list, key) => list.find((g) => String(g._id) === key);
  const rows = [...keys].map((key) => {
    const ledger = find(ledgerGroups, key);
    return {
      key,
      label: label(key),
      capacity: ledger?.capacity || 0,
      filled: ledger?.filled || 0,
      utilisationPct: percent(ledger?.filled || 0, ledger?.capacity || 0),
      activeEnrolments: find(enrolmentGroups, key)?.count || 0,
      openConflicts: level === 'COURSE' ? null : find(conflictGroups, key)?.ids.length || 0,
      openRiskCases: level === 'COURSE' ? null : find(riskGroups, key)?.count || 0,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const scopedInstitutions = await Institution.find(allowedRegions ? { regionId: { $in: allowedRegions } } : {}, { name: 1, institutionCode: 1, regionId: 1, stateCode: 1 }).sort({ name: 1 }).lean();
  return {
    dataLabel: DATA_LABEL,
    scope: {
      level: regional ? 'REGIONAL' : 'NATIONAL',
      assignedRegions: allowedRegions,
      academicYear,
      regionId: query.regionId || null,
      stateCode: institutionFilter.stateCode || null,
      institution: drillInstitution ? { id: String(drillInstitution._id), code: drillInstitution.institutionCode, name: drillInstitution.name, regionId: drillInstitution.regionId } : null,
    },
    kpis: {
      institutions: institutions.length,
      activeEnrolments: SEAT_OCCUPYING_STATES.reduce((sum, state) => sum + (states[state] || 0), 0),
      seatCapacity: capacity,
      seatsFilled: filled,
      utilisationPct: percent(filled, capacity),
      batchesAwaitingReview: batches[BATCH_STATUS.READY_FOR_REVIEW] || 0,
      batchesCommitted: batches[BATCH_STATUS.COMMITTED] || 0,
      openConflicts,
      overdueConflicts,
      openRiskCases: riskOpen,
      highPriorityRiskCases: riskHigh,
    },
    enrolmentStateCounts: states,
    batchStatusCounts: batches,
    breakdown: { level, rows },
    filters: {
      academicYears,
      regions: regions.map((r) => ({ regionId: r.regionId, name: r.name })),
      states: [...new Set(scopedInstitutions.map((i) => i.stateCode))].sort(),
      institutions: scopedInstitutions.map((i) => ({ id: String(i._id), code: i.institutionCode, name: i.name, regionId: i.regionId })),
    },
    generatedAt: new Date().toISOString(),
  };
}

// --- System admin ---------------------------------------------------------------------------------
async function adminDashboard(user) {
  if (user.role !== ROLES.AICTE_SYSTEM_ADMIN) throw forbidden('This dashboard is for system administrators.');
  const [usersByRole, usersByStatus, pendingOrgs, policies, lastVerification, reconciliation, settings, auditCount] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Organisation.countDocuments({ status: ORG_STATUS.PENDING }),
    SeatPolicy.find({}, { academicYear: 1, version: 1, status: 1, sourceType: 1, approvedAt: 1 }).sort({ academicYear: -1, createdAt: -1 }).limit(10).lean(),
    AuditLog.findOne({ action: 'AUDIT_CHAIN_VERIFIED' }).sort({ sequence: -1 }).lean(),
    reconcileLedgers(),
    getSettings(),
    AuditLog.estimatedDocumentCount(),
  ]);
  return {
    dataLabel: DATA_LABEL,
    usersByRole: countsBy(usersByRole),
    usersByStatus: countsBy(usersByStatus),
    pendingOrganisations: pendingOrgs,
    policies: policies.map((p) => ({ id: String(p._id), academicYear: p.academicYear, version: p.version, status: p.status, sourceType: p.sourceType, approvedAt: p.approvedAt })),
    lastAuditVerification: lastVerification ? { at: lastVerification.timestamp, status: lastVerification.payload?.status, checkedEvents: lastVerification.payload?.checkedEvents } : null,
    auditEvents: auditCount,
    ledgerReconciliation: { consistent: reconciliation.consistent, mismatches: reconciliation.mismatches.length, checkedLedgers: reconciliation.checkedLedgers },
    settings,
    generatedAt: new Date().toISOString(),
  };
}

// --- Issuer / verifier / student summaries ----------------------------------------------------------
async function issuerDashboard(user) {
  if (user.role !== ROLES.DEGREE_AWARDING_BODY) throw forbidden('This dashboard is for degree-awarding bodies.');
  const org = user.organisationId ? await Organisation.findById(user.organisationId).lean() : null;
  if (!org) throw forbidden('Your account is not linked to an issuer organisation.');
  const [byStatus, eligible, institutions] = await Promise.all([
    Credential.aggregate([{ $match: { issuerOrgId: org._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Enrolment.countDocuments({ institutionId: { $in: org.affiliatedInstitutionIds }, state: { $in: ['CONFIRMED', 'COMPLETED'] } }),
    Institution.find({ _id: { $in: org.affiliatedInstitutionIds } }, { institutionCode: 1, name: 1 }).lean(),
  ]);
  return {
    dataLabel: DATA_LABEL,
    organisation: { code: org.orgCode, name: org.name, status: org.status },
    affiliatedInstitutions: institutions.map((i) => ({ code: i.institutionCode, name: i.name })),
    eligibleRecords: eligible,
    credentialsByStatus: countsBy(byStatus),
    generatedAt: new Date().toISOString(),
  };
}

async function verifierDashboard(user) {
  if (user.role !== ROLES.VERIFIER) throw forbidden('This dashboard is for verifiers.');
  const org = user.organisationId ? await Organisation.findById(user.organisationId).lean() : null;
  const byStatus = await VerificationRequest.aggregate([{ $match: { verifierUserId: new mongoose.Types.ObjectId(String(user.id)) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return {
    dataLabel: DATA_LABEL,
    organisation: org ? { code: org.orgCode, name: org.name, status: org.status } : null,
    requestsByStatus: countsBy(byStatus),
    generatedAt: new Date().toISOString(),
  };
}

async function studentDashboard(user) {
  if (user.role !== ROLES.STUDENT) throw forbidden('This dashboard is for students.');
  const [pending, active, credentials, enrolments] = await Promise.all([
    Consent.countDocuments({ studentRef: user.studentRef, status: CONSENT_STATUS.PENDING, expiresAt: { $gt: new Date() } }),
    Consent.countDocuments({ studentRef: user.studentRef, status: CONSENT_STATUS.APPROVED, expiresAt: { $gt: new Date() } }),
    Credential.countDocuments({ studentRef: user.studentRef }),
    Enrolment.countDocuments({ studentRef: user.studentRef }),
  ]);
  return { dataLabel: DATA_LABEL, pendingConsents: pending, activeConsents: active, credentials, enrolments, generatedAt: new Date().toISOString() };
}

module.exports = { collegeDashboard, aicteDashboard, adminDashboard, issuerDashboard, verifierDashboard, studentDashboard, DATA_LABEL };
