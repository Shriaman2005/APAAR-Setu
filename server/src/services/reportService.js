// Aggregated (non-personal) report exports for AICTE officers.
const { Institution, SeatLedger, Enrolment, Conflict, RiskCase } = require('../models');
const { ROLES, SEAT_OCCUPYING_STATES } = require('../config/constants');
const { forbidden } = require('../utils/AppError');
const { isValidAcademicYear } = require('../utils/dates');
const { recordAudit } = require('./auditService');

const REPORT_HEADERS = ['academicYear', 'regionId', 'stateCode', 'institutionCode', 'institutionName', 'seatCapacity', 'seatsFilled', 'activeEnrolments', 'openConflicts', 'openRiskCases', 'dataLabel'];

/**
 * One row per institution in scope. Contains counts only: no student names or identifiers.
 */
async function institutionReport(user, query, { regional }) {
  if (regional && user.role !== ROLES.AICTE_REGIONAL_OFFICER) throw forbidden('Regional reports are for regional officers.');
  if (!regional && user.role !== ROLES.AICTE_NATIONAL_OFFICER) throw forbidden('National reports are for national officers.');
  const academicYear = isValidAcademicYear(query.academicYear) ? query.academicYear : null;
  const filter = regional ? { regionId: { $in: user.regionIds } } : {};
  const institutions = await Institution.find(filter).sort({ regionId: 1, institutionCode: 1 }).lean();
  const ids = institutions.map((i) => i._id);
  const yearMatch = academicYear ? { academicYear } : {};
  const [ledgers, enrolments, conflicts, risks] = await Promise.all([
    SeatLedger.aggregate([{ $match: { institutionId: { $in: ids }, inActivePolicy: true, ...yearMatch } }, { $group: { _id: '$institutionId', capacity: { $sum: '$capacity' }, filled: { $sum: '$filled' } } }]),
    Enrolment.aggregate([{ $match: { institutionId: { $in: ids }, state: { $in: SEAT_OCCUPYING_STATES }, ...yearMatch } }, { $group: { _id: '$institutionId', count: { $sum: 1 } } }]),
    Conflict.aggregate([{ $match: { involvedInstitutionIds: { $in: ids }, isOpen: true, ...yearMatch } }, { $unwind: '$involvedInstitutionIds' }, { $group: { _id: '$involvedInstitutionIds', count: { $sum: 1 } } }]),
    RiskCase.aggregate([{ $match: { institutionId: { $in: ids }, isOpen: true, ...yearMatch } }, { $group: { _id: '$institutionId', count: { $sum: 1 } } }]),
  ]);
  const get = (list, id, field = 'count') => list.find((item) => String(item._id) === String(id))?.[field] || 0;
  const rows = institutions.map((institution) => ({
    academicYear: academicYear || 'ALL',
    regionId: institution.regionId,
    stateCode: institution.stateCode,
    institutionCode: institution.institutionCode,
    institutionName: institution.name,
    seatCapacity: get(ledgers, institution._id, 'capacity'),
    seatsFilled: get(ledgers, institution._id, 'filled'),
    activeEnrolments: get(enrolments, institution._id),
    openConflicts: get(conflicts, institution._id),
    openRiskCases: get(risks, institution._id),
    dataLabel: 'SYNTHETIC DEMO DATA',
  }));
  await recordAudit({
    actor: user, action: 'REPORT_EXPORTED', entityType: 'Report', entityRef: regional ? 'regional-institution-report' : 'national-institution-report',
    regionIds: regional ? user.regionIds : [], payload: { rows: rows.length, academicYear: academicYear || 'ALL' },
  });
  return { headers: REPORT_HEADERS, rows };
}

module.exports = { institutionReport, REPORT_HEADERS };
