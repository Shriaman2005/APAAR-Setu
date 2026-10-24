// Institutions, seat ledgers, enrolments, conflicts and risk cases.
const mongoose = require('mongoose');
const { Institution } = require('../models');
const { ROLES } = require('../config/constants');
const { forbidden } = require('../utils/AppError');
const { isValidAcademicYear } = require('../utils/dates');
const ledger = require('../services/seatLedgerService');
const enrolments = require('../services/enrolmentService');
const conflicts = require('../services/conflictService');
const risk = require('../services/riskService');

async function listInstitutions(req, res) {
  const filter = {};
  switch (req.user.role) {
    case ROLES.COLLEGE_OPERATOR:
    case ROLES.COLLEGE_HEAD:
      filter._id = new mongoose.Types.ObjectId(String(req.user.institutionId));
      break;
    case ROLES.AICTE_REGIONAL_OFFICER:
      filter.regionId = { $in: req.user.regionIds };
      break;
    case ROLES.AICTE_NATIONAL_OFFICER:
    case ROLES.AICTE_SYSTEM_ADMIN:
      break;
    default:
      throw forbidden('Your role cannot list institutions.');
  }
  const items = await Institution.find(filter).sort({ name: 1 }).lean();
  res.json({ items: items.map((i) => ({ id: String(i._id), code: i.institutionCode, name: i.name, regionId: i.regionId, stateCode: i.stateCode, status: i.status })) });
}

async function seatLedger(req, res) {
  const academicYear = isValidAcademicYear(req.query.academicYear) ? req.query.academicYear : undefined;
  res.json(await ledger.getInstitutionLedger(req.user, req.params.id, academicYear));
}

async function listEnrolments(req, res) {
  res.json(await enrolments.listEnrolments(req.user, req.query));
}

async function getEnrolment(req, res) {
  res.json(await enrolments.getEnrolment(req.user, req.params.enrolmentRef));
}

async function changeEnrolmentState(req, res) {
  res.json(await enrolments.changeState(req.user, req.params.enrolmentRef, req.validBody.toState, req.validBody.reason));
}

async function listConflicts(req, res) {
  res.json(await conflicts.listConflicts(req.user, req.query));
}

async function getConflict(req, res) {
  res.json(await conflicts.getConflict(req.user, req.params.id));
}

async function resolveConflict(req, res) {
  res.json(await conflicts.resolveConflict(req.user, req.params.id, req.validBody.action, req.validBody.reason));
}

async function escalateConflict(req, res) {
  res.json(await conflicts.escalateConflict(req.user, req.params.id, req.validBody.reason));
}

async function listRiskCases(req, res) {
  res.json(await risk.listRiskCases(req.user, req.query));
}

async function getRiskCase(req, res) {
  res.json(await risk.getRiskCase(req.user, req.params.id));
}

async function riskAssignees(req, res) {
  res.json({ items: await risk.assignableOfficers(req.user, req.params.id) });
}

async function assignRisk(req, res) {
  res.json(await risk.assignCase(req.user, req.params.id, req.validBody.assigneeId));
}

async function noteRisk(req, res) {
  res.json(await risk.addNote(req.user, req.params.id, req.validBody.text));
}

async function reviewRisk(req, res) {
  res.json(await risk.markReviewed(req.user, req.params.id, req.validBody.summary));
}

async function falsePositiveRisk(req, res) {
  res.json(await risk.markFalsePositive(req.user, req.params.id, req.validBody.reason));
}

async function escalateRisk(req, res) {
  res.json(await risk.escalateCase(req.user, req.params.id, req.validBody.reason));
}

module.exports = {
  listInstitutions, seatLedger, listEnrolments, getEnrolment, changeEnrolmentState, listConflicts, getConflict, resolveConflict,
  escalateConflict, listRiskCases, getRiskCase, riskAssignees, assignRisk, noteRisk, reviewRisk, falsePositiveRisk, escalateRisk,
};
