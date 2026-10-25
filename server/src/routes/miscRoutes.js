// Health, dashboards, reports, audit and notifications.
const express = require('express');
const misc = require('../controllers/miscController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

module.exports = function miscRoutes() {
  const router = express.Router();
  router.get('/health', misc.health);

  router.get('/dashboard/college', requireAuth, requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD), misc.collegeDashboard);
  router.get('/dashboard/aicte/national', requireAuth, requireRole(ROLES.AICTE_NATIONAL_OFFICER), misc.nationalDashboard);
  router.get('/dashboard/aicte/region', requireAuth, requireRole(ROLES.AICTE_REGIONAL_OFFICER), misc.regionalDashboard);
  router.get('/dashboard/admin', requireAuth, requireRole(ROLES.AICTE_SYSTEM_ADMIN), misc.adminDashboard);
  router.get('/dashboard/issuer', requireAuth, requireRole(ROLES.DEGREE_AWARDING_BODY), misc.issuerDashboard);
  router.get('/dashboard/verifier', requireAuth, requireRole(ROLES.VERIFIER), misc.verifierDashboard);
  router.get('/dashboard/student', requireAuth, requireRole(ROLES.STUDENT), misc.studentDashboard);

  router.get('/reports/national.csv', requireAuth, requireRole(ROLES.AICTE_NATIONAL_OFFICER), misc.nationalReport);
  router.get('/reports/region.csv', requireAuth, requireRole(ROLES.AICTE_REGIONAL_OFFICER), misc.regionalReport);

  router.get('/audit', requireAuth, requireRole(ROLES.AICTE_SYSTEM_ADMIN, ROLES.AICTE_NATIONAL_OFFICER, ROLES.AICTE_REGIONAL_OFFICER, ROLES.COLLEGE_HEAD), misc.listAudit);
  router.post('/audit/verify-chain', requireAuth, requireRole(ROLES.AICTE_SYSTEM_ADMIN, ROLES.AICTE_NATIONAL_OFFICER), misc.verifyAuditChain);

  router.get('/notifications', requireAuth, misc.listNotifications);
  router.post('/notifications/read-all', requireAuth, misc.markAllNotificationsRead);
  router.post('/notifications/:id/read', requireAuth, misc.markNotificationRead);
  return router;
};
