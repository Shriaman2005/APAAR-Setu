// /api/admin - system administration. Seat-policy reads are also open to national officers
// (review/oversight, spec 03 permission matrix); every change needs AICTE_SYSTEM_ADMIN.
const express = require('express');
const admin = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const schemas = require('../validators/schemas');
const { ROLES } = require('../config/constants');

const ADMIN = requireRole(ROLES.AICTE_SYSTEM_ADMIN);
const POLICY_READERS = requireRole(ROLES.AICTE_SYSTEM_ADMIN, ROLES.AICTE_NATIONAL_OFFICER);

module.exports = function adminRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/users', ADMIN, admin.listUsers);
  router.post('/users', ADMIN, validateBody(schemas.createUser), admin.createUser);
  router.get('/users/:id', ADMIN, admin.getUser);
  router.patch('/users/:id', ADMIN, validateBody(schemas.updateUser), admin.updateUser);
  router.post('/users/:id/disable', ADMIN, validateBody(schemas.statusChange), admin.disableUser);
  router.post('/users/:id/enable', ADMIN, validateBody(schemas.statusChange), admin.enableUser);
  router.post('/users/:id/password-reset', ADMIN, admin.resetPassword);
  router.get('/reference-data', ADMIN, admin.referenceData);
  router.get('/students-without-accounts', ADMIN, admin.studentsWithoutAccounts);

  router.get('/organisations', ADMIN, admin.listOrganisations);
  router.post('/organisations/:id/approve', ADMIN, validateBody(schemas.orgDecision), admin.approveOrganisation);
  router.post('/organisations/:id/reject', ADMIN, validateBody(schemas.orgDecision), admin.rejectOrganisation);

  router.get('/seat-policies', POLICY_READERS, admin.listPolicies);
  router.get('/seat-policies/compare', POLICY_READERS, admin.comparePolicies);
  router.get('/seat-policies/:id', POLICY_READERS, admin.getPolicy);
  router.post('/seat-policies', ADMIN, validateBody(schemas.policyDraft), admin.createPolicy);
  router.patch('/seat-policies/:id', ADMIN, validateBody(schemas.policyUpdate), admin.updatePolicy);
  router.post('/seat-policies/:id/validate', ADMIN, admin.validatePolicy);
  router.post('/seat-policies/:id/submit', ADMIN, admin.submitPolicy);
  router.post('/seat-policies/:id/publish', ADMIN, admin.publishPolicy);
  router.post('/seat-policies/:id/reject', ADMIN, validateBody(schemas.policyReject), admin.rejectPolicy);

  router.get('/settings', ADMIN, admin.getSettings);
  router.put('/settings', ADMIN, validateBody(schemas.settings), admin.updateSettings);
  router.get('/ledger-reconciliation', POLICY_READERS, admin.ledgerReconciliation);
  return router;
};
