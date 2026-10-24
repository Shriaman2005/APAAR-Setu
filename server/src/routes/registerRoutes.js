// Institutions, seat ledgers, enrolments, conflicts and risk cases.
const express = require('express');
const register = require('../controllers/registerController');
const { requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const schemas = require('../validators/schemas');
const { ROLES } = require('../config/constants');

const LEDGER_READERS = requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD, ROLES.AICTE_REGIONAL_OFFICER, ROLES.AICTE_NATIONAL_OFFICER, ROLES.AICTE_SYSTEM_ADMIN);
const ENROLMENT_READERS = requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD, ROLES.AICTE_REGIONAL_OFFICER, ROLES.AICTE_NATIONAL_OFFICER);
const CONFLICT_ACTORS = requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD, ROLES.AICTE_REGIONAL_OFFICER, ROLES.AICTE_NATIONAL_OFFICER);
const OFFICERS = requireRole(ROLES.AICTE_REGIONAL_OFFICER, ROLES.AICTE_NATIONAL_OFFICER);

module.exports = function registerRoutes() {
  // Mounted at /api, so every route carries its own requireRole (which also handles 401).
  const router = express.Router();

  router.get('/institutions', LEDGER_READERS, register.listInstitutions);
  router.get('/institutions/:id/seat-ledger', LEDGER_READERS, register.seatLedger);

  router.get('/enrolments', ENROLMENT_READERS, register.listEnrolments);
  router.get('/enrolments/:enrolmentRef', requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD), register.getEnrolment);
  router.patch('/enrolments/:enrolmentRef/state', requireRole(ROLES.COLLEGE_HEAD), validateBody(schemas.enrolmentState), register.changeEnrolmentState);

  router.get('/conflicts', CONFLICT_ACTORS, register.listConflicts);
  router.get('/conflicts/:id', CONFLICT_ACTORS, register.getConflict);
  router.post('/conflicts/:id/resolve', CONFLICT_ACTORS, validateBody(schemas.conflictResolve), register.resolveConflict);
  router.post('/conflicts/:id/escalate', OFFICERS, validateBody(schemas.escalate), register.escalateConflict);

  router.get('/risk-cases', OFFICERS, register.listRiskCases);
  router.get('/risk-cases/:id', OFFICERS, register.getRiskCase);
  router.get('/risk-cases/:id/assignees', OFFICERS, register.riskAssignees);
  router.post('/risk-cases/:id/assign', OFFICERS, validateBody(schemas.riskAssign), register.assignRisk);
  router.post('/risk-cases/:id/notes', OFFICERS, validateBody(schemas.riskNote), register.noteRisk);
  router.post('/risk-cases/:id/review', OFFICERS, validateBody(schemas.riskReview), register.reviewRisk);
  router.post('/risk-cases/:id/false-positive', OFFICERS, validateBody(schemas.riskReason), register.falsePositiveRisk);
  router.post('/risk-cases/:id/escalate', OFFICERS, validateBody(schemas.riskReason), register.escalateRisk);
  return router;
};
