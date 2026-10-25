// Health, dashboards, reports, audit and notifications.
const mongoose = require('mongoose');
const { dbState, isDatabaseConnected } = require('../config/db');
const dashboards = require('../services/dashboardService');
const reports = require('../services/reportService');
const audit = require('../services/auditService');
const notifications = require('../services/notificationService');
const { toCsv, sendCsv } = require('../utils/csvExport');

async function health(_req, res) {
  const connected = isDatabaseConnected();
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
    topology: dbState.topology,
    transactionsSupported: dbState.transactionsSupported,
    time: new Date().toISOString(),
  });
}

async function sendReport(req, res, regional) {
  const report = await reports.institutionReport(req.user, req.query, { regional });
  sendCsv(res, `${regional ? 'regional' : 'national'}-institution-report-DEMO.csv`, toCsv(report.headers, report.rows));
}

module.exports = {
  health,
  collegeDashboard: async (req, res) => res.json(await dashboards.collegeDashboard(req.user, req.query)),
  nationalDashboard: async (req, res) => res.json(await dashboards.aicteDashboard(req.user, req.query, { regional: false })),
  regionalDashboard: async (req, res) => res.json(await dashboards.aicteDashboard(req.user, req.query, { regional: true })),
  adminDashboard: async (req, res) => res.json(await dashboards.adminDashboard(req.user)),
  issuerDashboard: async (req, res) => res.json(await dashboards.issuerDashboard(req.user)),
  verifierDashboard: async (req, res) => res.json(await dashboards.verifierDashboard(req.user)),
  studentDashboard: async (req, res) => res.json(await dashboards.studentDashboard(req.user)),
  nationalReport: (req, res) => sendReport(req, res, false),
  regionalReport: (req, res) => sendReport(req, res, true),
  listAudit: async (req, res) => res.json(await audit.listAuditEvents(req.user, req.query)),
  verifyAuditChain: async (req, res) => {
    const result = await audit.verifyChain();
    // The verification run itself is recorded (after the check, so it never affects the result).
    await audit.recordAudit({
      actor: req.user, action: 'AUDIT_CHAIN_VERIFIED', entityType: 'AuditChain', entityRef: 'audit-chain',
      payload: { status: result.status, checkedEvents: result.checkedEvents, firstFailureSequence: result.firstFailureSequence },
    });
    res.json(result);
  },
  listNotifications: async (req, res) => res.json(await notifications.listForUser(req.user, req.query)),
  markNotificationRead: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    await notifications.markRead(req.user, req.params.id);
    return res.json({ read: true });
  },
  markAllNotificationsRead: async (req, res) => res.json({ updated: await notifications.markAllRead(req.user) }),
};
