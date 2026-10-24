// /api/batches - institution-scoped admission batches.
const express = require('express');
const batches = require('../controllers/batchController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const schemas = require('../validators/schemas');
const { ROLES } = require('../config/constants');

const OPERATOR = requireRole(ROLES.COLLEGE_OPERATOR);
const HEAD = requireRole(ROLES.COLLEGE_HEAD);
const COLLEGE = requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD);

module.exports = function batchRoutes({ csvUpload }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/template-info', OPERATOR, batches.templateInfo);
  router.get('/template.csv', OPERATOR, batches.templateCsv);
  router.post('/', OPERATOR, csvUpload, batches.upload);
  router.get('/', COLLEGE, batches.list);

  router.get('/:batchId', COLLEGE, batches.detail);
  router.get('/:batchId/review', COLLEGE, batches.review);
  router.get('/:batchId/rows', COLLEGE, batches.rows);
  router.get('/:batchId/rows/:rowNumber', COLLEGE, batches.rowDetail);
  router.get('/:batchId/issues', COLLEGE, batches.issues);
  router.get('/:batchId/issues.csv', COLLEGE, batches.exportIssues);
  router.get('/:batchId/summary.csv', HEAD, batches.exportSummary);
  router.get('/:batchId/history', COLLEGE, batches.history);

  // Maker (operator) actions on staging data
  router.patch('/:batchId/rows/:rowNumber', OPERATOR, validateBody(schemas.rowCorrection), batches.correctRow);
  router.post('/:batchId/rows/:rowNumber/exclude', OPERATOR, validateBody(schemas.exclusion), batches.excludeRow);
  router.post('/:batchId/rows/:rowNumber/include', OPERATOR, batches.includeRow);
  router.post('/:batchId/revalidate', OPERATOR, batches.revalidate);
  router.post('/:batchId/issues/:issueId/justify', OPERATOR, validateBody(schemas.justification), batches.justify);
  router.post('/:batchId/mark-ready', OPERATOR, validateBody(schemas.markReady), batches.markReady);
  router.post('/:batchId/discard', OPERATOR, validateBody(schemas.discard), batches.discard);

  // Checker (head) actions - an operator calling these gets 403 from requireRole.
  router.post('/:batchId/return', HEAD, validateBody(schemas.returnBatch), batches.returnBatch);
  router.post('/:batchId/dispositions', HEAD, validateBody(schemas.dispositions), batches.acceptDispositions);
  router.post('/:batchId/certify', HEAD, validateBody(schemas.certify), batches.certify);
  return router;
};
