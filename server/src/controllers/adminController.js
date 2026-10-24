// System administration: users, organisations, seat policies, settings, ledger check.
const users = require('../services/userAdminService');
const policies = require('../services/seatPolicyService');
const settings = require('../services/settingsService');
const { reconcileLedgers } = require('../services/seatLedgerService');
const { studentsWithoutAccounts } = require('../services/studentService');

const config = (req) => req.app.locals.config;

module.exports = {
  listUsers: async (req, res) => res.json(await users.listUsers(req.query)),
  getUser: async (req, res) => res.json(await users.getUser(req.params.id)),
  createUser: async (req, res) => res.status(201).json(await users.createUser(req.user, req.validBody, config(req))),
  updateUser: async (req, res) => res.json(await users.updateUser(req.user, req.params.id, req.validBody)),
  disableUser: async (req, res) => res.json(await users.setUserEnabled(req.user, req.params.id, false, req.validBody.reason)),
  enableUser: async (req, res) => res.json(await users.setUserEnabled(req.user, req.params.id, true, req.validBody.reason)),
  resetPassword: async (req, res) => res.json(await users.initiatePasswordReset(req.user, req.params.id, config(req))),
  referenceData: async (_req, res) => res.json(await users.referenceData()),
  studentsWithoutAccounts: async (_req, res) => res.json({ studentCodes: await studentsWithoutAccounts() }),

  listOrganisations: async (req, res) => res.json({ items: await users.listOrganisations(req.query) }),
  approveOrganisation: async (req, res) => res.json(await users.decideOrganisation(req.user, req.params.id, true, req.validBody.reason)),
  rejectOrganisation: async (req, res) => res.json(await users.decideOrganisation(req.user, req.params.id, false, req.validBody.reason)),

  listPolicies: async (req, res) => res.json({ items: await policies.listPolicies(req.user, req.query) }),
  getPolicy: async (req, res) => res.json(await policies.getPolicy(req.user, req.params.id)),
  comparePolicies: async (req, res) => res.json(await policies.comparePolicies(req.user, String(req.query.from || ''), String(req.query.to || ''))),
  createPolicy: async (req, res) => res.status(201).json(await policies.createDraft(req.user, req.validBody)),
  updatePolicy: async (req, res) => res.json(await policies.updateDraft(req.user, req.params.id, req.validBody)),
  validatePolicy: async (req, res) => res.json(await policies.validateDraft(req.user, req.params.id)),
  submitPolicy: async (req, res) => res.json(await policies.submitForApproval(req.user, req.params.id)),
  publishPolicy: async (req, res) => res.json(await policies.publishPolicy(req.user, req.params.id)),
  rejectPolicy: async (req, res) => res.json(await policies.rejectPolicy(req.user, req.params.id, req.validBody.reason)),

  getSettings: async (_req, res) => res.json({ items: await settings.getSettingsWithDefinitions() }),
  updateSettings: async (req, res) => res.json({ items: await settings.updateSettings(req.validBody.changes, req.user, req.validBody.reason) }),

  ledgerReconciliation: async (_req, res) => res.json(await reconcileLedgers()),
};
